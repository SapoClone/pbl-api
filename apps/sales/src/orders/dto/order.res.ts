import { OrderPaymentEntity } from '../entities/order-payment.entity';
import { OrderEntity } from '../entities/order.entity';
import { allowedActions, maskPhone } from '../order-calc';

/** Display names of the built-in channels (the channel table is only read by GET /sales-channels) */
const CHANNEL_NAMES: Record<string, string> = {
  pos: 'POS tại quầy',
  manual: 'Đơn thủ công',
  website: 'Website / API',
  facebook: 'Facebook',
  zalo: 'Zalo',
  phone: 'Điện thoại',
};

export interface PaymentRes {
  id: string;
  method: string;
  amount: number;
  paidAt: string;
  note: string | null;
}

export interface OrderRes {
  id: string;
  code: string;
  externalOrderCode: string | null;
  version: number;
  branchId: string;
  /** The order status (same value as `orderStatus`, kept for older clients) */
  status: string;
  orderStatus: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  exceptionCode: string | null;
  source: string;
  channel: { type: string; name: string };
  paymentMethod: string;
  customerName: string | null;
  customer: {
    id: string | null;
    name: string | null;
    phoneMasked: string | null;
  } | null;
  shipping: {
    recipientName: string | null;
    recipientPhone: string | null;
    addressLine: string | null;
    ward: string | null;
    district: string | null;
    province: string | null;
    shippingProviderCode: string | null;
    trackingCode: string | null;
    shippingFee: number;
    feePayer: string | null;
  } | null;
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  changeAmount: number;
  itemCount: number;
  note: string | null;
  cancelReason: string | null;
  registerId: string | null;
  shiftId: string | null;
  allowedActions: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: {
    id: string;
    variantId: string | null;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  payments: PaymentRes[];
}

export function toPaymentRes(p: OrderPaymentEntity): PaymentRes {
  return {
    id: p.id,
    method: p.method,
    amount: p.amount,
    paidAt: p.paidAt.toISOString(),
    note: p.note ?? null,
  };
}

/** An entity is never returned as is (api-conventions §3): this is the response shape */
export function toOrderRes(order: OrderEntity): OrderRes {
  const status = order.status;
  const fulfillmentStatus = order.fulfillmentStatus ?? 'unfulfilled';
  const channel = order.channel ?? 'pos';
  const totalAmount = order.totalAmount;
  const paidAmount = order.paidAmount ?? 0;
  const hasShipping =
    order.shippingRecipient ||
    order.shippingPhone ||
    order.shippingAddressLine ||
    order.shippingProviderCode ||
    order.shippingFee;
  const customerId = order.customerId ?? null;
  return {
    id: order.id,
    code: order.code,
    externalOrderCode: order.externalOrderCode ?? null,
    version: order.version ?? 1,
    branchId: order.branchId,
    status,
    orderStatus: status,
    fulfillmentStatus,
    paymentStatus: order.paymentStatus ?? 'unpaid',
    exceptionCode: order.exceptionCode ?? null,
    source: order.source ?? 'pos',
    channel: { type: channel, name: CHANNEL_NAMES[channel] ?? channel },
    paymentMethod: order.paymentMethod,
    customerName: order.customerName,
    customer:
      customerId || order.customerName || order.customerPhone
        ? {
            id: customerId,
            name: order.customerName,
            phoneMasked: maskPhone(order.customerPhone),
          }
        : null,
    shipping: hasShipping
      ? {
          recipientName: order.shippingRecipient ?? null,
          recipientPhone: order.shippingPhone ?? null,
          addressLine: order.shippingAddressLine ?? null,
          ward: order.shippingWard ?? null,
          district: order.shippingDistrict ?? null,
          province: order.shippingProvince ?? null,
          shippingProviderCode: order.shippingProviderCode ?? null,
          trackingCode: order.trackingCode ?? null,
          shippingFee: order.shippingFee ?? 0,
          feePayer: order.shippingFeePayer ?? null,
        }
      : null,
    subtotal: order.subtotal ?? totalAmount,
    discountAmount: order.discountAmount ?? 0,
    shippingFee: order.shippingFee ?? 0,
    totalAmount,
    paidAmount,
    dueAmount: Math.max(0, totalAmount - paidAmount),
    changeAmount: order.changeAmount ?? 0,
    itemCount: order.itemCount,
    note: order.note ?? null,
    cancelReason: order.cancelReason ?? null,
    registerId: order.registerId ?? null,
    shiftId: order.shiftId ?? null,
    allowedActions: allowedActions({ status, fulfillmentStatus }),
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedAt: (order.updatedAt ?? order.createdAt).toISOString(),
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      variantId: item.variantId ?? null,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    payments: (order.payments ?? []).map(toPaymentRes),
  };
}
