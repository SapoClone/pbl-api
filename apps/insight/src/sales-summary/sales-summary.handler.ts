import { Injectable } from '@nestjs/common';
import { EventEnvelope, TenantContext } from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { OnEvent, qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';

/** Vietnam is UTC+7 all year round */
const STORE_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The day an instant falls on in the store's timezone, as YYYY-MM-DD */
export function salesDate(instant: string): string {
  return new Date(Date.parse(instant) + STORE_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** The hour (0-23) an instant falls in, in the store's timezone */
export function salesHour(instant: string): number {
  return new Date(Date.parse(instant) + STORE_UTC_OFFSET_MS).getUTCHours();
}

/**
 * Adds each completed order to the revenue of its day and to the hourly,
 * per-product and per-customer read models (counters, not a recount), all in the
 * transaction of the event. Older events lack `channel`, `customerId` and
 * `costAmount`: channel defaults to `pos`, the customer and the cost stay unknown.
 */
@Injectable()
export class SalesSummaryHandler {
  @OnEvent(SALES_ORDER_COMPLETED.type)
  async onOrderCompleted(
    event: EventEnvelope<OrderCompletedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const order = event.payload;
    // the event's own tenant: the context was restored from its envelope
    const tenantId = TenantContext.require();
    await manager.query(
      `INSERT INTO ${qualifiedTable(manager.connection, 'daily_sales')}
         ("tenant_id", "branch_id", "sales_date", "order_count", "revenue")
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT ("tenant_id", "branch_id", "sales_date") DO UPDATE SET
         "order_count" = ${qualifiedTable(manager.connection, 'daily_sales')}."order_count" + 1,
         "revenue" = ${qualifiedTable(manager.connection, 'daily_sales')}."revenue" + EXCLUDED."revenue"`,
      [
        tenantId,
        order.branchId,
        salesDate(order.completedAt),
        order.totalAmount,
      ],
    );
    await this.addReadModels(manager, tenantId, order);
  }

  private async addReadModels(
    manager: EntityManager,
    tenantId: string,
    order: OrderCompletedPayload,
  ): Promise<void> {
    const date = salesDate(order.completedAt);
    const hour = salesHour(order.completedAt);
    const cost = order.costAmount ?? null;
    const hourly = qualifiedTable(manager.connection, 'hourly_sales');
    await manager.query(
      `INSERT INTO ${hourly}
         ("tenant_id", "branch_id", "channel", "sales_date", "hour", "order_count", "revenue", "cost", "costed_revenue")
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7::bigint, $8)
       ON CONFLICT ("tenant_id", "branch_id", "channel", "sales_date", "hour") DO UPDATE SET
         "order_count" = ${hourly}."order_count" + 1,
         "revenue" = ${hourly}."revenue" + EXCLUDED."revenue",
         "cost" = CASE WHEN ${hourly}."cost" IS NULL AND EXCLUDED."cost" IS NULL THEN NULL
                  ELSE COALESCE(${hourly}."cost", 0) + COALESCE(EXCLUDED."cost", 0) END,
         "costed_revenue" = ${hourly}."costed_revenue" + EXCLUDED."costed_revenue"`,
      [
        tenantId,
        order.branchId,
        order.channel ?? 'pos',
        date,
        hour,
        order.totalAmount,
        cost,
        cost === null ? 0 : order.totalAmount,
      ],
    );

    // one row per SKU even when the order repeats it
    const lines = new Map<
      string,
      { name: string; quantity: number; revenue: number }
    >();
    for (const item of order.items ?? []) {
      const line = lines.get(item.sku) ?? {
        name: item.name,
        quantity: 0,
        revenue: 0,
      };
      line.name = item.name;
      line.quantity += item.quantity;
      line.revenue += item.quantity * item.unitPrice;
      lines.set(item.sku, line);
    }
    const product = qualifiedTable(manager.connection, 'product_sales_daily');
    for (const [sku, line] of lines) {
      await manager.query(
        `INSERT INTO ${product}
           ("tenant_id", "branch_id", "sales_date", "sku", "name", "quantity", "revenue")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("tenant_id", "branch_id", "sales_date", "sku") DO UPDATE SET
           "name" = EXCLUDED."name",
           "quantity" = ${product}."quantity" + EXCLUDED."quantity",
           "revenue" = ${product}."revenue" + EXCLUDED."revenue"`,
        [
          tenantId,
          order.branchId,
          date,
          sku.slice(0, 100),
          line.name.slice(0, 300),
          line.quantity,
          line.revenue,
        ],
      );
    }

    if (order.customerId) {
      const customer = qualifiedTable(
        manager.connection,
        'customer_sales_daily',
      );
      await manager.query(
        `INSERT INTO ${customer}
           ("tenant_id", "branch_id", "sales_date", "customer_id", "first_hour")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("tenant_id", "branch_id", "sales_date", "customer_id") DO UPDATE SET
           "first_hour" = LEAST(${customer}."first_hour", EXCLUDED."first_hour")`,
        [tenantId, order.branchId, date, order.customerId, hour],
      );
    }
  }
}
