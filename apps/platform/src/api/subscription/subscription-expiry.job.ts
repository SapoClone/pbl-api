import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  PLATFORM_SUBSCRIPTION_CHANGED,
  SubscriptionChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformSettingReader } from '../platform-setting/platform-setting.reader';
import { FREE_PLAN_CODE } from './default-plans';
import { PlanEntity } from './entities/plan.entity';
import {
  SubscriptionActorType,
  SubscriptionEventEntity,
  SubscriptionEventType,
} from './entities/subscription-event.entity';
import {
  SubscriptionEntity,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { SubscriptionCoreService } from './subscription-core.service';

/** Where the job gets "now" from; tests replace it with a fake clock */
export const SUBSCRIPTION_CLOCK = Symbol('SUBSCRIPTION_CLOCK');
export type SubscriptionClock = () => Date;

export const EXPIRY_JOB_EVERY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** One advisory lock for the whole job: of several instances, one runs and the rest skip the round */
const EXPIRY_LOCK_KEY = 'platform:subscription-expiry';

export type ExpiryRunResult = {
  skipped: boolean;
  pastDue: number;
  expired: number;
};

/**
 * Lets paid plans lapse (D31). A paid plan past `expires_at` goes to PAST_DUE and keeps its limits for `billing.graceDays`
 * days (default 7); after that the subscription is closed (EXPIRED) and the store starts a `free` one with no end date.
 * Nothing is deleted: the store keeps its data and the usual limit checks refuse what no longer fits. A payment during
 * the grace renews the same subscription (`AdminSubscriptionsService.recordPayment`). `free` has no end date and never
 * lapses. Running again changes nothing that was already changed.
 */
@Injectable()
export class SubscriptionExpiryJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SubscriptionExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly core: SubscriptionCoreService,
    private readonly outbox: EventOutbox,
    private readonly settings: PlatformSettingReader,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: SubscriptionClock,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), EXPIRY_JOB_EVERY_MS);
    this.timer.unref?.();
    void this.run();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<ExpiryRunResult> {
    try {
      return await this.dataSource.transaction(async (em) => {
        const [{ locked }] = await em.query(
          `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
          [EXPIRY_LOCK_KEY],
        );
        if (!locked) return { skipped: true, pastDue: 0, expired: 0 };
        const now = this.clock();
        const graceDays = await this.settings.graceDays(now.getTime());
        const pastDue = await this.movePastDue(em, now);
        const expired = await this.closeAfterGrace(em, now, graceDays);
        if (pastDue + expired > 0) {
          this.logger.log(
            `Subscriptions: ${pastDue} to past due, ${expired} closed after the grace`,
          );
        }
        return { skipped: false, pastDue, expired };
      });
    } catch (error) {
      this.logger.error(
        `Subscription expiry failed: ${error instanceof Error ? error.message : error}`,
      );
      return { skipped: true, pastDue: 0, expired: 0 };
    }
  }

  /** (a) ACTIVE, paid, past its end date: grace begins; limits stay those of the plan */
  private async movePastDue(em: EntityManager, now: Date): Promise<number> {
    const rows = await this.due(em, SubscriptionStatus.ACTIVE, now, 0);
    for (const sub of rows) {
      const plan = await em.findOneByOrFail(PlanEntity, {
        id: sub.planId as never,
      });
      sub.status = SubscriptionStatus.PAST_DUE;
      await em.save(sub);
      await this.record(em, sub, SubscriptionEventType.PAST_DUE, plan);
      await this.emit(em, sub, 'past_due', plan.code, plan);
    }
    return rows.length;
  }

  /** (b) PAST_DUE for longer than the grace: close it and start `free` */
  private async closeAfterGrace(
    em: EntityManager,
    now: Date,
    graceDays: number,
  ): Promise<number> {
    const rows = await this.due(
      em,
      SubscriptionStatus.PAST_DUE,
      now,
      graceDays,
    );
    for (const sub of rows) {
      const plan = await em.findOneByOrFail(PlanEntity, {
        id: sub.planId as never,
      });
      // the closed row first: the store has at most one current subscription
      sub.status = SubscriptionStatus.EXPIRED;
      await em.save(sub);
      await this.record(em, sub, SubscriptionEventType.EXPIRED, plan);
      // starts `free` (no end date) and announces it as `expired` so catalog drops to the free limits
      await this.core.start(
        em,
        sub.tenantId,
        FREE_PLAN_CODE,
        { type: SubscriptionActorType.SYSTEM },
        { allowHidden: true, eventType: 'expired', fromPlan: plan.code },
      );
    }
    return rows.length;
  }

  /** Locked rows of a status whose end date plus `graceDays` has passed, on a paid plan */
  private async due(
    em: EntityManager,
    status: SubscriptionStatus,
    now: Date,
    graceDays: number,
  ): Promise<SubscriptionEntity[]> {
    const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
    return em
      .getRepository(SubscriptionEntity)
      .createQueryBuilder('s')
      .innerJoin(PlanEntity, 'p', 'p.id = s.planId')
      .setLock('pessimistic_write')
      .where('s.status = :status', { status })
      .andWhere('s.expiresAt IS NOT NULL AND s.expiresAt <= :cutoff', {
        cutoff,
      })
      .andWhere('p.priceMonthly > 0')
      .orderBy('s.expiresAt', 'ASC')
      .getMany();
  }

  private async record(
    em: EntityManager,
    sub: SubscriptionEntity,
    eventType: SubscriptionEventType,
    plan: PlanEntity,
  ): Promise<void> {
    await em.save(
      new SubscriptionEventEntity({
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        eventType,
        planCode: plan.code,
        effectiveUntil: sub.expiresAt
          ? sub.expiresAt.toISOString().slice(0, 10)
          : null,
        actorType: SubscriptionActorType.SYSTEM,
        actorId: null,
      }),
    );
  }

  private async emit(
    em: EntityManager,
    sub: SubscriptionEntity,
    eventType: SubscriptionChangedPayload['eventType'],
    fromPlan: string,
    plan: PlanEntity,
  ): Promise<void> {
    await this.outbox.add(
      em,
      PLATFORM_SUBSCRIPTION_CHANGED,
      {
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        eventType,
        fromPlan,
        toPlan: plan.code,
        expiresAt: sub.expiresAt ? sub.expiresAt.toISOString() : null,
        quotas: {
          branches: plan.quotaBranches,
          users: plan.quotaUsers,
          products: plan.quotaProducts,
          storageMb: plan.quotaStorageMb,
        },
        actor: { type: 'system', id: null },
      } satisfies SubscriptionChangedPayload,
      { tenantId: sub.tenantId },
    );
  }
}
