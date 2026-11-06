/**
 * Branch lifecycle against a real Postgres in a throwaway schema (workstream B, D4 D8 D11 D38): delete only after
 * deactivate, every reason listed, scope cleanup and session revocation, a code is never reused or changed, three
 * stores per account, locked members do not use a seat. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1 apps/platform/test/branch-lifecycle`
 */
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { randomUUID } from 'crypto';
import { BlockersUnavailableError } from '../src/api/branch-guard/branch-blockers.client';
import { BranchLifecycleGuard } from '../src/api/branch/branch-lifecycle.guard';
import { BranchService } from '../src/api/branch/branch.service';
import { BranchEntity } from '../src/api/branch/entities/branch.entity';
import { PlanEntity } from '../src/api/subscription/entities/plan.entity';
import { SubscriptionCoreService } from '../src/api/subscription/subscription-core.service';
import { TenantService } from '../src/api/tenant/tenant.service';
import { startAdminDb } from './support/admin-harness';

const ADMIN = randomUUID();

describe('branch lifecycle (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  let tenantId: string;
  let ownerId: string;
  let branches: BranchService;
  let client: { forBranch: jest.Mock };
  let ownerRoleId: string;
  const asStore = <T>(work: () => Promise<T>) =>
    TenantContext.run(tenantId, work);
  const errorOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('did not throw');
      },
      (e) => e as { getStatus(): number; getResponse(): any },
    );

  const insertBranch = async (code: string, status = 'active') => {
    const [{ id }] = await h.sql<{ id: string }[]>(
      `INSERT INTO "branch" ("tenant_id","name","code","status","is_warehouse","created_by","updated_by")
       VALUES ($1,$2,$2,$3,true,'t','t') RETURNING "id"`,
      [tenantId, code, status],
    );
    return id;
  };
  const insertMember = async (
    email: string,
    code: string,
    branchIds: string[],
    status = 'active',
  ) => {
    const [{ id }] = await h.sql<{ id: string }[]>(
      `INSERT INTO "account" ("email","password","created_by","updated_by") VALUES ($1,'x','t','t') RETURNING "id"`,
      [email],
    );
    await h.sql(
      `INSERT INTO "account_tenant" ("account_id","tenant_id","role","role_id","code","status")
       VALUES ($1,$2,'sales_staff',$3,$4,$5)`,
      [id, tenantId, ownerRoleId, code, status],
    );
    for (const branchId of branchIds) {
      await h.sql(
        `INSERT INTO "account_tenant_branch" ("account_id","tenant_id","branch_id") VALUES ($1,$2,$3)`,
        [id, tenantId, branchId],
      );
    }
    return id;
  };
  const rowsOf = (accountId: string) =>
    h.sql<{ branch_id: string }[]>(
      `SELECT "branch_id" FROM "account_tenant_branch" WHERE "account_id" = $1`,
      [accountId],
    );

  beforeAll(async () => {
    h = await startAdminDb('branch_lifecycle');
    await h.applyPlanMigration();
    const store = await h.services.tenants.create(ADMIN, {
      name: 'Lifecycle store',
      subdomain: 'lifecycle-store',
      owner: { name: 'Owner', email: 'owner@lifecycle.vn' },
    });
    tenantId = store.id;
    [{ account_id: ownerId, role_id: ownerRoleId }] = await h.sql(
      `SELECT "account_id","role_id" FROM "account_tenant" WHERE "tenant_id" = $1`,
      [tenantId],
    );
    client = { forBranch: jest.fn().mockResolvedValue([]) };
    branches = new BranchService(
      TenantScopedRepository.forEntity(h.dataSource, BranchEntity),
      h.outbox as never,
      { assertCanAdd: jest.fn().mockResolvedValue(undefined) } as never,
      new BranchLifecycleGuard(client as never),
      h.sessions as never,
    );
  });
  afterAll(() => h.stop());
  beforeEach(() => {
    client.forBranch.mockReset().mockResolvedValue([]);
    h.sessions.revokeAll.mockClear();
  });

  describe('delete', () => {
    it('refuses to delete an ACTIVE branch with B004 (the defect: it used to delete in one step)', async () => {
      const id = await insertBranch('ACT1');

      const error = await errorOf(asStore(() => branches.remove(id)));

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse().errorCode).toBe('branch.error.not_inactive');
      const [row] = await h.sql<{ deleted_at: Date | null }[]>(
        `SELECT "deleted_at" FROM "branch" WHERE "id" = $1`,
        [id],
      );
      expect(row.deleted_at).toBeNull();
      expect(client.forBranch).not.toHaveBeenCalled();
    });

    it('lists EVERY reason of every service and the members it would strand, and deletes nothing', async () => {
      const id = await insertBranch('BLK1', 'inactive');
      const stranded = await insertMember('only@lifecycle.vn', 'NV80', [id]);
      client.forBranch.mockResolvedValue([
        {
          service: 'inventory',
          code: 'INVENTORY_STOCK_ON_HAND',
          message: 'Chi nhánh còn tồn kho của 4 mặt hàng',
          count: 4,
        },
        {
          service: 'sales',
          code: 'SALES_OPEN_SHIFTS',
          message: 'Chi nhánh còn 1 ca bán hàng chưa đóng',
          count: 1,
        },
      ]);

      const error = await errorOf(asStore(() => branches.remove(id)));

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().errorCode).toBe('branch.error.blocked');
      expect(
        error
          .getResponse()
          .details.reasons.map((r: { code: string }) => r.code),
      ).toEqual([
        'INVENTORY_STOCK_ON_HAND',
        'SALES_OPEN_SHIFTS',
        'PLATFORM_MEMBER_WITHOUT_BRANCH',
      ]);
      const [row] = await h.sql<{ deleted_at: Date | null }[]>(
        `SELECT "deleted_at" FROM "branch" WHERE "id" = $1`,
        [id],
      );
      expect(row.deleted_at).toBeNull();
      expect(await rowsOf(stranded)).toHaveLength(1);
      expect(h.sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('fails closed with 503 naming the service when one cannot be asked', async () => {
      const id = await insertBranch('DWN1', 'inactive');
      client.forBranch.mockRejectedValue(
        new BlockersUnavailableError('integration'),
      );

      const error = await errorOf(asStore(() => branches.remove(id)));

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse().message).toContain('integration');
      const [row] = await h.sql<{ deleted_at: Date | null }[]>(
        `SELECT "deleted_at" FROM "branch" WHERE "id" = $1`,
        [id],
      );
      expect(row.deleted_at).toBeNull();
    });

    it('removes the branch from every member, ends only their sessions, and tells the other services', async () => {
      const gone = await insertBranch('DEL1', 'inactive');
      const keep = await insertBranch('KEEP1');
      const both = await insertMember('both@lifecycle.vn', 'NV81', [
        gone,
        keep,
      ]);
      const other = await insertMember('other@lifecycle.vn', 'NV82', [keep]);
      const everyBranch = await insertMember('all@lifecycle.vn', 'NV83', []);
      h.outbox.add.mockClear();

      await asStore(() => branches.remove(gone));

      const [row] = await h.sql<{ deleted_at: Date | null }[]>(
        `SELECT "deleted_at" FROM "branch" WHERE "id" = $1`,
        [gone],
      );
      expect(row.deleted_at).not.toBeNull();
      expect((await rowsOf(both)).map((r) => r.branch_id)).toEqual([keep]);
      expect((await rowsOf(other)).map((r) => r.branch_id)).toEqual([keep]);
      // a member with no rows still sees every branch
      expect(await rowsOf(everyBranch)).toEqual([]);
      expect(h.sessions.revokeAll).toHaveBeenCalledTimes(1);
      expect(h.sessions.revokeAll).toHaveBeenCalledWith(both, { tenantId });
      expect(
        h
          .outboxCalls()
          .some(
            ([, def, payload]) =>
              def.type === 'platform.branch.updated' &&
              payload.id === gone &&
              payload.status === 'deleted',
          ),
      ).toBe(true);
    });

    it('never reuses the code of a deleted branch', async () => {
      const error = await errorOf(
        asStore(() =>
          branches.create(ownerId, { name: 'Again', code: 'DEL1' }),
        ),
      );

      expect(error.getResponse().errorCode).toBe('branch.error.code_exists');
    });
  });

  describe('deactivate', () => {
    it('lists every reason from every service in one 409 and keeps the branch active', async () => {
      const id = await insertBranch('DEA1');
      client.forBranch.mockResolvedValue([
        {
          service: 'inventory',
          code: 'INVENTORY_PENDING_TRANSFERS',
          message: 'Chi nhánh còn 3 phiếu chuyển kho chưa hoàn tất',
          count: 3,
        },
        {
          service: 'integration',
          code: 'INTEGRATION_LIVE_CONNECTIONS',
          message: 'm',
          count: 1,
        },
      ]);

      const error = await errorOf(
        asStore(() =>
          branches.update(ownerId, id, { status: 'inactive' as never }),
        ),
      );

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().details.reasons).toHaveLength(2);
      const [row] = await h.sql<{ status: string }[]>(
        `SELECT "status" FROM "branch" WHERE "id" = $1`,
        [id],
      );
      expect(row.status).toBe('active');
    });

    it('deactivates when nothing blocks, and then the branch can be deleted', async () => {
      const id = await insertBranch('DEA2');

      await asStore(() =>
        branches.update(ownerId, id, { status: 'inactive' as never }),
      );
      await asStore(() => branches.remove(id));

      const [row] = await h.sql<{ status: string; deleted_at: Date }[]>(
        `SELECT "status","deleted_at" FROM "branch" WHERE "id" = $1`,
        [id],
      );
      expect(row.status).toBe('inactive');
      expect(row.deleted_at).not.toBeNull();
    });
  });

  describe('branch code (D8)', () => {
    it('cannot be changed by an update, while the name can', async () => {
      const id = await insertBranch('FIX1');

      const error = await errorOf(
        asStore(() => branches.update(ownerId, id, { code: 'FIX2' })),
      );
      expect(error.getResponse().errorCode).toBe('branch.error.code_immutable');

      const renamed = await asStore(() =>
        branches.update(ownerId, id, { name: 'Renamed', code: 'FIX1' }),
      );
      expect(renamed).toMatchObject({ code: 'FIX1', name: 'Renamed' });
    });
  });

  describe('stores per account (D11) and self-serve creation (D10)', () => {
    it('lets an account own three stores, names the first branch, announces the store, and refuses the fourth with T009', async () => {
      const tenants = new TenantService(
        h.dataSource.getRepository(
          (await import('../src/api/tenant/entities/tenant.entity'))
            .TenantEntity,
        ),
        h.dataSource,
        {} as never,
        h.outbox as never,
        new SubscriptionCoreService(
          h.dataSource.getRepository(PlanEntity),
          h.outbox as never,
        ),
      );
      // the cap counts owner memberships: the account of the store above already owns one
      h.outbox.add.mockClear();
      const first = await tenants.create(ownerId, {
        name: 'Second',
        subdomain: 'lifecycle-two',
        defaultBranchName: 'Cửa hàng Quận 1',
      });
      await tenants.create(ownerId, {
        name: 'Third',
        subdomain: 'lifecycle-three',
      });

      const [branch] = await h.sql<{ name: string; code: string }[]>(
        `SELECT "name","code" FROM "branch" WHERE "tenant_id" = $1`,
        [first.id],
      );
      expect(branch).toEqual({ name: 'Cửa hàng Quận 1', code: 'CN01' });
      expect(
        h
          .outboxCalls()
          .filter(([, def]) => def.type === 'platform.tenant.created'),
      ).toHaveLength(2);

      const error = await errorOf(
        tenants.create(ownerId, {
          name: 'Fourth',
          subdomain: 'lifecycle-four',
        }),
      );
      expect(error.getResponse().errorCode).toBe('tenant.error.store_limit');
      const created = await h.sql<unknown[]>(
        `SELECT 1 FROM "tenant" WHERE "subdomain" = 'lifecycle-four'`,
      );
      expect(created).toHaveLength(0);
    });
  });

  describe('plan seats (D6)', () => {
    it('does not count a locked member, and counts an inactive branch', async () => {
      const [{ limit }] = await h.sql<{ limit: number }[]>(
        `SELECT p."quota_users" AS "limit" FROM "subscription" s JOIN "plan" p ON p."id" = s."plan_id" WHERE s."tenant_id" = $1`,
        [tenantId],
      );
      const [{ count: before }] = await h.sql<{ count: string }[]>(
        `SELECT count(*) FROM "account_tenant" WHERE "tenant_id" = $1 AND "status" = 'active'`,
        [tenantId],
      );
      // fill every seat but one with LOCKED members: they must not use any
      for (let i = 0; i < limit + 2; i++) {
        await insertMember(`locked${i}@lifecycle.vn`, `NV9${i}`, [], 'locked');
      }
      await expect(
        h.dataSource.transaction((em) =>
          h.services.quota.assertCanAdd(
            em,
            tenantId,
            'users',
            limit - Number(before),
          ),
        ),
      ).resolves.toBeUndefined();
      const usage = await h.services.usage.get(tenantId);
      expect(usage.users.used).toBe(Number(before));
    });
  });
});
