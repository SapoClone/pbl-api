import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FREE_PLAN_CODE } from './default-plans';
import { PlanEntity, PlanStatus } from './entities/plan.entity';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  SubscriptionEntity,
} from './entities/subscription.entity';
import {
  QuotaLine,
  UsageRow,
  UsageWarning,
  evaluateQuotas,
  mbToGb,
  usageSql,
  warningOf,
} from './usage';

export type StorePlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  isFeatured: boolean;
  quotas: {
    branches: number;
    users: number;
    products: number;
    storageGb: number;
  };
};

export type CurrentSubscription = {
  /** Null for a store that has no subscription row yet and runs on the free plan */
  id: string | null;
  code: string | null;
  status: string;
  billingCycle: string | null;
  startedAt: Date | null;
  expiresAt: Date | null;
  plan: StorePlan;
  usage: QuotaLine[];
  warning: UsageWarning;
};

const toStorePlan = (p: PlanEntity): StorePlan => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description,
  priceMonthly: p.priceMonthly,
  isFeatured: p.isFeatured,
  quotas: {
    branches: p.quotaBranches,
    users: p.quotaUsers,
    products: p.quotaProducts,
    storageGb: mbToGb(p.quotaStorageMb),
  },
});

/** What a store sees of its own plan: the plan it is on, how much of it it uses, and the plans it could move to */
@Injectable()
export class StoreSubscriptionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
  ) {}

  /** Plans a store can choose from, cheapest first; hidden plans are for the platform admin only */
  async listPlans(): Promise<{ data: StorePlan[] }> {
    const rows = await this.plans.find({
      where: { status: PlanStatus.ACTIVE },
      order: { priceMonthly: 'ASC', code: 'ASC' },
    });
    return { data: rows.map(toStorePlan) };
  }

  async current(tenantId: string): Promise<CurrentSubscription> {
    const subscription = await this.subscriptions
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.plan', 'p')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.status IN (:...statuses)', {
        statuses: CURRENT_SUBSCRIPTION_STATUSES,
      })
      .getOne();
    const plan =
      subscription?.plan ??
      (await this.plans.findOneByOrFail({ code: FREE_PLAN_CODE }));
    const [row] = await this.dataSource.query(
      `SELECT u.* FROM (${usageSql(this.dataSource)}) u WHERE u.tenant_id = $1`,
      [tenantId],
    );
    const usage: UsageRow = row ?? {
      branches_used: 0,
      users_used: 0,
      products_used: 0,
      storage_mb_used: 0,
    };
    return {
      id: subscription?.id ?? null,
      code: subscription?.code ?? null,
      status: subscription?.status ?? 'active',
      billingCycle: subscription?.billingCycle ?? null,
      startedAt: subscription?.startedAt ?? null,
      expiresAt: subscription?.expiresAt ?? null,
      plan: toStorePlan(plan),
      usage: evaluateQuotas(usage, plan),
      warning: warningOf(usage, plan),
    };
  }
}
