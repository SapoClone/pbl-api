import { ErrorCode } from '@/constants/error-code.constant';
import { ConflictCodeException } from '@/exceptions/coded.exception';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { FREE_PLAN_CODE } from './default-plans';
import { PlanEntity } from './entities/plan.entity';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  SubscriptionEntity,
} from './entities/subscription.entity';

/** The keys platform itself can enforce: it owns branches and members (catalog enforces products and storage) */
export type PlatformQuotaKey = 'branches' | 'users';

const LABEL: Record<PlatformQuotaKey, string> = {
  branches: 'chi nhánh',
  users: 'người dùng',
};

/**
 * Plan limits at the moment a store adds something (platform admin design, "Quota enforcement"). Call it inside the
 * transaction that inserts the row: the advisory lock serialises two adds of the same store, so both cannot slip
 * through at limit - 1.
 */
@Injectable()
export class QuotaService {
  async assertCanAdd(
    em: EntityManager,
    tenantId: string,
    key: PlatformQuotaKey,
    adding = 1,
  ): Promise<void> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `quota:${tenantId}:${key}`,
    ]);
    const plan = await this.currentPlan(em, tenantId);
    // No plan at all (an entity-synchronised stack without seeds): nothing to enforce
    if (!plan) return;
    const limit = key === 'branches' ? plan.quotaBranches : plan.quotaUsers;
    const used =
      key === 'branches'
        ? await em.count(BranchEntity, { where: { tenantId } })
        : await em.count(AccountTenantEntity, { where: { tenantId } });
    if (used + adding <= limit) return;
    throw new ConflictCodeException(
      ErrorCode.Q001,
      `Gói ${plan.name} chỉ cho phép tối đa ${limit} ${LABEL[key]}. Hãy nâng cấp gói để thêm.`,
      { key, used, limit, planCode: plan.code },
    );
  }

  /** The plan of the store's current subscription, or `free` for a store that has none */
  private async currentPlan(
    em: EntityManager,
    tenantId: string,
  ): Promise<PlanEntity | null> {
    const subscription = await em
      .getRepository(SubscriptionEntity)
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.plan', 'p')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.status IN (:...statuses)', {
        statuses: CURRENT_SUBSCRIPTION_STATUSES,
      })
      .getOne();
    if (subscription?.plan) return subscription.plan;
    return em.findOneBy(PlanEntity, { code: FREE_PLAN_CODE });
  }
}
