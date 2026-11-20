/**
 * The platform admin dashboard read models and the announcements, against real Postgres and as the database role
 * production uses (not a superuser, no BYPASSRLS), so the writes into the row-level-security table `notification` are
 * proven to bind the store. Run with
 * `pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1 apps/insight/test/platform-admin.int-spec.ts`.
 */
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { AuditWriter } from '../src/audit/audit-writer.service';
import { CreateInsightTables1791800000100 } from '../src/migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from '../src/migrations/1791900000300-create-m7-insight-core';
import { CreateNotifications1792000000200 } from '../src/migrations/1792000000200-create-notifications';
import { CreatePlatformReadModels1792100000100 } from '../src/migrations/1792100000100-create-platform-read-models';
import { CreateAnnouncements1792100000200 } from '../src/migrations/1792100000200-create-announcements';
import { AnnouncementDeliveryService } from '../src/platform-admin/announcements/announcement-delivery.service';
import { AnnouncementSchedulerJob } from '../src/platform-admin/announcements/announcement-scheduler.job';
import { AnnouncementsService } from '../src/platform-admin/announcements/announcements.service';
import { PlatformOverviewService } from '../src/platform-admin/platform-overview.service';
import { PlatformProjectionHandler } from '../src/platform-admin/platform-projection.handler';

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T4 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ADMIN = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-10-20T03:00:00.000Z');

const envelope = (tenantId: string, payload: object, at = NOW.toISOString()) =>
  ({
    id: randomUUID(),
    type: 'x',
    version: 1,
    occurredAt: at,
    tenantId,
    actor: { id: null },
    traceId: 't',
    payload,
  }) as never;

describe('platform admin read models and announcements (Postgres)', () => {
  const schema = uniqueSchema('insight_admin_it');
  const role = `${schema}_app`;
  let admin: DataSource;
  let ds: DataSource;
  let handler: PlatformProjectionHandler;
  let overview: PlatformOverviewService;
  let delivery: AnnouncementDeliveryService;
  let announcements: AnnouncementsService;
  let job: AnnouncementSchedulerJob;
  const audit = { record: jest.fn(async () => undefined) };
  const t = (name: string) => `"${schema}"."${name}"`;

  const tenant = (id: string, name: string, status = 'active', at?: string) =>
    handler.onTenantCreated(
      envelope(id, { id, code: name, name, status, updatedAt: '' }, at),
      admin.manager,
    );
  const subscription = (
    id: string,
    plan: string,
    expiresAt: string | null,
    quotas = { branches: 3, users: 5, products: 100, storageMb: 1000 },
    eventType = 'upgraded',
    at?: string,
  ) =>
    handler.onSubscriptionChanged(
      envelope(
        id,
        {
          subscriptionId: randomUUID(),
          tenantId: id,
          eventType,
          fromPlan: null,
          toPlan: plan,
          expiresAt,
          quotas,
          actor: { type: 'system', id: null },
        },
        at,
      ),
      admin.manager,
    );
  const order = (tenantId: string, completedAt: string, totalAmount: number) =>
    handler.onOrderCompleted(
      envelope(tenantId, { orderId: randomUUID(), completedAt, totalAmount }),
      admin.manager,
    );
  const draft = (audience: object, title = 'Bảo trì') =>
    announcements.create(
      { title, content: 'Nội dung', type: 'maintenance', audience } as never,
      { id: ADMIN },
    );

  beforeAll(async () => {
    useDatabase(schema);
    admin = await initializeDatabase(
      databaseOptions({
        entities: [...PRODUCER_ENTITIES, ...CONSUMER_ENTITIES],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInsightTables1791800000100,
          CreateM7InsightCore1791900000300,
          CreateNotifications1792000000200,
          CreatePlatformReadModels1792100000100,
          CreateAnnouncements1792100000200,
        ],
      }),
    );
    await provisionServiceRole(admin, schema, role);
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: role,
      password: role,
      database: 'pbl',
      schema,
    });
    await ds.initialize();
    handler = new PlatformProjectionHandler();
    overview = new PlatformOverviewService(ds);
    overview.clock = () => NOW;
    delivery = new AnnouncementDeliveryService(ds);
    announcements = new AnnouncementsService(
      ds,
      delivery,
      audit as unknown as AuditWriter,
    );
    announcements.clock = () => NOW;
    job = new AnnouncementSchedulerJob(
      ds,
      delivery,
      audit as unknown as AuditWriter,
    );
    job.clock = () => new Date(NOW.getTime() + 3_600_000);
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.destroy();
  });

  it('builds the tenant projection from events, in any order, and counts it', async () => {
    // T1 pro, expiring in 3 days, products at 95%
    await subscription(T1, 'pro', '2026-10-23T00:00:00.000Z');
    await tenant(T1, 'Mộc Store', 'active', '2026-10-10T00:00:00.000Z');
    await handler.onCatalogUsage(
      envelope(T1, {
        products: 95,
        storageMb: 10,
        measuredAt: NOW.toISOString(),
      }),
      admin.manager,
    );
    // T2 free, suspended
    await tenant(T2, 'Gốm', 'active', '2026-10-19T17:30:00.000Z');
    await subscription(T2, 'free', null);
    await handler.onTenantStatusChanged(
      envelope(
        T2,
        { tenantId: T2, from: 'active', to: 'suspended', reason: null },
        '2026-10-20T01:00:00.000Z',
      ),
      admin.manager,
    );
    // T3 pro, already past its end (grace), storage at the limit
    await tenant(T3, 'Nhà Tre', 'active', '2026-09-01T00:00:00.000Z');
    await subscription(
      T3,
      'pro',
      '2026-10-18T00:00:00.000Z',
      undefined,
      'past_due',
    );
    await handler.onCatalogUsage(
      envelope(T3, {
        products: 1,
        storageMb: 1000,
        measuredAt: NOW.toISOString(),
      }),
      admin.manager,
    );
    // a stale subscription event does not overwrite a newer one
    await subscription(
      T3,
      'free',
      null,
      undefined,
      'expired',
      '2026-01-01T00:00:00.000Z',
    );
    // T4 on a connected shopee shop
    await tenant(T4, 'Shop Bốn', 'active', '2026-10-20T01:00:00.000Z');
    await subscription(T4, 'basic', '2026-12-31T00:00:00.000Z');
    const connection = {
      connectionId: 'c1',
      provider: 'SHOPEE',
      occurredAt: NOW.toISOString(),
    };
    await handler.onConnectionConnected(
      envelope(T4, connection),
      admin.manager,
    );

    const o = await overview.overview('2026-10-20', '2026-10-20');
    expect(o).toMatchObject({
      from: '2026-10-20',
      to: '2026-10-20',
      timezone: 'Asia/Ho_Chi_Minh',
      tenants: { total: 4, active: 3, trial: 0, suspended: 1, newInRange: 2 },
      subscriptions: { expiringSoon: 2 },
      plans: { inUse: 3 },
    });
    expect(o.transactions).toEqual({
      count: 0,
      previousCount: 0,
      changePct: null,
    });
  });

  it('counts completed sales per Vietnam day, zero days included, and compares with the previous range', async () => {
    await order(T1, '2026-10-19T17:30:00.000Z', 100_000); // 20/10 00:30 in Vietnam
    await order(T2, '2026-10-20T16:59:00.000Z', 50_000); // 20/10 23:59
    await order(T4, '2026-10-20T17:00:00.000Z', 70_000); // 21/10 00:00
    await order(T1, '2026-10-18T05:00:00.000Z', 10_000);
    const { data } = await overview.dailyTransactions(
      '2026-10-18',
      '2026-10-21',
    );
    expect(data).toEqual([
      { date: '2026-10-18', orderCount: 1, revenue: 10_000 },
      { date: '2026-10-19', orderCount: 0, revenue: 0 },
      { date: '2026-10-20', orderCount: 2, revenue: 150_000 },
      { date: '2026-10-21', orderCount: 1, revenue: 70_000 },
    ]);
    const o = await overview.overview('2026-10-20', '2026-10-21');
    expect(o.transactions).toEqual({
      count: 3,
      previousCount: 1,
      changePct: 200,
    });
    await expect(
      overview.dailyTransactions('2026-10-21', '2026-10-20'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      overview.dailyTransactions('2026-01-01', '2026-06-01'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(
      (await overview.dailyTransactions('2026-07-21', '2026-10-20')).data,
    ).toHaveLength(92);
  });

  it('lists the stores that need attention, most urgent first, without text and without suspended stores', async () => {
    const { data } = await overview.watchlist(5);
    expect(data.map((i) => [i.kind, i.tenantId, i.severity])).toEqual([
      ['subscription_expiring', T3, 'critical'],
      ['quota_at_limit', T3, 'critical'],
      ['subscription_expiring', T1, 'warning'],
      ['quota_near_limit', T1, 'warning'],
    ]);
    expect(data[1]).toMatchObject({
      key: 'storage_mb',
      used: 1000,
      limit: 1000,
      link: { type: 'usage', id: T3 },
    });
    expect(data[2]).toMatchObject({
      planCode: 'pro',
      expiresAt: '2026-10-23T00:00:00.000Z',
      tenantName: 'Mộc Store',
    });
    expect((await overview.watchlist(2)).data).toHaveLength(2);
  });

  it('resolves audiences from the projection and skips suspended stores', async () => {
    const count = (audience: object) =>
      announcements
        .audiencePreview({ audience } as never)
        .then((r) => r.tenantCount);
    expect(await count({ type: 'all' })).toBe(3);
    expect(await count({ type: 'plan', planCodes: ['pro'] })).toBe(2);
    expect(await count({ type: 'plan', planCodes: ['free'] })).toBe(0); // the free store is suspended
    expect(
      await count({ type: 'integration_provider', providers: ['shopee'] }),
    ).toBe(1);
    expect(await count({ type: 'tenants', tenantIds: [T1, T2] })).toBe(1);
    await handler.onConnectionDisconnected(
      envelope(T4, {
        connectionId: 'c1',
        provider: 'SHOPEE',
        occurredAt: '2026-10-20T04:00:00.000Z',
      }),
      admin.manager,
    );
    expect(
      await count({ type: 'integration_provider', providers: ['shopee'] }),
    ).toBe(0);
  });

  it('sends now: one recipient and one bell notification per store, once, and each store sees only its own', async () => {
    const created = await draft({ type: 'plan', planCodes: ['pro'] });
    expect(created).toMatchObject({
      status: 'draft',
      recipientCount: 0,
      sentAt: null,
    });
    const sent = await announcements.send(created.id, null, { id: ADMIN });
    expect(sent).toMatchObject({ status: 'sent', recipientCount: 2 });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: 'platform',
        action: 'announcement.sent',
        actor: expect.objectContaining({ type: 'platform_admin', id: ADMIN }),
        target: expect.objectContaining({
          type: 'announcement',
          id: created.id,
        }),
      }),
    );
    await expect(
      announcements.send(created.id, null, { id: ADMIN }),
    ).rejects.toMatchObject({
      response: { errorCode: 'N001' },
    });
    await expect(
      announcements.update(created.id, { title: 'x' }),
    ).rejects.toMatchObject({
      response: { errorCode: 'N001' },
    });
    await expect(announcements.remove(created.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // the store's own view, as the role of the service bound to one store
    const seen = async (tenantId: string) => {
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return await runner.query(
          `SELECT "tenant_id", "type", "title", "body" FROM ${t('notification')}`,
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    };
    expect(await seen(T1)).toEqual([
      {
        tenant_id: T1,
        type: 'announcement',
        title: 'Bảo trì',
        body: 'Nội dung',
      },
    ]);
    expect(await seen(T3)).toHaveLength(1);
    expect(await seen(T4)).toEqual([]);
    // redelivering the same announcement adds nothing
    const [row] = await admin.query(
      `SELECT * FROM ${t('announcement')} WHERE id = $1`,
      [created.id],
    );
    await ds.transaction((em) => delivery.deliver(em, row, NOW));
    const [{ n }] = await admin.query(
      `SELECT count(*)::int n FROM ${t('notification')}`,
    );
    expect(n).toBe(2);
  });

  it('refuses an audience with no store (N002), a past schedule (422) and an unknown id (404)', async () => {
    const empty = await draft({ type: 'plan', planCodes: ['nope'] });
    await expect(
      announcements.send(empty.id, null, { id: ADMIN }),
    ).rejects.toMatchObject({
      response: { errorCode: 'N002' },
    });
    await expect(
      announcements.send(empty.id, '2026-10-20T02:59:00.000Z', { id: ADMIN }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(announcements.get(randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('schedules, cancels back to a draft and deletes a draft', async () => {
    const a = await draft({ type: 'all' });
    const scheduled = await announcements.send(
      a.id,
      '2026-10-21T00:00:00.000Z',
      { id: ADMIN },
    );
    expect(scheduled).toMatchObject({
      status: 'scheduled',
      scheduledAt: '2026-10-21T00:00:00.000Z',
    });
    await expect(
      announcements.update(a.id, { title: 'x' }),
    ).rejects.toMatchObject({
      response: { errorCode: 'N003' },
    });
    expect(await announcements.cancel(a.id, { id: ADMIN })).toMatchObject({
      status: 'draft',
      scheduledAt: null,
    });
    await announcements.remove(a.id);
    await expect(announcements.get(a.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lists with the tab counts', async () => {
    const page = await announcements.list({
      page: 1,
      limit: 20,
      order: 'desc',
      status: 'sent',
    });
    expect(page.counts).toEqual({ all: 2, draft: 1, scheduled: 0, sent: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.pagination).toMatchObject({
      totalRecords: 1,
      totalPages: 1,
      currentPage: 1,
    });
    const q = await announcements.list({
      page: 1,
      limit: 20,
      order: 'desc',
      q: 'trì',
    });
    expect(q.counts.all).toBe(2);
  });

  describe('the scheduled send job', () => {
    it('sends what came due exactly once when two replicas run together, and ignores what is not due', async () => {
      const due = await draft({ type: 'plan', planCodes: ['pro'] }, 'Đến hạn');
      const later = await draft({ type: 'all' }, 'Chưa đến hạn');
      await announcements.send(due.id, '2026-10-20T03:30:00.000Z', {
        id: ADMIN,
      });
      await announcements.send(later.id, '2026-10-25T00:00:00.000Z', {
        id: ADMIN,
      });
      audit.record.mockClear();

      const other = new AnnouncementSchedulerJob(
        ds,
        new AnnouncementDeliveryService(ds),
        audit as unknown as AuditWriter,
      );
      other.clock = job.clock;
      const [a, b] = await Promise.all([job.run(), other.run()]);
      expect(a.sent + b.sent).toBe(1);
      expect(a.failed + b.failed).toBe(0);
      expect(await announcements.get(due.id)).toMatchObject({
        status: 'sent',
        recipientCount: 2,
      });
      expect(await announcements.get(later.id)).toMatchObject({
        status: 'scheduled',
      });
      const [{ n }] = await admin.query(
        `SELECT count(*)::int n FROM ${t('announcement_recipient')} WHERE announcement_id = $1`,
        [due.id],
      );
      expect(n).toBe(2);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'announcement.sent',
          actor: expect.objectContaining({ type: 'system' }),
        }),
      );
      // a third run changes nothing
      expect(await job.run()).toEqual({ sent: 0, failed: 0 });
    });

    it('leaves a failed send scheduled and retries it on the next round', async () => {
      const a = await draft({ type: 'tenants', tenantIds: [T1] }, 'Sẽ lỗi');
      await announcements.send(a.id, '2026-10-20T03:10:00.000Z', { id: ADMIN });
      const spy = jest
        .spyOn(delivery, 'deliver')
        .mockRejectedValueOnce(new Error('boom'));
      expect(await job.run()).toEqual({ sent: 0, failed: 1 });
      spy.mockRestore();
      expect(await announcements.get(a.id)).toMatchObject({
        status: 'scheduled',
        recipientCount: 0,
      });
      const [{ n }] = await admin.query(
        `SELECT count(*)::int n FROM ${t('announcement_recipient')} WHERE announcement_id = $1`,
        [a.id],
      );
      expect(n).toBe(0);
      expect(await job.run()).toEqual({ sent: 1, failed: 0 });
      expect(await announcements.get(a.id)).toMatchObject({
        status: 'sent',
        recipientCount: 1,
      });
    });
  });

  it('keeps the read models out of row-level security (platform tables)', async () => {
    const rows = await admin.query(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = ANY($2)`,
      [
        schema,
        [
          'tenant_projection',
          'platform_daily_transactions',
          'announcement',
          'announcement_recipient',
        ],
      ],
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.every((r: { relrowsecurity: boolean }) => !r.relrowsecurity),
    ).toBe(true);
  });
});
