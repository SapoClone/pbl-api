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

/** Adds each completed order to the revenue of its day (a counter, not a recount) */
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
  }
}
