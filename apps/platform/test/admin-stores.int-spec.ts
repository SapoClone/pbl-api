/**
 * The platform admin's store management against a real Postgres, in a throwaway schema: the migration (backfill and
 * revert), store codes, and the admin list / create / edit / lock / reactivate SQL. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  AdminTenantSort,
  AdminTenantStatus,
  ListAdminTenantsReqDto,
} from '../src/api/platform-admin/dto/admin-tenant.req.dto';
import { seedRoles } from '../src/api/role/role-seeding';
import { CreatePlanSubscriptionAndTenantAdminFields1792700000000 } from '../src/database/migrations/1792700000000-create-plan-subscription-and-tenant-admin-fields';
import { startAdminDb } from './support/admin-harness';

const ADMIN = randomUUID();

describe('platform admin store management (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  let dataSource: DataSource;
  let admin: typeof h.services.tenants;
  const outbox = { add: undefined as unknown as jest.Mock };
  const sessions = { revokeAllOfTenant: undefined as unknown as jest.Mock };
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    h.sql<T>(text, params);

  const OLD_T1 = randomUUID();
  const OLD_T2 = randomUUID();
  const OLD_OWNER = randomUUID();

  const query = (over: Partial<ListAdminTenantsReqDto> = {}) =>
    Object.assign(new ListAdminTenantsReqDto(), over);
  const newStore = (n: number, over: Record<string, unknown> = {}) => ({
    name: `Store ${n}`,
    subdomain: `store-${n}`,
    owner: { name: `Owner ${n}`, email: `owner${n}@x.vn` },
    ...over,
  });
  const eventTypes = () => h.outboxCalls().map((call) => call[1].type);

  beforeAll(async () => {
    h = await startAdminDb('admin_it');
    dataSource = h.dataSource;
    admin = h.services.tenants;
    outbox.add = h.outbox.add;
    sessions.revokeAllOfTenant = h.sessions.revokeAllOfTenant;

    // two stores that exist before the migration under test (backfill check), the older one first
    await sql(
      `INSERT INTO "account" ("id","email","password","name","created_by","updated_by") VALUES ($1,'old@x.vn','x','Old Owner','t','t')`,
      [OLD_OWNER],
    );
    await sql(
      `INSERT INTO "tenant" ("id","name","subdomain","created_at","created_by","updated_by") VALUES
        ($1,'Older','older','2026-01-01','t','t'),($2,'Newer','newer','2026-02-01','t','t')`,
      [OLD_T1, OLD_T2],
    );
    await sql(
      `INSERT INTO "branch" ("tenant_id","code","name","is_warehouse","status","created_by","updated_by")
       VALUES ($1,'CN01','Main',true,'active','t','t'),($1,'CN02','Second',false,'active','t','t'),($2,'CN01','Main',true,'active','t','t')`,
      [OLD_T1, OLD_T2],
    );
    for (const tenantId of [OLD_T1, OLD_T2]) {
      const roles = await seedRoles(dataSource.manager, tenantId);
      await sql(
        `INSERT INTO "account_tenant" ("account_id","tenant_id","role","role_id","code") VALUES ($1,$2,'owner',$3,'NV001')`,
        [OLD_OWNER, tenantId, roles.get('owner')!.id],
      );
    }
    await h.applyPlanMigration();
  });

  afterAll(() => h.stop());

  beforeEach(() => jest.clearAllMocks());

  describe('the migration', () => {
    it('seeds the three plans with their limits', async () => {
      const plans = await sql<Record<string, unknown>[]>(
        `SELECT "code","price_monthly","quota_branches","quota_users","quota_products","quota_storage_mb"
         FROM "plan" ORDER BY "price_monthly"`,
      );
      expect(plans).toEqual([
        {
          code: 'free',
          price_monthly: '0',
          quota_branches: 1,
          quota_users: 3,
          quota_products: 100,
          quota_storage_mb: 1024,
        },
        {
          code: 'basic',
          price_monthly: '299000',
          quota_branches: 2,
          quota_users: 10,
          quota_products: 2000,
          quota_storage_mb: 10240,
        },
        {
          code: 'pro',
          price_monthly: '599000',
          quota_branches: 5,
          quota_users: 30,
          quota_products: 10000,
          quota_storage_mb: 51200,
        },
      ]);
    });

    it('gives existing stores a code by creation date, a free subscription and a usage row', async () => {
      const rows = await sql<Record<string, unknown>[]>(
        `SELECT t."code", t."subdomain", s."code" AS sub, s."status", s."expires_at", p."code" AS plan,
           u."branches_used", u."users_used",
           (SELECT count(*)::int FROM "subscription_event" e WHERE e."subscription_id" = s."id") AS events
         FROM "tenant" t
         JOIN "subscription" s ON s."tenant_id" = t."id"
         JOIN "plan" p ON p."id" = s."plan_id"
         JOIN "tenant_usage" u ON u."tenant_id" = t."id"
         ORDER BY t."code"`,
      );
      expect(rows).toEqual([
        {
          code: 'TN0001',
          subdomain: 'older',
          sub: 'SUB-0001',
          status: 'active',
          expires_at: null,
          plan: 'free',
          branches_used: 2,
          users_used: 1,
          events: 1,
        },
        {
          code: 'TN0002',
          subdomain: 'newer',
          sub: 'SUB-0002',
          status: 'active',
          expires_at: null,
          plan: 'free',
          branches_used: 1,
          users_used: 1,
          events: 1,
        },
      ]);
    });

    it('allows one current subscription per store, and refuses a second', async () => {
      await expect(
        sql(
          `INSERT INTO "subscription" ("code","tenant_id","plan_id","status","started_at","created_by","updated_by")
           SELECT 'SUB-9999', $1, "id", 'active', now(), 't', 't' FROM "plan" WHERE "code" = 'pro'`,
          [OLD_T1],
        ),
      ).rejects.toThrow(/UQ_subscription_current_tenant/);
    });

    it('lets an account have no password yet', async () => {
      await sql(
        `INSERT INTO "account" ("email","password","created_by","updated_by") VALUES ('nopass@x.vn',NULL,'t','t')`,
      );
    });
  });

  describe('list', () => {
    beforeAll(async () => {
      // 4 more stores through the real create path, on different plans; one is locked later
      await admin.create(ADMIN, newStore(1, { planCode: 'basic' }));
      await admin.create(ADMIN, newStore(2, { planCode: 'pro' }));
      await admin.create(ADMIN, newStore(3));
      const locked = await admin.create(ADMIN, newStore(4));
      await admin.suspend(ADMIN, locked.id, { reason: 'late payment' });
      await sql(
        `UPDATE "subscription" SET "status" = 'trialing' WHERE "tenant_id" = (SELECT "id" FROM "tenant" WHERE "subdomain" = 'store-3')`,
      );
    });

    it('lists every store with its owner, plan and branch usage', async () => {
      const res = await admin.list(query({ sort: AdminTenantSort.NAME }));
      expect(res.pagination).toMatchObject({
        totalRecords: 6,
        currentPage: 1,
        totalPages: 1,
      });
      const older = res.data.find((s) => s.subdomain === 'older');
      expect(older).toMatchObject({
        code: 'TN0001',
        name: 'Older',
        owner: { name: 'Old Owner', email: 'old@x.vn' },
        status: 'active',
        plan: { code: 'free', name: 'Free' },
        expiresAt: null,
        branches: { used: 2, limit: 1 }, // over its limit: shown, not hidden
      });
      const pro = res.data.find((s) => s.subdomain === 'store-2');
      expect(pro?.plan).toEqual({ code: 'pro', name: 'Pro' });
      expect(pro?.branches).toEqual({ used: 1, limit: 5 });
      expect(pro?.expiresAt).toEqual(expect.any(String));
    });

    it('counts by status for the tab labels, ignoring the status filter', async () => {
      const all = await admin.list(query());
      expect(all.counts).toEqual({ all: 6, active: 4, trial: 1, suspended: 1 });
      const locked = await admin.list(
        query({ status: AdminTenantStatus.SUSPENDED }),
      );
      expect(locked.counts).toEqual(all.counts);
      expect(locked.data.map((s) => s.subdomain)).toEqual(['store-4']);
      expect(locked.pagination.totalRecords).toBe(1);
      const trial = await admin.list(
        query({ status: AdminTenantStatus.TRIAL }),
      );
      expect(trial.data.map((s) => s.subdomain)).toEqual(['store-3']);
    });

    it('filters by plan and keeps the counts to that plan', async () => {
      const res = await admin.list(query({ planCode: 'free' }));
      expect(res.data.map((s) => s.subdomain).sort()).toEqual([
        'newer',
        'older',
        'store-3',
        'store-4',
      ]);
      expect(res.counts.all).toBe(4);
    });

    it.each([
      ['name', 'Store 2', 'store-2'],
      ['code', 'TN0002', 'newer'],
      ['subdomain', 'older', 'older'],
      ['owner email', 'OWNER1@x.vn', 'store-1'],
    ])('searches by %s, case-insensitively', async (_what, q, subdomain) => {
      const res = await admin.list(query({ q }));
      expect(res.data.map((s) => s.subdomain)).toEqual([subdomain]);
    });

    it('does not treat the search text as a pattern or as SQL', async () => {
      const res = await admin.list(query({ q: "x'; DROP TABLE tenant; --" }));
      expect(res.data).toEqual([]);
      await expect(
        sql(`SELECT count(*)::int AS n FROM "tenant"`),
      ).resolves.toEqual([{ n: 6 }]);
    });

    it('pages and sorts', async () => {
      const first = await admin.list(
        query({ limit: 4, page: 1, sort: AdminTenantSort.NAME }),
      );
      const second = await admin.list(
        query({ limit: 4, page: 2, sort: AdminTenantSort.NAME }),
      );
      expect(first.data).toHaveLength(4);
      expect(second.data).toHaveLength(2);
      expect(first.pagination).toMatchObject({ totalPages: 2, nextPage: 2 });
      expect(second.pagination.nextPage).toBeUndefined();
      const names = [...first.data, ...second.data].map((s) => s.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('create', () => {
    it('creates the store, a passwordless owner, the default branch, roles and a free subscription', async () => {
      const detail = await admin.create(ADMIN, {
        name: 'Mộc Store',
        subdomain: 'mocstore',
        email: 'contact@mocstore.vn',
        phone: '0901234567',
        address: '24 Hoa Mai',
        defaultBranchName: 'Chi nhánh gốc',
        owner: { name: 'Minh Anh', email: 'minhanh@mocstore.vn' },
      });
      expect(detail).toMatchObject({
        name: 'Mộc Store',
        subdomain: 'mocstore',
        status: 'active',
        owner: {
          name: 'Minh Anh',
          email: 'minhanh@mocstore.vn',
          phoneMasked: null,
        },
        currentSubscription: {
          plan: { code: 'free' },
          status: 'active',
          expiresAt: null,
          isExpiringSoon: false,
          daysLeft: null,
        },
      });
      expect(detail.code).toMatch(/^TN\d{4}$/);

      const [owner] = await sql<{ password: string | null; status: string }[]>(
        `SELECT "password","status" FROM "account" WHERE "email" = 'minhanh@mocstore.vn'`,
      );
      expect(owner).toEqual({ password: null, status: 'active' });
      const [branch] = await sql<{ name: string }[]>(
        `SELECT "name" FROM "branch" WHERE "tenant_id" = $1`,
        [detail.id],
      );
      expect(branch.name).toBe('Chi nhánh gốc');
      const [roles] = await sql<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "role" WHERE "tenant_id" = $1`,
        [detail.id],
      );
      expect(roles.n).toBe(5);
      await expect(
        sql(
          `SELECT count(*)::int AS n FROM "tenant_usage" WHERE "tenant_id" = $1`,
          [detail.id],
        ),
      ).resolves.toEqual([{ n: 1 }]);
      expect(eventTypes()).toEqual(
        expect.arrayContaining([
          'platform.branch.created',
          'platform.tenant.created',
          'platform.subscription.changed',
        ]),
      );
    });

    it('starts a paid plan for one month, and the event says so', async () => {
      const detail = await admin.create(
        ADMIN,
        newStore(10, { planCode: 'pro' }),
      );
      const sub = detail.currentSubscription!;
      expect(sub).toMatchObject({
        plan: { code: 'pro' },
        priceMonthly: 599000,
        billingCycle: 'monthly',
      });
      const days = (new Date(sub.expiresAt!).getTime() - Date.now()) / 864e5;
      expect(days).toBeGreaterThan(27);
      expect(days).toBeLessThan(32);
      expect(sub.isExpiringSoon).toBe(false);
    });

    it('links an existing account as the owner instead of creating another', async () => {
      const detail = await admin.create(
        ADMIN,
        newStore(11, { owner: { name: 'Whoever', email: 'old@x.vn' } }),
      );
      expect(detail.owner).toMatchObject({
        accountId: OLD_OWNER,
        name: 'Old Owner',
      });
      await expect(
        sql(
          `SELECT count(*)::int AS n FROM "account" WHERE "email" = 'old@x.vn'`,
        ),
      ).resolves.toEqual([{ n: 1 }]);
    });

    it('refuses a taken subdomain (T001) and writes nothing', async () => {
      const before = await sql<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "tenant"`,
      );
      await expect(
        admin.create(ADMIN, newStore(12, { subdomain: 'older' })),
      ).rejects.toMatchObject({
        response: { errorCode: 'tenant.error.subdomain_exists' },
      });
      await expect(
        sql(`SELECT count(*)::int AS n FROM "tenant"`),
      ).resolves.toEqual(before);
      await expect(
        sql(`SELECT 1 FROM "account" WHERE "email" = 'owner12@x.vn'`),
      ).resolves.toEqual([]);
    });

    it('refuses a disabled owner account (T008)', async () => {
      await sql(
        `INSERT INTO "account" ("email","password","status","created_by","updated_by") VALUES ('off@x.vn','x','disabled','t','t')`,
      );
      await expect(
        admin.create(
          ADMIN,
          newStore(13, { owner: { name: 'Off', email: 'off@x.vn' } }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'tenant.error.owner_account_disabled' },
      });
    });

    it('refuses a hidden or unknown plan (P001) and rolls the store back', async () => {
      await sql(
        `INSERT INTO "plan" ("code","name","status","quota_branches","quota_users","quota_products","quota_storage_mb","created_by","updated_by")
         VALUES ('legacy','Legacy','hidden',1,1,1,1,'t','t')`,
      );
      for (const planCode of ['legacy', 'nope']) {
        await expect(
          admin.create(ADMIN, newStore(14, { planCode })),
        ).rejects.toMatchObject({
          response: { errorCode: 'plan.error.not_active' },
        });
      }
      await expect(
        sql(`SELECT 1 FROM "tenant" WHERE "subdomain" = 'store-14'`),
      ).resolves.toEqual([]);
      await expect(
        sql(`SELECT 1 FROM "account" WHERE "email" = 'owner14@x.vn'`),
      ).resolves.toEqual([]);
    });

    it('issues distinct codes to stores created at the same time', async () => {
      const made = await Promise.all(
        [20, 21, 22, 23, 24].map((n) => admin.create(ADMIN, newStore(n))),
      );
      expect(new Set(made.map((s) => s.code)).size).toBe(5);
      expect(new Set(made.map((s) => s.currentSubscription!.code)).size).toBe(
        5,
      );
    });
  });

  describe('detail', () => {
    it('masks the owner phone and answers 404 for an unknown store', async () => {
      await sql(`UPDATE "account" SET "phone" = '0901234567' WHERE "id" = $1`, [
        OLD_OWNER,
      ]);
      const detail = await admin.get(OLD_T1);
      expect(detail.owner?.phoneMasked).toBe('090 •••• •• 67');
      await expect(admin.get(randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('shows a subscription ending soon', async () => {
      await sql(
        `UPDATE "subscription" SET "expires_at" = now() + interval '2 days' WHERE "tenant_id" = $1`,
        [OLD_T2],
      );
      const sub = (await admin.get(OLD_T2)).currentSubscription!;
      expect(sub).toMatchObject({ isExpiringSoon: true, daysLeft: 2 });
    });
  });

  describe('update', () => {
    it('edits the fields and records what changed', async () => {
      const detail = await admin.update(ADMIN, OLD_T1, {
        name: 'Older Renamed',
        phone: '0987654321',
      });
      expect(detail).toMatchObject({
        name: 'Older Renamed',
        phone: '0987654321',
        subdomain: 'older',
        code: 'TN0001',
      });
      const call = h
        .outboxCalls()
        .find((c) => c[1].type === 'platform.tenant.updated')!;
      expect(call[2].changes).toEqual({
        name: { from: 'Older', to: 'Older Renamed' },
        phone: { from: null, to: '0987654321' },
      });
    });

    it('emits nothing when nothing changed', async () => {
      await admin.update(ADMIN, OLD_T1, { name: 'Older Renamed' });
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('refuses another store’s subdomain (T001) and unknown stores (404)', async () => {
      await expect(
        admin.update(ADMIN, OLD_T1, { subdomain: 'newer' }),
      ).rejects.toMatchObject({
        response: { errorCode: 'tenant.error.subdomain_exists' },
      });
      await expect(
        admin.update(ADMIN, randomUUID(), { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('lock and reactivate', () => {
    it('locks with a reason, ends the store’s sessions, and says so in an event', async () => {
      const detail = await admin.suspend(ADMIN, OLD_T2, {
        reason: 'Vi phạm điều khoản',
      });
      expect(detail).toMatchObject({
        status: 'suspended',
        suspendedReason: 'Vi phạm điều khoản',
      });
      expect(detail.suspendedAt).toEqual(expect.any(String));
      expect(sessions.revokeAllOfTenant).toHaveBeenCalledWith(OLD_T2);
      expect(outbox.add).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'platform.tenant.status_changed' }),
        expect.objectContaining({
          tenantId: OLD_T2,
          from: 'active',
          to: 'suspended',
          reason: 'Vi phạm điều khoản',
          changedBy: { type: 'platform_admin', id: ADMIN },
        }),
        { tenantId: OLD_T2 },
      );
    });

    it('refuses to lock twice (T006) and does not end sessions again', async () => {
      await expect(
        admin.suspend(ADMIN, OLD_T2, { reason: 'again' }),
      ).rejects.toMatchObject({
        response: { errorCode: 'tenant.error.already_suspended' },
      });
      expect(sessions.revokeAllOfTenant).not.toHaveBeenCalled();
    });

    it('keeps the store’s data and members while locked', async () => {
      await expect(
        sql(`SELECT count(*)::int AS n FROM "branch" WHERE "tenant_id" = $1`, [
          OLD_T2,
        ]),
      ).resolves.toEqual([{ n: 1 }]);
      await expect(
        sql(
          `SELECT count(*)::int AS n FROM "account_tenant" WHERE "tenant_id" = $1`,
          [OLD_T2],
        ),
      ).resolves.toEqual([{ n: 1 }]);
    });

    it('reactivates, clearing the reason', async () => {
      const detail = await admin.reactivate(ADMIN, OLD_T2, {
        note: 'Đã thanh toán',
      });
      expect(detail).toMatchObject({
        status: 'active',
        suspendedReason: null,
        suspendedAt: null,
      });
      expect(outbox.add).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'platform.tenant.status_changed' }),
        expect.objectContaining({
          from: 'suspended',
          to: 'active',
          reason: 'Đã thanh toán',
        }),
        { tenantId: OLD_T2 },
      );
    });

    it('goes back to trial when the subscription is trialing', async () => {
      await sql(
        `UPDATE "subscription" SET "status" = 'trialing' WHERE "tenant_id" = $1`,
        [OLD_T2],
      );
      await admin.suspend(ADMIN, OLD_T2, { reason: 'x' });
      const detail = await admin.reactivate(ADMIN, OLD_T2, {});
      expect(detail.status).toBe('trial');
    });

    it('refuses to reactivate a store that is not locked (T007)', async () => {
      await expect(admin.reactivate(ADMIN, OLD_T1, {})).rejects.toMatchObject({
        response: { errorCode: 'tenant.error.not_suspended' },
      });
    });

    it('answers 404 for an unknown store', async () => {
      await expect(
        admin.suspend(ADMIN, randomUUID(), { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        admin.reactivate(ADMIN, randomUUID(), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reverting the migration', () => {
    it('removes what it added, and gives a passwordless owner an unusable password', async () => {
      const runner = dataSource.createQueryRunner();
      await new CreatePlanSubscriptionAndTenantAdminFields1792700000000().down(
        runner,
      );
      await runner.release();
      const tables = await sql<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name IN ('plan','subscription','subscription_event','subscription_payment','tenant_usage')`,
        [h.schema],
      );
      expect(tables).toEqual([]);
      const columns = await sql<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'tenant' AND column_name IN ('code','suspended_reason','suspended_at')`,
        [h.schema],
      );
      expect(columns).toEqual([]);
      // the owner created without a password keeps their account, which nobody can sign in to
      await expect(
        sql(
          `SELECT "password" FROM "account" WHERE "email" = 'minhanh@mocstore.vn'`,
        ),
      ).resolves.toEqual([{ password: '!' }]);
      await expect(
        sql(
          `INSERT INTO "account" ("email","password","created_by","updated_by") VALUES ('np@x.vn',NULL,'t','t')`,
        ),
      ).rejects.toThrow(/null value/);
    });
  });
});
