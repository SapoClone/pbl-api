import {
  PO_TRANSITIONS,
  PurchaseOrderAction,
  PurchaseOrderStatus,
  nextStatus,
  priceLine,
  priceOrder,
} from './po-rules';

describe('purchase order maths', () => {
  it('prices the contract example before VAT: 14.200.000 + 1.136.000 = 15.336.000', () => {
    const result = priceOrder([
      { quantityOrdered: 100, unitCost: 85_000, vatRate: 8 },
      { quantityOrdered: 60, unitCost: 95_000, vatRate: 8 },
    ]);
    expect(result.lines).toEqual([
      { lineSubtotal: 8_500_000, vatAmount: 680_000 },
      { lineSubtotal: 5_700_000, vatAmount: 456_000 },
    ]);
    expect(result.subtotal).toBe(14_200_000);
    expect(result.vatAmount).toBe(1_136_000);
    expect(result.totalAmount).toBe(15_336_000);
  });

  it.each([
    [3, 1_001, 8, 3_003, 240],
    [1, 10, 5, 10, 1], // 0.5 rounds up
    [7, 333, 10, 2_331, 233],
    [5, 1_000, 0, 5_000, 0],
  ])(
    'line of %i x %i at %i%% VAT',
    (quantityOrdered, unitCost, vatRate, lineSubtotal, vatAmount) => {
      expect(priceLine({ quantityOrdered, unitCost, vatRate })).toEqual({
        lineSubtotal,
        vatAmount,
      });
    },
  );

  it('prices no lines as zero', () => {
    expect(priceOrder([]).totalAmount).toBe(0);
  });
});

describe('purchase order status machine', () => {
  const statuses: PurchaseOrderStatus[] = [
    'draft',
    'pending_approval',
    'approved',
    'partially_received',
    'received',
    'cancelled',
  ];
  const allowed: Record<PurchaseOrderAction, PurchaseOrderStatus[]> = {
    submit: ['draft'],
    approve: ['pending_approval'],
    cancel: ['draft', 'pending_approval', 'approved'],
  };

  for (const action of Object.keys(allowed) as PurchaseOrderAction[]) {
    it.each(statuses)(`${action} from %s`, (status) => {
      const result = nextStatus(action, status);
      if (allowed[action].includes(status)) {
        expect(result).toBe(PO_TRANSITIONS[action].to);
      } else {
        expect(result).toBeNull();
      }
    });
  }
});
