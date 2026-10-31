import { OrderCompletedPayload } from '@pbl/contracts';
import { randomUUID } from 'crypto';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';
import { OrderEntity } from './entities/order.entity';

/** The `sales.order.completed` payload, the same at creation and at `complete` */
export function completedPayload(
  order: OrderEntity,
  lines: OrderItemEntity[],
  completedBy: string,
): OrderCompletedPayload {
  return {
    orderId: order.id,
    code: order.code,
    branchId: order.branchId,
    totalAmount: order.totalAmount,
    itemCount: order.itemCount,
    paymentMethod: order.paymentMethod,
    createdBy: completedBy,
    completedAt: new Date().toISOString(),
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    channel: order.channel ?? 'pos',
    customerId: order.customerId ?? null,
    // costs are not tracked yet
    costAmount: null,
  };
}

export interface HistoryInput {
  statusType: 'order' | 'fulfillment' | 'payment';
  from: string | null;
  to: string;
  note?: string | null;
}

export function historyRows(
  orderId: string,
  changedBy: string | null,
  inputs: HistoryInput[],
): OrderStatusHistoryEntity[] {
  return inputs.map((h) =>
    Object.assign(new OrderStatusHistoryEntity(), {
      id: randomUUID(),
      orderId,
      statusType: h.statusType,
      oldStatus: h.from,
      newStatus: h.to,
      changedBy,
      note: h.note ?? null,
      createdAt: new Date(),
    }),
  );
}
