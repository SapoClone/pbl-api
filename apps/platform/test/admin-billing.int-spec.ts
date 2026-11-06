/**
 * The platform admin's plans, subscriptions and usage against a real Postgres, in a throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CreateAdminPlanReqDto,
  UpdateAdminPlanReqDto,
} from '../src/api/platform-admin/dto/admin-plan.req.dto';
import {
  ListAdminSubscriptionsReqDto,
  RecordPaymentReqDto,
} from '../src/api/platform-admin/dto/admin-subscription.req.dto';
import { ListAdminUsageReqDto } from '../src/api/platform-admin/dto/admin-usage.req.dto';
import { PaymentMethod } from '../src/api/subscription/entities/subscription-payment.entity';
import { startAdminDb } from './support/admin-harness';

const ADMIN = randomUUID();

describe('platform admin plans, subscriptions and usage (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    h.sql<T>(text, params);
  const stores: Record<string, { id: string; subscriptionId: string }> = {};

  const make = async (key: string, planCode?: string) => {
    const detail = await h.services.tenants.create(ADMIN, {
      name: `Store ${key}`,
      subdomain: `store-${key.toLowerCase()}`,
      owner: { name: `Owner ${key}`, email: `owner-${key.toLowerCase()}@x.vn` },
      planCode,
    });
    stores[key] = {
      id: detail.id,
      subscriptionId: detail.currentSubscription!.id,
    };
  };
  const addMembers = async (tenantId: string, count: number) => {
    const [role] = await sql<{ id: string }[]>(
      `SELECT "id" FROM "role" WHERE "tenant_id" = $1 AND "code" = 'sales_staff'`,
      [tenantId],
    );
    for (let i = 0; i < count; i++) {
      const [{ id }] = await sql<{ id: string }[]>(
        `INSERT INTO "account" ("email","password","created_by","updated_by") VALUES ($1,'x','t','t') RETURNING "id"`,
        [`m${i}-${tenantId.slice(0, 8)}@x.vn`],
      );
      await sql(
        `INSERT INTO "account_tenant" ("account_id","tenant_id","role","role_id","code") VALUES ($1,$2,'sales_staff',$3,$4)`,
        [id, tenantId, role.id, `NV9${i}`],
      );
    }
  };
  const listSubs = (over: Partial<ListAdminSubscriptionsReqDto> = {}) =>
    h.services.subscriptions.list(
      Object.assign(new ListAdminSubscriptionsReqDto(), over),
    );
  const usage = (over: Partial<ListAdminUsageReqDto> = {}) =>
    h.services.usage.list(Object.assign(new ListAdminUsageReqDto(), over));
  const payment = (over: Partial<RecordPaymentReqDto> = {}) =>
    Object.assign(new RecordPaymentReqDto(), {
      amount: 299000,
      method: PaymentMethod.TRANSFER,
      periodStart: '2030-01-01',
      periodEnd: '2030-02-01',
      ...over,
    });

  beforeAll(async () => {
    h = await startAdminDb('admin_bill');
    await h.applyPlanMigration();
    await sql(
      `INSERT INTO "platform_admin" ("id","email","name","role","created_by","updated_by") VALUES ($1,'lan@omni.vn','Lan Anh','super_admin','t','t')`,
      [ADMIN],
    );
    await make('A'); // free
    await make('B', 'basic');
    await make('C', 'pro');
  });

  afterAll(() => h.stop());
  beforeEach(() => jest.clearAllMocks());

  describe('plans', () => {
    it('lists the plans cheapest first with the stores on each, and filters by status', async () => {
      const { data } = await h.services.plans.list({});
      expect(data.map((p) => p.code)).toEqual(['free', 'basic', 'pro']);
      expect(data.map((p) => p.tenantCount)).toEqual([1, 1, 1]);
      expect(data[1]).toMatchObject({
        name: 'Basic',
        priceMonthly: 299000,
        status: 'active',
        isFeatured: false,
        quotas: { branches: 2, users: 10, products: 2000, storageGb: 10 },
      });
      expect(data[2].isFeatured).toBe(true);
      await expect(
        h.services.plans.list({ status: 'hidden' as never }),
      ).resolves.toEqual({ data: [] });
    });

    it('answers 404 for an unknown plan', async () => {
      await expect(h.services.plans.get(randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('creates a plan with decimal gigabytes stored as megabytes, and refuses a taken code (P002)', async () => {
      const dto = Object.assign(new CreateAdminPlanReqDto(), {
        code: 'enterprise',
        name: 'Enterprise',
        priceMonthly: 1499000,
        status: 'hidden',
        quotas: { branches: 20, users: 100, products: 50000, storageGb: 200.5 },
      });
      const created = await h.services.plans.create(ADMIN, dto);
      expect(created).toMatchObject({
        code: 'enterprise',
        status: 'hidden',
        quotas: { storageGb: 200.5 },
        tenantCount: 0,
      });
      await expect(
        sql(
          `SELECT "quota_storage_mb" FROM "plan" WHERE "code" = 'enterprise'`,
        ),
      ).resolves.toEqual([{ quota_storage_mb: 205312 }]);
      await expect(h.services.plans.create(ADMIN, dto)).rejects.toMatchObject({
        response: { errorCode: 'plan.error.code_exists' },
      });
      // a new plan has no stores, so nobody is told
      expect(h.outbox.add).not.toHaveBeenCalled();
    });

    it('edits a plan, counts the stores it puts over quota, and tells each store on it', async () => {
      const [basic] = await sql<{ id: string }[]>(
        `SELECT "id" FROM "plan" WHERE "code" = 'basic'`,
      );
      const saved = await h.services.plans.update(
        ADMIN,
        basic.id,
        Object.assign(new UpdateAdminPlanReqDto(), {
          name: 'Basic+',
          quotas: { branches: 0, storageGb: 0.5 },
        }),
      );
      expect(saved).toMatchObject({
        name: 'Basic+',
        code: 'basic',
        quotas: { branches: 0, users: 10, products: 2000, storageGb: 0.5 },
        // store B has one branch, which is over a limit of 0: the change is saved anyway
        affectedTenantsOverQuota: 1,
      });
      const events = h
        .outboxCalls()
        .filter((c) => c[1].type === 'platform.plan.changed');
      expect(events).toHaveLength(1);
      expect(events[0][3]).toEqual({ tenantId: stores.B.id });
      expect(events[0][2]).toMatchObject({
        code: 'basic',
        quotas: { branches: 0, storageMb: 512 },
        actor: { type: 'platform_admin', id: ADMIN },
      });
      // put it back for the tests below
      await h.services.plans.update(ADMIN, basic.id, {
        name: 'Basic',
        quotas: { branches: 2, storageGb: 10 },
      });
    });

    it('answers 404 when editing an unknown plan', async () => {
      await expect(
        h.services.plans.update(ADMIN, randomUUID(), { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('subscriptions', () => {
    it('lists one current subscription per store with counts and the payment status', async () => {
      const res = await listSubs();
      expect(res.data).toHaveLength(3);
      expect(res.counts).toEqual({
        all: 3,
        expiringSoon: 0,
        expired: 0,
        pastDue: 0,
      });
      const b = res.data.find((s) => s.tenant.id === stores.B.id)!;
      expect(b).toMatchObject({
        plan: { code: 'basic' },
        status: 'active',
        billingCycle: 'monthly',
        paymentStatus: null,
        isExpiringSoon: false,
        tenant: { name: 'Store B' },
      });
      expect(b.code).toMatch(/^SUB-\d{4}$/);
    });

    it('filters by plan, status, search and store, and keeps the counts to the base filters', async () => {
      expect((await listSubs({ planCode: 'pro' })).data).toHaveLength(1);
      expect((await listSubs({ q: 'store a' })).data).toHaveLength(1);
      const bySub = await listSubs({ q: 'SUB-0002' });
      expect(bySub.data.map((s) => s.tenant.id)).toEqual([stores.B.id]);
      expect(
        (await listSubs({ tenantId: stores.C.id })).data.map((s) => s.id),
      ).toEqual([stores.C.subscriptionId]);
      const expired = await listSubs({ status: 'expired' as never });
      expect(expired.data).toEqual([]);
      expect(expired.counts.all).toBe(3);
    });

    it('flags a subscription that ends within a week, and filters on it', async () => {
      await sql(
        `UPDATE "subscription" SET "expires_at" = now() + interval '3 days' WHERE "id" = $1`,
        [stores.C.subscriptionId],
      );
      const res = await listSubs({ isExpiringSoon: true });
      expect(res.data.map((s) => s.id)).toEqual([stores.C.subscriptionId]);
      expect(res.data[0].isExpiringSoon).toBe(true);
      expect(res.counts.expiringSoon).toBe(1);
      await sql(
        `UPDATE "subscription" SET "expires_at" = now() + interval '20 days' WHERE "id" = $1`,
        [stores.C.subscriptionId],
      );
    });

    it('shows the detail with its history, naming who did what', async () => {
      const detail = await h.services.subscriptions.get(
        stores.B.subscriptionId,
      );
      expect(detail).toMatchObject({
        id: stores.B.subscriptionId,
        tenant: { id: stores.B.id, name: 'Store B' },
        plan: { code: 'basic', priceMonthly: 299000 },
        currentPayment: null,
      });
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0]).toMatchObject({
        eventType: 'created',
        planCode: 'basic',
        actor: { type: 'platform_admin', name: 'Lan Anh' },
      });
      await expect(
        h.services.subscriptions.get(randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('records a payment: it renews the subscription to the end of the period (store time)', async () => {
      const saved = await h.services.subscriptions.recordPayment(
        ADMIN,
        stores.B.subscriptionId,
        payment({ note: 'CK Vietcombank' }),
      );
      expect(saved).toMatchObject({
        code: 'PAY-00001',
        status: 'paid',
        amount: 299000,
        periodStart: '2030-01-01',
        periodEnd: '2030-02-01',
      });
      const detail = await h.services.subscriptions.get(
        stores.B.subscriptionId,
      );
      // the end of 1 February in Vietnam (UTC+7)
      expect(detail.expiresAt).toBe('2030-02-01T16:59:59.000Z');
      expect(detail.currentPayment).toMatchObject({
        code: 'PAY-00001',
        amount: 299000,
        status: 'paid',
      });
      expect(detail.history[0]).toMatchObject({
        eventType: 'renewed',
        effectiveUntil: '2030-02-01',
      });
      const event = h
        .outboxCalls()
        .find((c) => c[1].type === 'platform.subscription.changed')!;
      expect(event[2]).toMatchObject({
        eventType: 'renewed',
        fromPlan: 'basic',
        toPlan: 'basic',
        expiresAt: '2030-02-01T16:59:59.000Z',
      });
      expect((await listSubs({ q: 'Store B' })).data[0].paymentStatus).toBe(
        'paid',
      );
    });

    it('refuses a payment that overlaps a paid period (S012) and accepts the next one', async () => {
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          stores.B.subscriptionId,
          payment({ periodStart: '2030-01-15', periodEnd: '2030-02-15' }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.payment_overlaps' },
      });
      const next = await h.services.subscriptions.recordPayment(
        ADMIN,
        stores.B.subscriptionId,
        payment({ periodStart: '2030-02-01', periodEnd: '2030-03-01' }),
      );
      expect(next.code).toBe('PAY-00002');
    });

    it('records an older period without moving the expiry or writing history', async () => {
      const before = await h.services.subscriptions.get(
        stores.B.subscriptionId,
      );
      await h.services.subscriptions.recordPayment(
        ADMIN,
        stores.B.subscriptionId,
        payment({ periodStart: '2020-01-01', periodEnd: '2020-02-01' }),
      );
      const after = await h.services.subscriptions.get(stores.B.subscriptionId);
      expect(after.expiresAt).toBe(before.expiresAt);
      expect(after.history).toHaveLength(before.history.length);
    });

    it('rejects a period that ends before it starts (422) and an unknown subscription (404)', async () => {
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          stores.B.subscriptionId,
          payment({ periodStart: '2030-02-01', periodEnd: '2030-02-01' }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        h.services.subscriptions.recordPayment(ADMIN, randomUUID(), payment()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('pages the history', async () => {
      const page = await h.services.subscriptions.listEvents(
        stores.B.subscriptionId,
        Object.assign(new ListAdminSubscriptionsReqDto(), {
          limit: 1,
          page: 1,
        }),
      );
      expect(page.data).toHaveLength(1);
      expect(page.pagination.totalRecords).toBe(3); // created, and two renewals
      expect(page.pagination.nextPage).toBe(2);
    });
  });

  describe('change of plan', () => {
    beforeAll(async () => {
      // store C (pro) now uses 4 members and 2 GB: too much for free, fine for basic
      await addMembers(stores.C.id, 3);
      await sql(
        `UPDATE "tenant_usage" SET "storage_mb_used" = 2048, "products_used" = 150 WHERE "tenant_id" = $1`,
        [stores.C.id],
      );
    });
    const body = (planCode: string, over = {}) => ({
      tenantId: stores.C.id,
      planCode,
      effectiveFrom: '2026-11-05',
      expiresAt: '2026-12-05',
      ...over,
    });

    it('checks usage against the target plan without writing anything', async () => {
      const free = await h.services.subscriptions.checkChangePlan(body('free'));
      expect(free.allowed).toBe(false);
      expect(free.quotas).toEqual([
        { key: 'branches', used: 1, limit: 1, ok: true },
        { key: 'users', used: 4, limit: 3, ok: false },
        { key: 'products', used: 150, limit: 100, ok: false },
        { key: 'storageGb', used: 2, limit: 1, ok: false },
      ]);
      expect(free.blockingReason).toBe(
        'Doanh nghiệp đang sử dụng 4 / 3 người dùng của gói Free.',
      );
      const basic = await h.services.subscriptions.checkChangePlan(
        body('basic'),
      );
      expect(basic).toMatchObject({ allowed: true, blockingReason: null });
      expect(h.outbox.add).not.toHaveBeenCalled();
      const [sub] = await sql<{ plan_code: string }[]>(
        `SELECT p."code" AS plan_code FROM "subscription" s JOIN "plan" p ON p."id" = s."plan_id" WHERE s."id" = $1`,
        [stores.C.subscriptionId],
      );
      expect(sub.plan_code).toBe('pro');
    });

    it('refuses a plan the usage does not fit (S010) and changes nothing', async () => {
      await expect(
        h.services.subscriptions.changePlan(ADMIN, body('free')),
      ).rejects.toMatchObject({
        response: {
          errorCode: 'subscription.error.quota_exceeded',
          message: 'Doanh nghiệp đang sử dụng 4 / 3 người dùng của gói Free.',
        },
      });
      expect(h.outbox.add).not.toHaveBeenCalled();
    });

    it('downgrades in place: one subscription, a new event, a new period', async () => {
      const detail = await h.services.subscriptions.changePlan(
        ADMIN,
        body('basic', { note: 'Hạ cấp theo yêu cầu' }),
      );
      expect(detail).toMatchObject({
        id: stores.C.subscriptionId,
        plan: { code: 'basic' },
        status: 'active',
        expiresAt: '2026-12-05T16:59:59.000Z',
      });
      expect(detail.history[0]).toMatchObject({
        eventType: 'downgraded',
        planCode: 'basic',
        effectiveUntil: '2026-12-05',
        actor: { type: 'platform_admin', name: 'Lan Anh' },
      });
      expect((await listSubs({ tenantId: stores.C.id })).data).toHaveLength(1);
      const event = h
        .outboxCalls()
        .find((c) => c[1].type === 'platform.subscription.changed')!;
      expect(event[2]).toMatchObject({
        eventType: 'downgraded',
        fromPlan: 'pro',
        toPlan: 'basic',
        quotas: { branches: 2, users: 10, products: 2000, storageMb: 10240 },
      });
      expect(event[3]).toEqual({ tenantId: stores.C.id });
    });

    it('refuses the same plan for the same period (S011)', async () => {
      await expect(
        h.services.subscriptions.changePlan(ADMIN, body('basic')),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.same_plan_same_period' },
      });
    });

    it('upgrades, and renews when the plan stays and the period moves', async () => {
      const up = await h.services.subscriptions.changePlan(ADMIN, body('pro'));
      expect(up.history[0].eventType).toBe('upgraded');
      const renewed = await h.services.subscriptions.changePlan(
        ADMIN,
        body('pro', { expiresAt: '2027-01-05' }),
      );
      expect(renewed.history[0]).toMatchObject({
        eventType: 'renewed',
        effectiveUntil: '2027-01-05',
      });
      expect(renewed.history.map((e) => e.eventType)).toEqual([
        'renewed',
        'upgraded',
        'downgraded',
        'created',
      ]);
    });

    it('refuses an unknown or hidden plan (P001), an unknown store (404) and a backwards period (422)', async () => {
      for (const planCode of ['enterprise', 'nope']) {
        await expect(
          h.services.subscriptions.changePlan(ADMIN, body(planCode)),
        ).rejects.toMatchObject({
          response: { errorCode: 'plan.error.not_active' },
        });
      }
      await expect(
        h.services.subscriptions.changePlan(
          ADMIN,
          body('basic', { tenantId: randomUUID() }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.services.subscriptions.checkChangePlan(
          body('basic', { expiresAt: '2026-11-05' }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('usage', () => {
    beforeAll(async () => {
      await make('D', 'basic');
      await sql(
        `UPDATE "tenant_usage" SET "products_used" = 1900 WHERE "tenant_id" = $1`,
        [stores.D.id],
      );
    });

    it('warns at 90% and at 100% of the fullest key, and lists the fullest first', async () => {
      const all = await usage();
      const warning = (key: string) =>
        all.data.find((u) => u.tenant.name === `Store ${key}`)!.warning;
      expect(warning('A')).toBe('at_limit'); // free: 1 of 1 branch
      expect(warning('D')).toBe('near_limit'); // 1900 of 2000 products
      expect(warning('B')).toBe('normal'); // 1 of 2 branches
      expect(all.data[0].warning).toBe('at_limit');
      const order = all.data.map((u) => u.warning);
      expect(order).toEqual(
        [...order].sort(
          (a, b) =>
            ['at_limit', 'near_limit', 'normal'].indexOf(a) -
            ['at_limit', 'near_limit', 'normal'].indexOf(b),
        ),
      );
    });

    it('filters by warning, plan and name', async () => {
      const near = await usage({ warning: 'near_limit' as never });
      expect(near.data.map((u) => u.tenant.name)).toEqual(['Store D']);
      expect(near.pagination.totalRecords).toBe(1);
      const free = await usage({ planCode: 'free' });
      expect(free.data.every((u) => u.plan.code === 'free')).toBe(true);
      const byName = await usage({ q: 'store b' });
      expect(byName.data.map((u) => u.tenant.name)).toEqual(['Store B']);
    });

    it('shows the limits with storage in gigabytes, and the detail of one store', async () => {
      const d = await h.services.usage.get(stores.D.id);
      expect(d).toMatchObject({
        tenant: { name: 'Store D' },
        plan: { code: 'basic' },
        branches: { used: 1, limit: 2 },
        users: { used: 1, limit: 10 },
        products: { used: 1900, limit: 2000 },
        storageGb: { used: 0, limit: 10 },
        warning: 'near_limit',
      });
      expect(d.enforcement).toEqual(expect.any(String));
      const c = await h.services.usage.get(stores.C.id);
      expect(c.storageGb.used).toBe(2);
      await expect(h.services.usage.get(randomUUID())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
