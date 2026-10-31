/**
 * The screen contract's vocabulary (D5, `03-sales-channels-customers.md`) over the
 * M3 columns. Pure functions: nothing here reads a database. The M3 enums
 * (`PENDING`, `RESERVED`, ...) stay as stored; these maps only translate them.
 */

export type ScreenOrderStatus =
  | 'draft'
  | 'new'
  | 'confirmed'
  | 'completed'
  | 'cancelled';
export type ScreenFulfillmentStatus =
  | 'unfulfilled'
  | 'packing'
  | 'shipping'
  | 'delivered'
  | 'returned';
export type ScreenPaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'refunded'
  | 'unreconciled';

const ORDER_STATUS: Record<string, ScreenOrderStatus> = {
  DRAFT: 'draft',
  PENDING: 'new',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Screen order status to the stored value (the filter's way in) */
export const STORED_ORDER_STATUS: Record<string, string> = {
  draft: 'DRAFT',
  new: 'PENDING',
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export function toScreenOrderStatus(stored: string | null | undefined) {
  return ORDER_STATUS[stored ?? 'COMPLETED'] ?? 'confirmed';
}

/**
 * `PACKING` and `SHIPPING` live in `fulfillment_stage`, the M3 axis keeps its
 * own values; a partly fulfilled order is on its way.
 */
export function toScreenFulfillmentStatus(
  stored: string | null | undefined,
  stage: string | null | undefined,
): ScreenFulfillmentStatus {
  if (stored === 'FULFILLED') return 'delivered';
  if (stored === 'RETURNED') return 'returned';
  if (stage === 'SHIPPING' || stored === 'PARTIALLY_FULFILLED')
    return 'shipping';
  if (stage === 'PACKING') return 'packing';
  return 'unfulfilled';
}

/**
 * A pending refund or a part refund still leaves the order paid; `unreconciled`
 * is not derived (it needs the finance reconciliation, see the report).
 */
export function toScreenPaymentStatus(
  stored: string | null | undefined,
): ScreenPaymentStatus {
  switch (stored) {
    case 'UNPAID':
      return 'unpaid';
    case 'PARTIALLY_PAID':
      return 'partially_paid';
    case 'REFUNDED':
      return 'refunded';
    case 'PAID':
    case 'REFUND_PENDING':
    case 'PARTIALLY_REFUNDED':
    default:
      return 'paid';
  }
}

const TENDER_METHOD_TO_SCREEN: Record<string, string> = {
  CASH: 'cash',
  BANK_TRANSFER: 'transfer',
  CARD: 'card',
  E_WALLET: 'e_wallet',
  COD: 'cod',
  MARKETPLACE: 'marketplace',
};
const SCREEN_TO_TENDER_METHOD: Record<string, string> = Object.fromEntries(
  Object.entries(TENDER_METHOD_TO_SCREEN).map(([k, v]) => [v, k]),
);

export const SCREEN_PAYMENT_METHODS = Object.keys(SCREEN_TO_TENDER_METHOD);

export function toScreenMethod(stored: string): string {
  return TENDER_METHOD_TO_SCREEN[stored] ?? stored.toLowerCase();
}

export function toStoredMethod(screen: string): string | undefined {
  return SCREEN_TO_TENDER_METHOD[screen];
}

/** Contract channel type of an order: its channel row's type, else derived from the M3 channel type */
export function channelTypeOf(
  channelType: string | null | undefined,
  channelRowType?: string | null,
): string {
  if (channelRowType) return channelRowType;
  switch (channelType) {
    case 'MANUAL':
      return 'manual';
    case 'ONLINE':
      return 'website';
    case 'MARKETPLACE':
      return 'marketplace';
    case 'POS':
    default:
      return 'pos';
  }
}

/** SQL for the same derivation; fixed text, no input goes into it */
export function channelTypeSql(orderAlias: string, rowAlias: string): string {
  return `COALESCE(${rowAlias}.type, CASE ${orderAlias}.channel_type WHEN 'MANUAL' THEN 'manual' WHEN 'ONLINE' THEN 'website' WHEN 'MARKETPLACE' THEN 'marketplace' ELSE 'pos' END)`;
}

export function sourceOf(channelType: string | null | undefined): string {
  if (channelType === 'MARKETPLACE') return 'marketplace';
  if (channelType === 'POS' || !channelType) return 'pos';
  return 'manual';
}

/**
 * Buttons the stepper may show (the client never re-implements transitions).
 * `return` is added for a completed order, `complete` straight from `confirmed`
 * only where nothing is shipped (counter sales).
 */
export function allowedActionsOf(order: {
  orderStatus?: string | null;
  fulfillmentStatus?: string | null;
  fulfillmentStage?: string | null;
  channelType?: string | null;
}): string[] {
  const status = order.orderStatus ?? 'COMPLETED';
  if (status === 'DRAFT' || status === 'PENDING') return ['confirm', 'cancel'];
  if (status === 'COMPLETED') return ['return'];
  if (status !== 'CONFIRMED') return [];
  if (order.fulfillmentStatus === 'FULFILLED') return [];
  if (order.fulfillmentStage === 'SHIPPING') return ['complete'];
  if (order.fulfillmentStage === 'PACKING') return ['ship', 'cancel'];
  return order.channelType === 'POS' || !order.channelType
    ? ['pack', 'complete', 'cancel']
    : ['pack', 'cancel'];
}

/**
 * Orders made by the first `POST /orders` carry the M3 money columns at their
 * defaults (0): their amounts are the legacy `total_amount`.
 */
export function effectiveAmounts(order: {
  totalAmount: number;
  grandTotal?: number | null;
  subtotal?: number | null;
  paidAmount?: number | null;
  paymentStatus?: string | null;
}) {
  const legacy = !order.grandTotal && order.totalAmount > 0;
  const totalAmount = order.totalAmount;
  const subtotal = legacy ? totalAmount : (order.subtotal ?? totalAmount);
  const paidAmount = legacy
    ? order.paymentStatus === 'PAID' || order.paymentStatus === undefined
      ? totalAmount
      : (order.paidAmount ?? 0)
    : (order.paidAmount ?? 0);
  return { totalAmount, subtotal, paidAmount };
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `${digits.slice(0, 3)} ••• •• ${digits.slice(-2)}`;
}

/** A CSV cell that a spreadsheet will not run as a formula */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
