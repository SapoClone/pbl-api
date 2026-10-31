import { OrderEntity } from '../entities/order.entity';

export interface OrderRes {
  id: string;
  code: string;
  branchId: string;
  status: string;
  paymentMethod: string;
  customerName: string | null;
  totalAmount: number;
  itemCount: number;
  createdBy: string;
  createdAt: string;
  items: {
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
}

/** An entity is never returned as is (api-conventions §3): this is the response shape */
export function toOrderRes(order: OrderEntity): OrderRes {
  return {
    id: order.id,
    code: order.code,
    branchId: order.branchId,
    status: order.status,
    paymentMethod: order.paymentMethod,
    customerName: order.customerName,
    totalAmount: order.totalAmount,
    itemCount: order.itemCount,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    items: (order.items ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };
}
