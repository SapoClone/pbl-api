import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { toMoney } from '../../common/money';
import { completedEventExtras } from '../../common/order-events';
import { effectiveAmounts } from '../../common/order-views';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';

/**
 * Adds `sales.order.completed` for an order that has just become `COMPLETED`
 * through a lifecycle step (fulfilment confirmed or last payment recorded), in
 * the transaction of that step. Orders sold at the counter get theirs from the
 * checkout; this covers manual, website and marketplace orders so insight and
 * customer count them too.
 */
export async function emitOrderCompleted(
  em: EntityManager,
  outbox: EventOutbox,
  order: OrderEntity,
  actorId: string,
  now: Date,
): Promise<void> {
  const tenantId = order.tenantId;
  const prefix = getSchemaPrefix(em);
  const items = await em.getRepository(OrderItemEntity).find({
    where: { orderId: order.id, tenantId },
  });
  let channelRowType: string | null = null;
  if (order.channelId) {
    const rows = await em.query(
      `SELECT type FROM ${prefix}"sales_channels" WHERE tenant_id = $1 AND id = $2`,
      [tenantId, order.channelId],
    );
    channelRowType = (rows[0]?.type as string | undefined) ?? null;
  }
  const amounts = effectiveAmounts({
    totalAmount: order.totalAmount,
    grandTotal: order.grandTotal,
    subtotal: order.subtotal,
    paidAmount: order.paidAmount,
    paymentStatus: order.paymentStatus,
  });
  await outbox.add(em, SALES_ORDER_COMPLETED, {
    orderId: order.id,
    code: order.code,
    branchId: order.branchId,
    customerId: order.customerId ?? null,
    subtotal: amounts.subtotal,
    discountTotal:
      toMoney(order.itemDiscountTotal ?? 0) +
      toMoney(order.orderDiscountTotal ?? 0) +
      toMoney(order.promotionDiscountTotal ?? 0),
    taxTotal: order.taxTotal ?? 0,
    grandTotal: order.grandTotal || order.totalAmount,
    totalAmount: order.totalAmount,
    itemCount: order.itemCount,
    paymentMethod: order.paymentMethod,
    createdBy: actorId,
    completedAt: now.toISOString(),
    items: items.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      ...(l.variantId ? { variantId: l.variantId } : {}),
    })),
    ...completedEventExtras(order, items, channelRowType),
  } satisfies OrderCompletedPayload);
}
