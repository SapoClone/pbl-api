import { Injectable, Logger } from '@nestjs/common';
import { EventEnvelope, TenantScopedRepository } from '@pbl/common';
import {
  PLATFORM_PLAN_CHANGED,
  PLATFORM_SUBSCRIPTION_CHANGED,
  PlanChangedPayload,
  SubscriptionChangedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { TenantPlanQuotaEntity } from '../infrastructure/persistence/catalog.entities';

/** Keeps `tenant_plan_quota` in step with the store's plan (platform admin design, "Quota enforcement") */
@Injectable()
export class PlanQuotaHandler {
  private readonly logger = new Logger(PlanQuotaHandler.name);

  /** The store moved to a plan (first plan, renewal, upgrade, downgrade): its limits are the payload's */
  @OnEvent(PLATFORM_SUBSCRIPTION_CHANGED.type)
  async onSubscriptionChanged(
    event: EventEnvelope<SubscriptionChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { toPlan, quotas } = event.payload;
    const changedAt = new Date(event.occurredAt);
    const rows = TenantScopedRepository.forEntity(
      manager,
      TenantPlanQuotaEntity,
    );
    const existing = await rows.findOne({ where: {} });
    if (existing && existing.sourceChangedAt.getTime() > changedAt.getTime()) {
      this.logger.debug(`Ignoring a stale plan event for ${event.tenantId}`);
      return;
    }
    await rows.save(
      Object.assign(existing ?? new TenantPlanQuotaEntity(), {
        planCode: toPlan,
        quotaProducts: quotas.products,
        quotaStorageMb: quotas.storageMb,
        sourceChangedAt: changedAt,
      }),
    );
  }

  /** The admin edited a plan's limits: the stores on that plan (one event each) get the new numbers */
  @OnEvent(PLATFORM_PLAN_CHANGED.type)
  async onPlanChanged(
    event: EventEnvelope<PlanChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { code, quotas } = event.payload;
    const changedAt = new Date(event.occurredAt);
    const rows = TenantScopedRepository.forEntity(
      manager,
      TenantPlanQuotaEntity,
    );
    const existing = await rows.findOne({ where: {} });
    if (
      !existing ||
      existing.planCode !== code ||
      existing.sourceChangedAt.getTime() > changedAt.getTime()
    ) {
      return;
    }
    await rows.save(
      Object.assign(existing, {
        quotaProducts: quotas.products,
        quotaStorageMb: quotas.storageMb,
        sourceChangedAt: changedAt,
      }),
    );
  }
}
