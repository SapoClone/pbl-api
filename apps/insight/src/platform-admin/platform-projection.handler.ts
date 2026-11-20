import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  CATALOG_USAGE_CHANGED,
  CatalogUsageChangedPayload,
  INTEGRATION_CONNECTION_CONNECTED,
  INTEGRATION_CONNECTION_DISCONNECTED,
  IntegrationConnectionEventPayload,
  OrderCompletedPayload,
  PLATFORM_PLAN_CHANGED,
  PLATFORM_SUBSCRIPTION_CHANGED,
  PLATFORM_TENANT_CREATED,
  PLATFORM_TENANT_STATUS_CHANGED,
  PLATFORM_TENANT_UPDATED,
  PlanChangedPayload,
  SALES_ORDER_COMPLETED,
  SubscriptionChangedPayload,
  TenantEventPayload,
  TenantStatusChangedPayload,
} from '@pbl/contracts';
import { OnEvent, qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { salesDate } from '../common/store-time';

/**
 * Feeds the platform-wide read models of the admin dashboard and the announcement audience:
 * `tenant_projection` (one row per store) and `platform_daily_transactions` (one row per Vietnam day).
 *
 * Every handler runs inside the consumer's inbox transaction, so a redelivered event changes nothing. Events of one
 * store can arrive in any order and a store can have no row yet, so each write is an upsert that creates the row
 * with what it knows and an older event never overwrites a newer one (the `*_at` guards).
 */
@Injectable()
export class PlatformProjectionHandler {
  private table(manager: EntityManager, name: string) {
    return qualifiedTable(manager.connection, name);
  }

  @OnEvent(PLATFORM_TENANT_CREATED.type)
  async onTenantCreated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.upsertTenant(event, manager, true);
  }

  @OnEvent(PLATFORM_TENANT_UPDATED.type)
  async onTenantUpdated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.upsertTenant(event, manager, false);
  }

  private async upsertTenant(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
    created: boolean,
  ): Promise<void> {
    const p = event.payload;
    const at = new Date(event.occurredAt);
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `INSERT INTO ${t} ("tenant_id", "code", "name", "status", "tenant_created_at", "status_changed_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "code" = EXCLUDED."code",
         "name" = EXCLUDED."name",
         "tenant_created_at" = COALESCE(${t}."tenant_created_at", EXCLUDED."tenant_created_at"),
         "status" = CASE WHEN ${t}."status_changed_at" IS NULL OR ${t}."status_changed_at" <= EXCLUDED."status_changed_at"
                         THEN EXCLUDED."status" ELSE ${t}."status" END,
         "status_changed_at" = GREATEST(${t}."status_changed_at", EXCLUDED."status_changed_at"),
         "updated_at" = now()`,
      [event.tenantId, p.code, p.name, p.status, created ? at : null, at],
    );
  }

  @OnEvent(PLATFORM_TENANT_STATUS_CHANGED.type)
  async onTenantStatusChanged(
    event: EventEnvelope<TenantStatusChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `INSERT INTO ${t} ("tenant_id", "status", "status_changed_at", "updated_at")
       VALUES ($1, $2, $3, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "status" = EXCLUDED."status",
         "status_changed_at" = EXCLUDED."status_changed_at",
         "updated_at" = now()
       WHERE ${t}."status_changed_at" IS NULL OR ${t}."status_changed_at" <= EXCLUDED."status_changed_at"`,
      [event.tenantId, event.payload.to, new Date(event.occurredAt)],
    );
  }

  /**
   * The store's current plan, end date and limits. `past_due` keeps the paid plan (the grace); every other event type
   * means an active subscription (`expired` already carries the `free` plan that replaced the paid one).
   */
  @OnEvent(PLATFORM_SUBSCRIPTION_CHANGED.type)
  async onSubscriptionChanged(
    event: EventEnvelope<SubscriptionChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `INSERT INTO ${t} ("tenant_id", "subscription_id", "plan_code", "subscription_status", "expires_at",
         "quota_branches", "quota_products", "quota_storage_mb", "plan_changed_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "subscription_id" = EXCLUDED."subscription_id",
         "plan_name" = CASE WHEN ${t}."plan_code" = EXCLUDED."plan_code" THEN ${t}."plan_name" ELSE NULL END,
         "plan_code" = EXCLUDED."plan_code",
         "subscription_status" = EXCLUDED."subscription_status",
         "expires_at" = EXCLUDED."expires_at",
         "quota_branches" = EXCLUDED."quota_branches",
         "quota_products" = EXCLUDED."quota_products",
         "quota_storage_mb" = EXCLUDED."quota_storage_mb",
         "plan_changed_at" = EXCLUDED."plan_changed_at",
         "updated_at" = now()
       WHERE ${t}."plan_changed_at" IS NULL OR ${t}."plan_changed_at" <= EXCLUDED."plan_changed_at"`,
      [
        event.tenantId,
        p.subscriptionId,
        p.toPlan,
        p.eventType === 'past_due' ? 'past_due' : 'active',
        p.expiresAt ? new Date(p.expiresAt) : null,
        p.quotas.branches,
        p.quotas.products,
        p.quotas.storageMb,
        new Date(event.occurredAt),
      ],
    );
  }

  /** An admin edited a plan: platform sends one event per store on it, so only that store's row is touched */
  @OnEvent(PLATFORM_PLAN_CHANGED.type)
  async onPlanChanged(
    event: EventEnvelope<PlanChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `UPDATE ${t} SET "plan_name" = $3, "quota_branches" = $4, "quota_products" = $5, "quota_storage_mb" = $6,
         "plan_changed_at" = $7, "updated_at" = now()
       WHERE "tenant_id" = $1 AND "plan_code" = $2
         AND ("plan_changed_at" IS NULL OR "plan_changed_at" <= $7)`,
      [
        event.tenantId,
        p.code,
        p.name,
        p.quotas.branches,
        p.quotas.products,
        p.quotas.storageMb,
        new Date(event.occurredAt),
      ],
    );
  }

  /** Products and storage measured by catalog (absolute numbers; an older measurement is ignored) */
  @OnEvent(CATALOG_USAGE_CHANGED.type)
  async onCatalogUsage(
    event: EventEnvelope<CatalogUsageChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `INSERT INTO ${t} ("tenant_id", "products_used", "storage_mb_used", "usage_measured_at", "updated_at")
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "products_used" = EXCLUDED."products_used",
         "storage_mb_used" = EXCLUDED."storage_mb_used",
         "usage_measured_at" = EXCLUDED."usage_measured_at",
         "updated_at" = now()
       WHERE ${t}."usage_measured_at" IS NULL OR ${t}."usage_measured_at" <= EXCLUDED."usage_measured_at"`,
      [
        event.tenantId,
        p.products,
        p.storageMb,
        new Date(p.measuredAt ?? event.occurredAt),
      ],
    );
  }

  @OnEvent(INTEGRATION_CONNECTION_CONNECTED.type)
  async onConnectionConnected(
    event: EventEnvelope<IntegrationConnectionEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.setConnection(event, manager, true);
  }

  @OnEvent(INTEGRATION_CONNECTION_DISCONNECTED.type)
  async onConnectionDisconnected(
    event: EventEnvelope<IntegrationConnectionEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    await this.setConnection(event, manager, false);
  }

  /** `connections` maps a connection id to `{ provider, connected, at }`; the newest event of a connection wins */
  private async setConnection(
    event: EventEnvelope<IntegrationConnectionEventPayload>,
    manager: EntityManager,
    connected: boolean,
  ): Promise<void> {
    const p = event.payload;
    const t = this.table(manager, 'tenant_projection');
    await manager.query(
      `INSERT INTO ${t} ("tenant_id") VALUES ($1) ON CONFLICT ("tenant_id") DO NOTHING`,
      [event.tenantId],
    );
    const [row] = await manager.query(
      `SELECT "connections" FROM ${t} WHERE "tenant_id" = $1 FOR UPDATE`,
      [event.tenantId],
    );
    const connections = (row?.connections ?? {}) as Record<
      string,
      { provider: string; connected: boolean; at: string }
    >;
    const at = new Date(p.occurredAt ?? event.occurredAt).toISOString();
    const known = connections[p.connectionId];
    if (known && known.at > at) return;
    connections[p.connectionId] = {
      provider: String(p.provider).toLowerCase(),
      connected,
      at,
    };
    await manager.query(
      `UPDATE ${t} SET "connections" = $2::jsonb, "updated_at" = now() WHERE "tenant_id" = $1`,
      [event.tenantId, JSON.stringify(connections)],
    );
  }

  /** One completed sale of any store: one more order and its total on the Vietnam day it was completed */
  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const p = event.payload;
    const day = salesDate(
      Number.isNaN(Date.parse(p.completedAt))
        ? event.occurredAt
        : p.completedAt,
    );
    const revenue = Number.isSafeInteger(p.totalAmount) ? p.totalAmount : 0;
    const d = this.table(manager, 'platform_daily_transactions');
    await manager.query(
      `INSERT INTO ${d} ("date", "order_count", "revenue", "updated_at") VALUES ($1, 1, $2, now())
       ON CONFLICT ("date") DO UPDATE SET
         "order_count" = ${d}."order_count" + 1,
         "revenue" = ${d}."revenue" + EXCLUDED."revenue",
         "updated_at" = now()`,
      [day, revenue],
    );
  }
}
