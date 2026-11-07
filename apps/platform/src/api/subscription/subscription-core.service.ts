import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PLATFORM_SUBSCRIPTION_CHANGED,
  SubscriptionChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { EntityManager, Repository } from 'typeorm';
import { DEFAULT_PLANS, FREE_PLAN_CODE } from './default-plans';
import { PlanEntity, PlanStatus } from './entities/plan.entity';
import {
  SubscriptionActorType,
  SubscriptionEventEntity,
  SubscriptionEventType,
} from './entities/subscription-event.entity';
import {
  BillingCycle,
  SubscriptionEntity,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { issueCode } from './issue-code';

export type SubscriptionActor = {
  type: SubscriptionActorType;
  id?: string | null;
};

/** What every flow that opens a store needs: its first subscription and its usage row. */
@Injectable()
export class SubscriptionCoreService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionCoreService.name);

  constructor(
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    private readonly outbox: EventOutbox,
  ) {}

  /**
   * The seeded plans exist after the migration; the entity-synchronised local stack has none, so an empty table is
   * filled once (never touched when any plan exists, so an admin's edits and deletions of defaults survive).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if ((await this.plans.count()) > 0) return;
      await this.plans.insert(
        DEFAULT_PLANS.map((p) => ({
          ...p,
          status: PlanStatus.ACTIVE,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })),
      );
      this.logger.log('Seeded the default plans');
    } catch (err) {
      this.logger.error(`Could not seed the default plans: ${String(err)}`);
    }
  }

  /**
   * Opens a store's first subscription on a plan, with its `created` event and usage row. `free` never expires; a paid
   * plan runs one month from now (the admin dates it properly with a change of plan). A hidden plan is refused (P001)
   * unless the caller is the self-serve flow, which always starts on `free`.
   */
  async start(
    em: EntityManager,
    tenantId: string,
    planCode: string,
    actor: SubscriptionActor,
    options: {
      allowHidden?: boolean;
      /** What the plan event says: `created` for a store's first plan, `expired` for the fall back to `free` */
      eventType?: 'created' | 'expired';
      fromPlan?: string | null;
    } = {},
  ): Promise<SubscriptionEntity> {
    const plan = await em.findOneBy(PlanEntity, { code: planCode });
    if (!plan || (!options.allowHidden && plan.status !== PlanStatus.ACTIVE)) {
      throw new ValidationException(ErrorCode.P001);
    }
    const actorId = actor.id ?? SYSTEM_USER_ID;
    const startedAt = new Date();
    const expiresAt =
      plan.priceMonthly === 0
        ? null
        : new Date(
            Date.UTC(
              startedAt.getUTCFullYear(),
              startedAt.getUTCMonth() + 1,
              startedAt.getUTCDate(),
              startedAt.getUTCHours(),
              startedAt.getUTCMinutes(),
              startedAt.getUTCSeconds(),
            ),
          );
    const subscription = await em.save(
      new SubscriptionEntity({
        code: await issueCode(em, SubscriptionEntity, 'SUB-', 4),
        tenantId,
        planId: plan.id,
        billingCycle: BillingCycle.MONTHLY,
        status: SubscriptionStatus.ACTIVE,
        startedAt,
        expiresAt,
        createdBy: actorId,
        updatedBy: actorId,
      }),
    );
    await em.save(
      new SubscriptionEventEntity({
        subscriptionId: subscription.id,
        tenantId,
        eventType: SubscriptionEventType.CREATED,
        planCode: plan.code,
        effectiveUntil: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
        actorType: actor.type,
        actorId: actor.id ?? null,
      }),
    );
    await em
      .createQueryBuilder()
      .insert()
      .into(TenantUsageEntity)
      .values({ tenantId })
      .orIgnore()
      .execute();
    // catalog keeps the limits of every store, so a store's first plan is announced like a change of plan
    await this.outbox.add(
      em,
      PLATFORM_SUBSCRIPTION_CHANGED,
      {
        subscriptionId: subscription.id,
        tenantId,
        eventType: options.eventType ?? 'created',
        fromPlan: options.fromPlan ?? null,
        toPlan: plan.code,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        quotas: {
          branches: plan.quotaBranches,
          users: plan.quotaUsers,
          products: plan.quotaProducts,
          storageMb: plan.quotaStorageMb,
        },
        actor: {
          type: actor.type,
          id: actor.id ?? null,
        },
      } satisfies SubscriptionChangedPayload,
      { tenantId },
    );
    return subscription;
  }

  /** Every store starts on `free` (self-serve creation). */
  startFree(
    em: EntityManager,
    tenantId: string,
    actor: SubscriptionActor,
  ): Promise<SubscriptionEntity> {
    return this.start(em, tenantId, FREE_PLAN_CODE, actor, {
      allowHidden: true,
    });
  }
}
