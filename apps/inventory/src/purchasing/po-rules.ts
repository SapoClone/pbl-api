export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type PurchaseOrderAction = 'submit' | 'approve' | 'cancel';

/**
 * Status machine (api D5). Receiving goods against an order is deferred, so
 * `partially_received` and `received` are never entered yet; they stay in the enum.
 */
export const PO_TRANSITIONS: Record<
  PurchaseOrderAction,
  { from: PurchaseOrderStatus[]; to: PurchaseOrderStatus }
> = {
  submit: { from: ['draft'], to: 'pending_approval' },
  approve: { from: ['pending_approval'], to: 'approved' },
  cancel: {
    from: ['draft', 'pending_approval', 'approved'],
    to: 'cancelled',
  },
};

/** Payments are taken once the order has been sent to the supplier */
export const PAYABLE_STATUSES: PurchaseOrderStatus[] = [
  'approved',
  'partially_received',
  'received',
];

export function nextStatus(
  action: PurchaseOrderAction,
  current: PurchaseOrderStatus,
): PurchaseOrderStatus | null {
  const rule = PO_TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

export interface PriceLine {
  quantityOrdered: number;
  unitCost: number;
  /** whole-number percentage */
  vatRate: number;
}

export interface PricedLine {
  lineSubtotal: number;
  vatAmount: number;
}

/** Lines are priced before VAT: subtotal = quantity x unit cost, VAT = round(subtotal x rate / 100) */
export function priceLine(line: PriceLine): PricedLine {
  const lineSubtotal = line.quantityOrdered * line.unitCost;
  return {
    lineSubtotal,
    vatAmount: Math.round((lineSubtotal * line.vatRate) / 100),
  };
}

export function priceOrder(lines: PriceLine[]) {
  const priced = lines.map(priceLine);
  const subtotal = priced.reduce((sum, l) => sum + l.lineSubtotal, 0);
  const vatAmount = priced.reduce((sum, l) => sum + l.vatAmount, 0);
  return {
    lines: priced,
    subtotal,
    vatAmount,
    totalAmount: subtotal + vatAmount,
  };
}
