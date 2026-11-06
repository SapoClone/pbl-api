import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  PLATFORM_SUBSCRIPTION_CHANGED,
  PLATFORM_TENANT_STATUS_CHANGED,
  SubscriptionChangedPayload,
  TenantStatusChangedPayload,
} from '@pbl/contracts';
import { OnEvent, qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';

const EPOCH = new Date(0);

/**
 * Keeps `tenant_status` in step with platform: the store's status (`platform.tenant.status_changed`) and its plan code
 * (`platform.subscription.changed`). An event older than the one already applied is ignored (redelivery, reordering);
 * each upsert is one statement, so two events of the same store cannot interleave.
 */
@Injectable()
export class TenantStatusHandler {
  @OnEvent(PLATFORM_TENANT_STATUS_CHANGED.type)
  async onStatusChanged(
    event: EventEnvelope<TenantStatusChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const table = qualifiedTable(manager.connection, 'tenant_status');
    await manager.query(
      `INSERT INTO ${table} ("tenant_id", "status", "status_changed_at", "plan_changed_at")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("tenant_id") DO UPDATE
         SET "status" = EXCLUDED."status", "status_changed_at" = EXCLUDED."status_changed_at"
         WHERE ${table}."status_changed_at" <= EXCLUDED."status_changed_at"`,
      [
        event.payload.tenantId,
        event.payload.to,
        new Date(event.occurredAt),
        EPOCH,
      ],
    );
  }

  @OnEvent(PLATFORM_SUBSCRIPTION_CHANGED.type)
  async onSubscriptionChanged(
    event: EventEnvelope<SubscriptionChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const table = qualifiedTable(manager.connection, 'tenant_status');
    await manager.query(
      `INSERT INTO ${table} ("tenant_id", "status", "plan_code", "status_changed_at", "plan_changed_at")
       VALUES ($1, 'active', $2, $3, $4)
       ON CONFLICT ("tenant_id") DO UPDATE
         SET "plan_code" = EXCLUDED."plan_code", "plan_changed_at" = EXCLUDED."plan_changed_at"
         WHERE ${table}."plan_changed_at" <= EXCLUDED."plan_changed_at"`,
      [
        event.payload.tenantId,
        event.payload.toPlan,
        EPOCH,
        new Date(event.occurredAt),
      ],
    );
  }
}
