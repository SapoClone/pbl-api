import { BadRequestException } from '@nestjs/common';
import { SalesErrorCode } from '../common/errors';
import { PaymentReqDto, ShippingReqDto } from './dto/create-order.req.dto';
import { OrderEntity } from './entities/order.entity';

export type OrderStatus =
  | 'draft'
  | 'new'
  | 'confirmed'
  | 'completed'
  | 'cancelled';
export type PaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'refunded'
  | 'unreconciled';

export interface Money {
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  feePayer: 'customer' | 'shop' | null;
  totalAmount: number;
}

/**
 * subtotal = sum of the lines; total = subtotal - discount + shipping fee (the
 * fee is added only when the customer pays it). Integer VND throughout.
 */
export function computeMoney(
  lines: { quantity: number; unitPrice: number }[],
  discountAmount = 0,
  shipping?: Pick<ShippingReqDto, 'shippingFee' | 'feePayer'> | null,
): Money {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  if (discountAmount > subtotal) {
    throw new BadRequestException({
      errorCode: SalesErrorCode.DISCOUNT_EXCEEDS_SUBTOTAL,
      message: 'The discount is larger than the order subtotal',
    });
  }
  const shippingFee = shipping?.shippingFee ?? 0;
  const feePayer = shippingFee > 0 ? (shipping?.feePayer ?? 'customer') : null;
  return {
    subtotal,
    discountAmount,
    shippingFee,
    feePayer,
    totalAmount:
      subtotal - discountAmount + (feePayer === 'customer' ? shippingFee : 0),
  };
}

/**
 * `paid` when the money received covers the total, `partially_paid` below it,
 * `refunded` when a refund brought a paid order back to nothing.
 */
export function paymentStatusOf(
  totalAmount: number,
  paidAmount: number,
  refunded = false,
): PaymentStatus {
  if (refunded && paidAmount <= 0) return 'refunded';
  if (paidAmount <= 0) return totalAmount === 0 ? 'paid' : 'unpaid';
  return paidAmount >= totalAmount ? 'paid' : 'partially_paid';
}

export interface PaymentPlan {
  rows: { method: string; amount: number }[];
  paidAmount: number;
  changeAmount: number;
  /** The `payment_method` column: the order's main method */
  method: string;
}

/**
 * What is recorded as paid when an order is created or a draft finalised:
 * - `payments` given: those rows. Paying more than the total is cash change (the
 *   excess is taken off the cash rows, returned as `changeAmount`); more with no
 *   cash to absorb it is S017. A `pos` checkout that pays less is S011.
 * - no `payments` on a completed order: the legacy counter sale, paid in full
 *   with `paymentMethod` (nothing for `cod`, which is collected on delivery).
 */
export function planPayments(opts: {
  orderStatus: OrderStatus;
  totalAmount: number;
  source?: string;
  paymentMethod?: string;
  payments?: PaymentReqDto[];
}): PaymentPlan {
  const { orderStatus, totalAmount } = opts;
  if (opts.payments === undefined) {
    const method = opts.paymentMethod ?? 'cash';
    const sold = orderStatus === 'completed' && method !== 'cod';
    return {
      rows: sold && totalAmount > 0 ? [{ method, amount: totalAmount }] : [],
      paidAmount: sold ? totalAmount : 0,
      changeAmount: 0,
      method,
    };
  }
  const rows = opts.payments.map(({ method, amount }) => ({ method, amount }));
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const method = opts.paymentMethod ?? rows[0]?.method ?? 'cash';
  if (
    orderStatus === 'completed' &&
    opts.source === 'pos' &&
    sum < totalAmount
  ) {
    throw new BadRequestException({
      errorCode: SalesErrorCode.PAYMENT_BELOW_TOTAL,
      message: 'The payments do not cover the order total',
    });
  }
  let change = 0;
  if (sum > totalAmount) {
    change = sum - totalAmount;
    let left = change;
    for (let i = rows.length - 1; i >= 0 && left > 0; i--) {
      if (rows[i].method !== 'cash') continue;
      const take = Math.min(rows[i].amount, left);
      rows[i].amount -= take;
      left -= take;
    }
    if (left > 0) {
      throw new BadRequestException({
        errorCode: SalesErrorCode.PAYMENT_EXCEEDS_DUE,
        message: 'The payments exceed the order total',
      });
    }
  }
  return {
    rows: rows.filter((r) => r.amount > 0),
    paidAmount: sum - change,
    changeAmount: change,
    method,
  };
}

/** What the stepper may offer next; the client never re-implements the transitions */
export function allowedActions(order: {
  status: string;
  fulfillmentStatus: string;
}): string[] {
  switch (order.status) {
    case 'draft':
      return ['confirm', 'cancel'];
    case 'new':
      return ['confirm', 'cancel'];
    case 'confirmed': {
      if (order.fulfillmentStatus === 'unfulfilled')
        return ['pack', 'complete', 'cancel'];
      if (order.fulfillmentStatus === 'packing')
        return ['ship', 'complete', 'cancel'];
      if (order.fulfillmentStatus === 'shipping') return ['complete'];
      return [];
    }
    default:
      return [];
  }
}

/** `0901234528` -> `090 ••• •• 28` */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '•'.repeat(digits.length);
  return `${digits.slice(0, 3)} ••• •• ${digits.slice(-2)}`;
}

/** Fields of the order that mirror the editable shipping block */
export function applyShipping(
  order: OrderEntity,
  shipping: ShippingReqDto | null | undefined,
): void {
  order.shippingRecipient = shipping?.recipientName ?? null;
  order.shippingPhone = shipping?.recipientPhone ?? null;
  order.shippingAddressLine = shipping?.addressLine ?? null;
  order.shippingWard = shipping?.ward ?? null;
  order.shippingDistrict = shipping?.district ?? null;
  order.shippingProvince = shipping?.province ?? null;
  order.shippingProviderCode = shipping?.shippingProviderCode ?? null;
  order.trackingCode = null;
  order.shippingFeePayer = shipping?.feePayer ?? null;
}

export function shippingOf(order: OrderEntity): ShippingReqDto | null {
  const has =
    order.shippingRecipient ||
    order.shippingPhone ||
    order.shippingAddressLine ||
    order.shippingProviderCode ||
    order.shippingFee;
  if (!has) return null;
  return {
    recipientName: order.shippingRecipient ?? undefined,
    recipientPhone: order.shippingPhone ?? undefined,
    addressLine: order.shippingAddressLine ?? undefined,
    ward: order.shippingWard ?? undefined,
    district: order.shippingDistrict ?? undefined,
    province: order.shippingProvince ?? undefined,
    shippingProviderCode: order.shippingProviderCode ?? undefined,
    shippingFee: order.shippingFee ?? 0,
    feePayer: (order.shippingFeePayer as 'customer' | 'shop') ?? undefined,
  };
}
