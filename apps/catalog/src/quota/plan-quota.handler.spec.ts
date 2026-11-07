import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { PlanQuotaHandler } from './plan-quota.handler';

const envelope = (type: string, occurredAt: string, payload: object) =>
  ({
    id: 'e1',
    type,
    version: 1,
    occurredAt,
    tenantId: 'tenant-a',
    actor: null,
    traceId: 't',
    payload,
  }) as never;

const subscription = (occurredAt: string, toPlan = 'basic') =>
  envelope('platform.subscription.changed', occurredAt, {
    subscriptionId: 's1',
    tenantId: 'tenant-a',
    eventType: 'upgraded',
    fromPlan: 'free',
    toPlan,
    expiresAt: null,
    quotas: { branches: 2, users: 10, products: 2000, storageMb: 10240 },
    actor: { type: 'platform_admin', id: 'a1' },
  });

const planEdit = (occurredAt: string, code = 'basic') =>
  envelope('platform.plan.changed', occurredAt, {
    planId: 'p1',
    code,
    name: 'Basic',
    priceMonthly: 299000,
    status: 'active',
    quotas: { branches: 3, users: 12, products: 3000, storageMb: 20480 },
    updatedAt: occurredAt,
    actor: { type: 'platform_admin', id: 'a1' },
  });

describe('PlanQuotaHandler', () => {
  let repository: { findOne: jest.Mock; save: jest.Mock };
  const handler = new PlanQuotaHandler();
  const row = (planCode: string, changedAt: string) => ({
    tenantId: 'tenant-a',
    planCode,
    quotaProducts: 100,
    quotaStorageMb: 1024,
    sourceChangedAt: new Date(changedAt),
  });

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (r) => r),
    };
    jest
      .spyOn(TenantScopedRepository, 'forEntity')
      .mockReturnValue(repository as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const run = <T>(work: () => Promise<T>) =>
    RequestContext.run({ tenantId: 'tenant-a' }, work);

  it('stores the limits of the plan the store moved to', async () => {
    await run(() =>
      handler.onSubscriptionChanged(
        subscription('2026-11-05T10:00:00.000Z'),
        {} as never,
      ),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planCode: 'basic',
        quotaProducts: 2000,
        quotaStorageMb: 10240,
      }),
    );
  });

  it('ignores a plan event older than the row it holds', async () => {
    repository.findOne.mockResolvedValue(
      row('pro', '2026-11-06T00:00:00.000Z'),
    );
    await run(() =>
      handler.onSubscriptionChanged(
        subscription('2026-11-05T10:00:00.000Z'),
        {} as never,
      ),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('applies an edit of the plan the store is on', async () => {
    repository.findOne.mockResolvedValue(
      row('basic', '2026-11-01T00:00:00.000Z'),
    );
    await run(() =>
      handler.onPlanChanged(planEdit('2026-11-05T10:00:00.000Z'), {} as never),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ quotaProducts: 3000, quotaStorageMb: 20480 }),
    );
  });

  it('ignores the edit of a plan the store is not on, and a store with no row', async () => {
    repository.findOne.mockResolvedValue(
      row('free', '2026-11-01T00:00:00.000Z'),
    );
    await run(() =>
      handler.onPlanChanged(planEdit('2026-11-05T10:00:00.000Z'), {} as never),
    );
    repository.findOne.mockResolvedValue(null);
    await run(() =>
      handler.onPlanChanged(planEdit('2026-11-05T10:00:00.000Z'), {} as never),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });
});
