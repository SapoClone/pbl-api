import { PlanEntity, PlanStatus } from './entities/plan.entity';
import { StoreSubscriptionService } from './store-subscription.service';

jest.mock('./usage', () => ({
  ...jest.requireActual('./usage'),
  usageSql: () => 'SELECT 1 AS tenant_id',
}));

const plan = (over: Partial<PlanEntity> = {}) =>
  ({
    id: 'p1',
    code: 'free',
    name: 'Free',
    description: null,
    priceMonthly: 0,
    isFeatured: false,
    status: PlanStatus.ACTIVE,
    quotaBranches: 1,
    quotaUsers: 3,
    quotaProducts: 100,
    quotaStorageMb: 1024,
    ...over,
  }) as PlanEntity;

function build(opts: {
  subscription?: unknown;
  usage?: Record<string, number>;
  plans?: PlanEntity[];
}) {
  const builder: Record<string, jest.Mock> = {};
  for (const n of ['innerJoinAndSelect', 'where', 'andWhere']) {
    builder[n] = jest.fn(() => builder);
  }
  builder.getOne = jest.fn().mockResolvedValue(opts.subscription ?? null);
  const dataSource = {
    query: jest.fn().mockResolvedValue(opts.usage ? [opts.usage] : []),
    entityMetadatas: [],
  };
  const plans = {
    find: jest.fn().mockResolvedValue(opts.plans ?? []),
    findOneByOrFail: jest.fn().mockResolvedValue(plan()),
  };
  const subscriptions = { createQueryBuilder: () => builder };
  const service = new StoreSubscriptionService(
    dataSource as never,
    plans as never,
    subscriptions as never,
  );
  return { service, builder, plans, dataSource };
}

describe('StoreSubscriptionService', () => {
  it('lists only active plans, cheapest first, with storage in GB', async () => {
    const { service, plans } = build({
      plans: [plan({ quotaStorageMb: 2048 })],
    });
    const res = await service.listPlans();
    expect(plans.find).toHaveBeenCalledWith({
      where: { status: PlanStatus.ACTIVE },
      order: { priceMonthly: 'ASC', code: 'ASC' },
    });
    expect(res.data[0].quotas).toEqual({
      branches: 1,
      users: 3,
      products: 100,
      storageGb: 2,
    });
  });

  it('falls back to the free plan for a store without a subscription', async () => {
    const { service } = build({});
    const res = await service.current('t1');
    expect(res.id).toBeNull();
    expect(res.plan.code).toBe('free');
    expect(res.status).toBe('active');
    expect(res.usage.every((l) => l.used === 0 && l.ok)).toBe(true);
    expect(res.warning).toBe('normal');
  });

  it('reports usage against the subscribed plan and its warning', async () => {
    const { service, dataSource } = build({
      subscription: {
        id: 's1',
        code: 'SUB1',
        status: 'active',
        billingCycle: 'monthly',
        startedAt: new Date(),
        expiresAt: null,
        plan: plan({ code: 'pro', name: 'Pro', quotaBranches: 5 }),
      },
      usage: {
        branches_used: 5,
        users_used: 1,
        products_used: 0,
        storage_mb_used: 0,
      },
    });
    const res = await service.current('t1');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['t1']);
    expect(res.plan.code).toBe('pro');
    expect(res.usage[0]).toEqual({
      key: 'branches',
      used: 5,
      limit: 5,
      ok: true,
    });
    expect(res.warning).toBe('at_limit');
  });
});
