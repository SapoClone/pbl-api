/**
 * Plan expiry, grace and the payment rules (D31, D33) against a real Postgres, in a throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`.
 */
import { randomUUID } from 'crypto';
import { RecordPaymentReqDto } from '../src/api/platform-admin/dto/admin-subscription.req.dto';
import { PlatformSettingReader } from '../src/api/platform-setting/platform-setting.reader';
import { PlanEntity } from '../src/api/subscription/entities/plan.entity';
import { PaymentMethod } from '../src/api/subscription/entities/subscription-payment.entity';
import { SubscriptionCoreService } from '../src/api/subscription/subscription-core.service';
import { SubscriptionExpiryJob } from '../src/api/subscription/subscription-expiry.job';
import { AllowPastDueSubscriptionEvent1793100000400 } from '../src/database/migrations/1793100000400-allow-past-due-subscription-event';
import { startAdminDb } from './support/admin-harness';

const ADMIN = randomUUID();
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2031-03-10T05:00:00.000Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

describe('subscription expiry, grace and payments (Postgres)', () => {
  let h: Awaited<ReturnType<typeof startAdminDb>>;
  let now = T0;
  let settings: PlatformSettingReader;
  let job: SubscriptionExpiryJob;
  const stores: Record<string, { id: string; subscriptionId: string }> = {};
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    h.sql<T>(text, params);

  const jobOn = () =>
    new SubscriptionExpiryJob(
      h.dataSource,
      new SubscriptionCoreService(
        h.dataSource.getRepository(PlanEntity),
        h.outbox as never,
      ),
      h.outbox as never,
      settings,
      () => now,
    );
  const make = async (key: string, planCode?: string) => {
    const detail = await h.services.tenants.create(ADMIN, {
      name: `Store ${key}`,
      subdomain: `exp-${key.toLowerCase()}`,
      owner: { name: `Owner ${key}`, email: `owner-exp-${key}@x.vn` },
      planCode,
    });
    stores[key] = {
      id: detail.id,
      subscriptionId: detail.currentSubscription!.id,
    };
  };
  const endsAt = (key: string, date: Date) =>
    sql(`UPDATE "subscription" SET "expires_at" = $2 WHERE "id" = $1`, [
      stores[key].subscriptionId,
      date,
    ]);
  const rows = (key: string) =>
    sql<
      { id: string; status: string; code: string; expires_at: Date | null }[]
    >(
      `SELECT s."id", s."status", p."code", s."expires_at" FROM "subscription" s
       JOIN "plan" p ON p."id" = s."plan_id" WHERE s."tenant_id" = $1 ORDER BY s."created_at"`,
      [stores[key].id],
    );
  const changed = () =>
    h
      .outboxCalls()
      .filter((c) => c[1].type === 'platform.subscription.changed')
      .map((c) => c[2]);
  const payment = (over: Partial<RecordPaymentReqDto> = {}) =>
    Object.assign(new RecordPaymentReqDto(), {
      amount: 299000,
      method: PaymentMethod.TRANSFER,
      periodStart: '2031-04-01',
      periodEnd: '2031-05-01',
      ...over,
    });

  beforeAll(async () => {
    h = await startAdminDb('sub_exp');
    await h.applyPlanMigration();
    const runner = h.dataSource.createQueryRunner();
    const migration = new AllowPastDueSubscriptionEvent1793100000400();
    await migration.up(runner);
    // reversible: down and up again leave the constraint in place
    await migration.down(runner);
    await migration.up(runner);
    await runner.release();
    await sql(
      `INSERT INTO "platform_admin" ("id","email","name","role","created_by","updated_by") VALUES ($1,'e@omni.vn','E','super_admin','t','t')`,
      [ADMIN],
    );
    settings = new PlatformSettingReader(h.dataSource);
    job = jobOn();
    await make('FREE'); // free
    await make('P', 'basic'); // dies at day 0
    await make('R', 'basic'); // renewed in grace
    await make('L', 'basic'); // long overdue
    for (const k of ['P', 'R', 'L']) await endsAt(k, at(0));
    await endsAt('L', at(-30));
  });

  afterAll(() => h.stop());
  beforeEach(() => jest.clearAllMocks());

  it('day -1: only the long overdue store moves (past due and, beyond the grace, closed in one round)', async () => {
    now = at(-1);
    await expect(job.run()).resolves.toMatchObject({ pastDue: 1, expired: 1 });
    expect((await rows('P'))[0].status).toBe('active');
    expect(await rows('L')).toMatchObject([
      { status: 'expired', code: 'basic' },
      { status: 'active', code: 'free' },
    ]);
  });

  it('day 0, at the end: a paid plan goes past due, keeps the plan, and says so', async () => {
    now = at(0);
    await expect(job.run()).resolves.toMatchObject({ pastDue: 2, expired: 0 });
    expect(await rows('P')).toMatchObject([
      { status: 'past_due', code: 'basic' },
    ]);
    const events = changed().filter((e) => e.tenantId === stores.P.id);
    expect(events).toMatchObject([
      { eventType: 'past_due', toPlan: 'basic', quotas: { products: 2000 } },
    ]);
    const history = await sql<{ event_type: string; actor_type: string }[]>(
      `SELECT "event_type","actor_type" FROM "subscription_event" WHERE "subscription_id" = $1 ORDER BY "created_at"`,
      [stores.P.subscriptionId],
    );
    expect(history.map((e) => e.event_type)).toEqual(['created', 'past_due']);
    expect(history[1].actor_type).toBe('system');
  });

  it('keeps the paid limits for the grace: platform still counts the plan as current on day 6', async () => {
    now = at(6);
    await expect(job.run()).resolves.toMatchObject({ pastDue: 0, expired: 0 });
    expect((await rows('P'))[0].status).toBe('past_due');
  });

  it('a payment during the grace renews the same subscription to active', async () => {
    const before = await rows('R');
    await h.services.subscriptions.recordPayment(
      ADMIN,
      stores.R.subscriptionId,
      payment({ periodStart: '2031-03-10', periodEnd: '2031-04-10' }),
    );
    const after = await rows('R');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0].id, status: 'active' });
    expect(changed().pop()).toMatchObject({
      eventType: 'renewed',
      tenantId: stores.R.id,
    });
  });

  it('after the grace it closes the subscription and starts free, announced as expired', async () => {
    now = at(7);
    await expect(job.run()).resolves.toMatchObject({ pastDue: 0, expired: 1 });
    expect(await rows('P')).toMatchObject([
      { status: 'expired', code: 'basic' },
      { status: 'active', code: 'free', expires_at: null },
    ]);
    const events = changed().filter((e) => e.tenantId === stores.P.id);
    expect(events).toMatchObject([
      {
        eventType: 'expired',
        fromPlan: 'basic',
        toPlan: 'free',
        actor: { type: 'system' },
      },
    ]);
    expect(events[0].quotas.products).toBe(100);
    // the renewed store is untouched and the closed ones keep their data (nothing is deleted)
    expect((await rows('R'))[0].status).toBe('active');
    expect(
      await sql(`SELECT 1 FROM "tenant" WHERE "id" = $1`, [stores.P.id]),
    ).toHaveLength(1);
  });

  it('is idempotent: running again changes nothing and emits nothing', async () => {
    jest.clearAllMocks();
    await expect(job.run()).resolves.toMatchObject({ pastDue: 0, expired: 0 });
    expect(changed()).toHaveLength(0);
    expect(await rows('P')).toHaveLength(2);
  });

  it('never touches a free plan, however late the clock', async () => {
    now = at(4000);
    const before = await rows('FREE');
    await job.run();
    await job.run();
    expect(await rows('FREE')).toEqual(before);
    expect(before).toMatchObject([
      { status: 'active', code: 'free', expires_at: null },
    ]);
  });

  it('two instances at once: exactly one does the work', async () => {
    now = at(0);
    await make('X', 'basic');
    await endsAt('X', at(-1));
    await sql(`DELETE FROM "platform_setting"`);
    const results = await Promise.all([jobOn().run(), jobOn().run()]);
    expect(results.filter((r) => r.skipped)).toHaveLength(1);
    expect(results.reduce((n, r) => n + r.pastDue, 0)).toBe(1);
    expect((await rows('X'))[0].status).toBe('past_due');
  });

  it('reads the grace length from the platform setting billing.graceDays', async () => {
    await h.services.settings.update(ADMIN, { billing: { graceDays: 2 } });
    settings.invalidate();
    now = at(2);
    await expect(job.run()).resolves.toMatchObject({ expired: 1 });
    expect((await rows('X')).map((r) => r.status)).toEqual([
      'expired',
      'active',
    ]);
  });

  describe('payments', () => {
    beforeAll(() => make('Q', 'basic'));
    it('is refused on a free subscription (S013)', async () => {
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          stores.FREE.subscriptionId,
          payment({ amount: 0 }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.payment_not_allowed' },
      });
    });

    it('is refused on a closed subscription and never reopens it (S013)', async () => {
      const [closed] = await rows('P');
      await expect(
        h.services.subscriptions.recordPayment(ADMIN, closed.id, payment()),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.payment_not_allowed' },
      });
      expect((await rows('P'))[0].status).toBe('expired');
    });

    it('needs a note when the amount differs from price x months (S014), not otherwise', async () => {
      const id = stores.Q.subscriptionId;
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          id,
          payment({
            amount: 250000,
            periodStart: '2031-06-01',
            periodEnd: '2031-07-01',
          }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.payment_note_required' },
      });
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          id,
          payment({
            amount: 250000,
            note: 'discount',
            periodStart: '2031-06-01',
            periodEnd: '2031-07-01',
          }),
        ),
      ).resolves.toMatchObject({ amount: 250000, note: 'discount' });
      // two months at the plan price needs no note; a zero amount does
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          id,
          payment({
            amount: 598000,
            periodStart: '2031-07-01',
            periodEnd: '2031-09-01',
          }),
        ),
      ).resolves.toMatchObject({ amount: 598000 });
      await expect(
        h.services.subscriptions.recordPayment(
          ADMIN,
          id,
          payment({
            amount: 0,
            periodStart: '2031-09-01',
            periodEnd: '2031-10-01',
          }),
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'subscription.error.payment_note_required' },
      });
    });
  });

  describe('resync', () => {
    it('announces every current plan again, changes nothing, and can run twice', async () => {
      jest.clearAllMocks();
      const before = await sql(
        `SELECT "id","status","expires_at" FROM "subscription" ORDER BY "id"`,
      );
      const first = await h.services.subscriptions.resync();
      const second = await h.services.subscriptions.resync();
      const [{ n }] = await sql<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "subscription" WHERE "status" IN ('trialing','active','past_due')`,
      );
      expect(first.count).toBe(n);
      expect(second.count).toBe(n);
      const events = changed();
      expect(events).toHaveLength(2 * n);
      expect(events.every((e) => e.eventType === 'resync')).toBe(true);
      expect(events.find((e) => e.tenantId === stores.FREE.id)).toMatchObject({
        toPlan: 'free',
        quotas: { products: 100 },
      });
      expect(
        await sql(
          `SELECT "id","status","expires_at" FROM "subscription" ORDER BY "id"`,
        ),
      ).toEqual(before);
    });
  });
});
