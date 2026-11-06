/**
 * Plan limits at the moment a store adds a branch or a member, against a real Postgres in a throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 */
import { randomUUID } from 'crypto';
import { startAdminDb } from './support/admin-harness';

const ADMIN = randomUUID();

describe('plan limits (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  let tenantId: string;
  const assertCanAdd = (key: 'branches' | 'users') =>
    h.dataSource.transaction((em) =>
      h.services.quota.assertCanAdd(em, tenantId, key),
    );

  beforeAll(async () => {
    h = await startAdminDb('quota');
    await h.applyPlanMigration();
    const store = await h.services.tenants.create(ADMIN, {
      name: 'Quota store',
      subdomain: 'quota-store',
      owner: { name: 'Owner', email: 'owner@quota.vn' },
    });
    tenantId = store.id;
  });
  afterAll(() => h.stop());

  it('refuses a second branch on free with the facts the web needs (409 Q001)', async () => {
    await expect(assertCanAdd('branches')).rejects.toMatchObject({
      status: 409,
      response: {
        errorCode: 'quota.error.limit_reached',
        details: { key: 'branches', used: 1, limit: 1, planCode: 'free' },
      },
    });
  });

  it('allows members up to the limit, then refuses the next one', async () => {
    const [role] = await h.sql<{ id: string }[]>(
      `SELECT "id" FROM "role" WHERE "tenant_id" = $1 AND "code" = 'sales_staff'`,
      [tenantId],
    );
    for (const i of [0, 1]) {
      await assertCanAdd('users');
      const [{ id }] = await h.sql<{ id: string }[]>(
        `INSERT INTO "account" ("email","password","created_by","updated_by") VALUES ($1,'x','t','t') RETURNING "id"`,
        [`q${i}@quota.vn`],
      );
      await h.sql(
        `INSERT INTO "account_tenant" ("account_id","tenant_id","role","role_id","code") VALUES ($1,$2,'sales_staff',$3,$4)`,
        [id, tenantId, role.id, `NV9${i}`],
      );
    }
    // owner + 2 = 3 of 3
    await expect(assertCanAdd('users')).rejects.toMatchObject({
      status: 409,
      response: { details: { key: 'users', used: 3, limit: 3 } },
    });
  });

  it('allows a second branch once the admin moves the store to basic', async () => {
    await h.services.subscriptions.changePlan(ADMIN, {
      tenantId,
      planCode: 'basic',
      effectiveFrom: '2026-11-05',
      expiresAt: '2026-12-05',
    });
    await expect(assertCanAdd('branches')).resolves.toBeUndefined();
  });

  it('announces a store`s first plan, so catalog knows its limits from the start', () => {
    const created = h
      .outboxCalls()
      .filter(
        ([, def, payload]) =>
          def.type === 'platform.subscription.changed' &&
          payload.eventType === 'created',
      );
    expect(created).toHaveLength(1);
    expect(created[0][2]).toMatchObject({
      tenantId,
      toPlan: 'free',
      quotas: { branches: 1, users: 3, products: 100, storageMb: 1024 },
    });
    expect(created[0][3]).toEqual({ tenantId });
  });

  describe('usage reported by catalog', () => {
    const report = (products: number, storageMb: number, measuredAt: string) =>
      h.services.usageHandler.onCatalogUsage(
        {
          type: 'catalog.usage.changed',
          tenantId,
          payload: { products, storageMb, measuredAt },
        } as never,
        h.dataSource.manager,
      );
    const usageOf = () => h.services.usage.get(tenantId);

    it('shows the products and storage the event carries', async () => {
      await report(40, 512, '2999-01-01T00:00:00.000Z');
      expect(await usageOf()).toMatchObject({
        products: { used: 40, limit: 2000 },
        storageGb: { used: 0.5, limit: 10 },
      });
    });

    it('ignores an event measured before the one it already holds', async () => {
      await report(10, 100, '2998-01-01T00:00:00.000Z');
      expect(await usageOf()).toMatchObject({ products: { used: 40 } });
    });
  });
});
