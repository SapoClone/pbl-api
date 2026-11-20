/**
 * Support sessions (ADR-0025) against a real Postgres, in a throwaway schema: the migration, start (SS01, SS02, 404,
 * idempotency), end by an admin or by the session's own token (SS03), the deny-list, the expiry job (once, safe to run
 * twice and in parallel), the list filters and counts, and that the token is never stored. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthUser } from '@pbl/auth';
import { randomUUID } from 'crypto';
import { SupportSessionExpiryJob } from '../src/api/platform-admin/support-session/support-session-expiry.job';
import {
  ListSupportSessionsReqDto,
  StartSupportSessionReqDto,
  SupportSessionStatus,
} from '../src/api/platform-admin/support-session/support-session.req.dto';
import {
  SUPPORT_SESSION_PERMISSIONS,
  SupportSessionService,
} from '../src/api/platform-admin/support-session/support-session.service';
import { CreateSupportSession1793200000000 } from '../src/database/migrations/1793200000000-create-support-session';
import { startAdminDb } from './support/admin-harness';

const MIN = 60 * 1000;
const T0 = new Date('2031-06-01T03:00:00.000Z');
/** After every session of the first sections has run out */
const T1 = new Date(T0.getTime() + 1000 * 60 * 1000);

describe('support sessions (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  let now = T0;
  let service: SupportSessionService;
  const tokens = { signSupport: jest.fn(async () => 'TOKEN-ABC') };
  const sessions = {
    denyUntil: jest.fn(async () => undefined),
    onAdminRevoked: jest.fn(),
  };
  const lan = randomUUID();
  const minh = randomUUID();
  const stores: Record<string, string> = {};
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    h.sql<T>(text, params);

  const start = (adminId: string, store: string, over = {}) =>
    service.start(
      adminId,
      Object.assign(new StartSupportSessionReqDto(), {
        tenantId: stores[store],
        reason: 'Kiểm tra đồng bộ đơn Shopee',
        ...over,
      }),
      (over as { key?: string }).key,
    );
  const supportCaller = (adminId: string, sessionId: string) =>
    ({
      id: adminId,
      sessionId,
      subjectType: 'platform_admin',
      tenantId: 'x',
      roles: [],
      permissions: [],
      branches: ['*'],
      exp: 0,
      readOnly: true,
      actor: { adminId, supportSessionId: sessionId },
    }) as AuthUser;
  const adminCaller = (id: string) =>
    ({
      id,
      sessionId: 's',
      subjectType: 'platform_admin',
      roles: ['admin'],
      permissions: [],
      branches: ['*'],
      exp: 0,
    }) as AuthUser;
  const events = (type: string) =>
    h
      .outboxCalls()
      .filter((c) => c[1].type === type)
      .map((c) => ({ payload: c[2], options: c[3] }));
  const list = (over: Partial<ListSupportSessionsReqDto> = {}) =>
    service.list(Object.assign(new ListSupportSessionsReqDto(), over));

  beforeAll(async () => {
    h = await startAdminDb('support_it');
    await h.applyPlanMigration();
    await new CreateSupportSession1793200000000().up(
      h.dataSource.createQueryRunner(),
    );
    service = new SupportSessionService(
      h.dataSource,
      tokens as never,
      sessions as never,
      h.outbox as never,
      () => now,
    );
    await sql(
      `INSERT INTO "platform_admin" ("id","email","name","role","created_by","updated_by") VALUES
        ($1,'lan@omni.vn','Lan Anh','admin','t','t'),($2,'minh@omni.vn','Minh','admin','t','t')`,
      [lan, minh],
    );
    for (const key of ['A', 'B', 'C', 'E', 'SUSP']) {
      const detail = await h.services.tenants.create(lan, {
        name: `Store ${key}`,
        subdomain: `sup-${key.toLowerCase()}`,
        owner: { name: `Owner ${key}`, email: `owner-sup-${key}@x.vn` },
      });
      stores[key] = detail.id;
    }
    await h.services.tenants.suspend(lan, stores.SUSP, { reason: 'Nợ phí' });
  });

  afterAll(() => h.stop());

  beforeEach(() => {
    jest.clearAllMocks();
    now = T0;
  });

  it('only lets the token read: the explicit view codes, never the wildcard', () => {
    expect(SUPPORT_SESSION_PERMISSIONS).toContain('orders.view');
    expect(SUPPORT_SESSION_PERMISSIONS).not.toContain('*');
    expect(SUPPORT_SESSION_PERMISSIONS.every((c) => c.endsWith('.view'))).toBe(
      true,
    );
  });

  describe('start', () => {
    it('opens an active session for an hour, answers the token once and emits started', async () => {
      const { session, replayed } = await start(lan, 'A');

      expect(replayed).toBe(false);
      expect(session).toMatchObject({
        code: 'SESSION-0001',
        tenant: { id: stores.A, name: 'Store A' },
        admin: { id: lan, name: 'Lan Anh' },
        accessMode: 'read_only',
        status: 'active',
        startedAt: T0.toISOString(),
        expiresAt: new Date(T0.getTime() + 60 * MIN).toISOString(),
        endedAt: null,
        accessToken: 'TOKEN-ABC',
      });
      expect(tokens.signSupport).toHaveBeenCalledWith({
        adminId: lan,
        sessionId: session.id,
        tenantId: stores.A,
        permissions: [...SUPPORT_SESSION_PERMISSIONS],
        expiresAt: new Date(session.expiresAt),
      });
      const [started] = events('platform.support_session.started');
      expect(started.options).toEqual({ tenantId: stores.A });
      expect(started.payload).toMatchObject({
        code: 'SESSION-0001',
        tenantId: stores.A,
        tenantName: 'Store A',
        adminId: lan,
        adminName: 'Lan Anh',
        reason: 'Kiểm tra đồng bộ đơn Shopee',
        expiresAt: new Date(T0.getTime() + 60 * MIN).toISOString(),
      });
    });

    it('never stores or returns the token again: detail, list and the row are clean', async () => {
      const detail = await service.get(
        (await sql<{ id: string }[]>(`SELECT "id" FROM "support_session"`))[0]
          .id,
      );
      const all = await list();
      const row = await sql(`SELECT * FROM "support_session"`);
      for (const body of [detail, all, row]) {
        expect(JSON.stringify(body)).not.toContain('TOKEN-ABC');
        expect(JSON.stringify(body)).not.toContain('accessToken');
      }
    });

    it('SS01: the same admin cannot open a second session on the same store', async () => {
      await expect(start(lan, 'A')).rejects.toMatchObject({
        response: { errorCode: 'support_session.error.already_active' },
      });
    });

    it('another admin may look into the same store at the same time', async () => {
      await expect(start(minh, 'A')).resolves.toMatchObject({
        session: { status: 'active', admin: { name: 'Minh' } },
      });
    });

    it('SS02: refuses a suspended store; 404 for an unknown one', async () => {
      await expect(start(lan, 'SUSP')).rejects.toMatchObject({
        response: { errorCode: 'support_session.error.tenant_suspended' },
      });
      stores.NONE = randomUUID();
      await expect(start(lan, 'NONE')).rejects.toThrow(NotFoundException);
    });

    it('a retry with the same Idempotency-Key answers the same session with a fresh token', async () => {
      const first = await start(lan, 'B', { key: 'key-1' });
      const again = await start(lan, 'B', { key: 'key-1' });

      expect(again.replayed).toBe(true);
      expect(again.session.id).toBe(first.session.id);
      const [{ n }] = await sql<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "support_session" WHERE "tenant_id" = $1`,
        [stores.B],
      );
      expect(n).toBe(1);
      expect(events('platform.support_session.started')).toHaveLength(1);
    });

    it('a session that ran out but was not closed does not block the next one', async () => {
      await start(lan, 'C');
      now = new Date(T0.getTime() + 61 * MIN);

      const { session } = await start(lan, 'C');
      expect(session.status).toBe('active');
      const ended = events('platform.support_session.ended');
      expect(ended).toHaveLength(1);
      expect(ended[0].payload).toMatchObject({
        endedBy: 'expiry',
        tenantId: stores.C,
      });
    });
  });

  describe('end', () => {
    it('ends with the admin token, denies the sid until expiry and emits ended', async () => {
      const { session } = await start(lan, 'E');

      const ended = await service.end(adminCaller(minh), session.id);

      expect(ended).toMatchObject({
        status: 'ended',
        endedAt: T0.toISOString(),
      });
      expect(sessions.denyUntil).toHaveBeenCalledWith(
        session.id,
        new Date(session.expiresAt),
      );
      const [event] = events('platform.support_session.ended');
      expect(event.options).toEqual({ tenantId: stores.E });
      expect(event.payload).toMatchObject({
        sessionId: session.id,
        code: session.code,
        adminId: lan,
        adminName: 'Lan Anh',
        endedBy: 'admin',
        endedAt: T0.toISOString(),
      });
    });

    it('SS03: ending it again is refused', async () => {
      const [{ id }] = await sql<{ id: string }[]>(
        `SELECT "id" FROM "support_session" WHERE "tenant_id" = $1`,
        [stores.E],
      );
      await expect(service.end(adminCaller(lan), id)).rejects.toMatchObject({
        response: { errorCode: 'support_session.error.already_ended' },
      });
      expect(sessions.denyUntil).not.toHaveBeenCalled();
    });

    it('404 for an unknown session', async () => {
      await expect(service.end(adminCaller(lan), randomUUID())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('the session’s own token may end it; another session’s token may not', async () => {
      const [a] = await sql<{ id: string }[]>(
        `SELECT "id" FROM "support_session" WHERE "tenant_id" = $1 AND "admin_id" = $2`,
        [stores.A, lan],
      );
      const [b] = await sql<{ id: string }[]>(
        `SELECT "id" FROM "support_session" WHERE "tenant_id" = $1`,
        [stores.B],
      );

      await expect(service.end(supportCaller(lan, b.id), a.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.end(supportCaller(lan, a.id), a.id),
      ).resolves.toMatchObject({ status: 'ended' });
      expect(sessions.denyUntil).toHaveBeenCalledTimes(1);
    });

    it('ending after the expiry records the expiry and answers SS03', async () => {
      const [b] = await sql<{ id: string }[]>(
        `SELECT "id" FROM "support_session" WHERE "tenant_id" = $1`,
        [stores.B],
      );
      now = new Date(T0.getTime() + 2 * 60 * MIN);

      await expect(service.end(adminCaller(lan), b.id)).rejects.toMatchObject({
        response: { errorCode: 'support_session.error.already_ended' },
      });
      expect((await service.get(b.id)).status).toBe('expired');
      expect(events('platform.support_session.ended')).toHaveLength(1);
    });
  });

  describe('the expiry job', () => {
    it('closes a session past its end once, with endedBy expiry, and is idempotent', async () => {
      now = T1;
      await service.expireDue(); // flush what the earlier sections left open
      const { session } = await start(minh, 'B');
      now = new Date(T1.getTime() + 61 * MIN);
      jest.clearAllMocks();
      const job = new SupportSessionExpiryJob(service);

      expect(await job.run()).toBe(1);
      expect(await job.run()).toBe(0);

      const ended = events('platform.support_session.ended');
      expect(ended).toHaveLength(1);
      expect(ended[0].payload).toMatchObject({
        sessionId: session.id,
        endedBy: 'expiry',
        endedAt: session.expiresAt,
        adminName: 'Minh',
      });
      expect(await service.get(session.id)).toMatchObject({
        status: 'expired',
        endedAt: session.expiresAt,
      });
    });

    it('two replicas at once close it once', async () => {
      now = T1;
      const { session } = await start(lan, 'B');
      now = new Date(T1.getTime() + 61 * MIN);
      jest.clearAllMocks();

      const closed = await Promise.all([
        service.expireDue(),
        service.expireDue(),
      ]);

      expect(closed.reduce((a, b) => a + b, 0)).toBe(1);
      expect(
        events('platform.support_session.ended').filter(
          (e) => e.payload.sessionId === session.id,
        ),
      ).toHaveLength(1);
    });

    it('ends nothing that is still running', async () => {
      now = new Date(T1.getTime() + 200 * MIN);
      const { session } = await start(lan, 'A');
      now = new Date(T1.getTime() + 230 * MIN);

      await service.expireDue();

      expect((await service.get(session.id)).status).toBe('active');
    });
  });

  describe('list', () => {
    it('filters by store, admin and status, with counts that ignore the status', async () => {
      now = new Date(T1.getTime() + 230 * MIN);

      const all = await list({ limit: 100 });
      expect(all.counts.all).toBe(all.pagination.totalRecords);
      expect(all.counts.active).toBeGreaterThan(0);
      expect(all.counts.ended).toBeGreaterThan(0);
      expect(all.counts.expired).toBeGreaterThan(0);

      const active = await list({ status: SupportSessionStatus.ACTIVE });
      expect(active.data.every((s) => s.status === 'active')).toBe(true);
      expect(active.pagination.totalRecords).toBe(all.counts.active);
      expect(active.counts).toEqual(all.counts);

      const ofStore = await list({ tenantId: stores.A });
      expect(ofStore.data.every((s) => s.tenant.id === stores.A)).toBe(true);
      const ofAdmin = await list({ adminId: minh });
      expect(ofAdmin.data.every((s) => s.admin.id === minh)).toBe(true);
      expect(ofAdmin.data[0]).toHaveProperty('reason');
      expect(JSON.stringify(all)).not.toContain('TOKEN-ABC');
    });

    it('searches by code, store and admin name; newest first; pages', async () => {
      expect((await list({ q: 'SESSION-0001' })).data).toHaveLength(1);
      expect(
        (await list({ q: 'Minh' })).data.every((s) => s.admin.name === 'Minh'),
      ).toBe(true);
      const page = await list({ limit: 2, page: 1 });
      expect(page.data).toHaveLength(2);
      expect(page.data[0].startedAt >= page.data[1].startedAt).toBe(true);
      expect(page.pagination.nextPage).toBe(2);
    });
  });

  describe('disabling an admin', () => {
    it('ends their open sessions and denies their tokens', async () => {
      now = new Date(T1.getTime() + 300 * MIN);
      const { session } = await start(minh, 'C');
      jest.clearAllMocks();

      expect(await service.endAllOfAdmin(minh)).toBe(1);

      expect((await service.get(session.id)).status).toBe('ended');
      expect(sessions.denyUntil).toHaveBeenCalledWith(
        session.id,
        new Date(session.expiresAt),
      );
      expect(sessions.onAdminRevoked).not.toHaveBeenCalled();
    });

    it('registers itself on the session service', () => {
      new SupportSessionService(
        h.dataSource,
        tokens as never,
        sessions as never,
        h.outbox as never,
        () => now,
      );
      expect(sessions.onAdminRevoked).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });
});
