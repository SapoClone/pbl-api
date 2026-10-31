import { completedEventExtras, costAmountOf } from './order-events';
import {
  allowedActionsOf,
  channelTypeOf,
  csvCell,
  effectiveAmounts,
  maskPhone,
  toScreenFulfillmentStatus,
  toScreenMethod,
  toScreenOrderStatus,
  toScreenPaymentStatus,
  toStoredMethod,
} from './order-views';

describe('screen vocabulary over the M3 columns', () => {
  it.each([
    ['DRAFT', 'draft'],
    ['PENDING', 'new'],
    ['CONFIRMED', 'confirmed'],
    ['COMPLETED', 'completed'],
    ['CANCELLED', 'cancelled'],
  ])('order status %s is %s', (stored, screen) => {
    expect(toScreenOrderStatus(stored)).toBe(screen);
  });

  it.each([
    ['RESERVED', null, 'unfulfilled'],
    ['UNFULFILLED', null, 'unfulfilled'],
    ['RESERVED', 'PACKING', 'packing'],
    ['RESERVED', 'SHIPPING', 'shipping'],
    ['PARTIALLY_FULFILLED', null, 'shipping'],
    ['FULFILLED', 'SHIPPING', 'delivered'],
    ['RETURNED', null, 'returned'],
  ])('fulfilment %s / stage %s is %s', (stored, stage, screen) => {
    expect(toScreenFulfillmentStatus(stored, stage)).toBe(screen);
  });

  it.each([
    ['UNPAID', 'unpaid'],
    ['PARTIALLY_PAID', 'partially_paid'],
    ['PAID', 'paid'],
    ['REFUND_PENDING', 'paid'],
    ['PARTIALLY_REFUNDED', 'paid'],
    ['REFUNDED', 'refunded'],
  ])('payment %s is %s', (stored, screen) => {
    expect(toScreenPaymentStatus(stored)).toBe(screen);
  });

  it('maps methods both ways', () => {
    expect(toScreenMethod('BANK_TRANSFER')).toBe('transfer');
    expect(toScreenMethod('E_WALLET')).toBe('e_wallet');
    expect(toStoredMethod('transfer')).toBe('BANK_TRANSFER');
    expect(toStoredMethod('marketplace')).toBe('MARKETPLACE');
    expect(toStoredMethod('bitcoin')).toBeUndefined();
  });

  it('derives the channel type from the row, else from the M3 channel type', () => {
    expect(channelTypeOf('MARKETPLACE', 'shopee')).toBe('shopee');
    expect(channelTypeOf('MARKETPLACE')).toBe('marketplace');
    expect(channelTypeOf('ONLINE')).toBe('website');
    expect(channelTypeOf('MANUAL')).toBe('manual');
    expect(channelTypeOf(undefined)).toBe('pos');
  });

  it('lists the stepper buttons per state', () => {
    const o = (
      orderStatus: string,
      fulfillmentStage: string | null = null,
      channelType = 'MANUAL',
      fulfillmentStatus = 'RESERVED',
    ) =>
      allowedActionsOf({
        orderStatus,
        fulfillmentStage,
        channelType,
        fulfillmentStatus,
      });
    expect(o('PENDING')).toEqual(['confirm', 'cancel']);
    expect(o('CONFIRMED')).toEqual(['pack', 'cancel']);
    expect(o('CONFIRMED', null, 'POS')).toEqual(['pack', 'complete', 'cancel']);
    expect(o('CONFIRMED', 'PACKING')).toEqual(['ship', 'cancel']);
    expect(o('CONFIRMED', 'SHIPPING')).toEqual(['complete']);
    expect(o('CONFIRMED', null, 'MANUAL', 'FULFILLED')).toEqual([]);
    expect(o('COMPLETED')).toEqual(['return']);
    expect(o('CANCELLED')).toEqual([]);
  });

  it('reads the amounts of a first-generation order from total_amount', () => {
    expect(
      effectiveAmounts({
        totalAmount: 240000,
        grandTotal: 0,
        subtotal: 0,
        paidAmount: 0,
        paymentStatus: 'PAID',
      }),
    ).toEqual({ totalAmount: 240000, subtotal: 240000, paidAmount: 240000 });
    expect(
      effectiveAmounts({
        totalAmount: 100000,
        grandTotal: 100000,
        subtotal: 90000,
        paidAmount: 40000,
        paymentStatus: 'PARTIALLY_PAID',
      }),
    ).toEqual({ totalAmount: 100000, subtotal: 90000, paidAmount: 40000 });
  });

  it('masks a phone and neutralises spreadsheet formulas in CSV', () => {
    expect(maskPhone('0901234528')).toBe('090 ••• •• 28');
    expect(maskPhone('12')).toBeNull();
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(150000)).toBe('150000');
  });
});

describe('cost of an order for sales.order.completed', () => {
  it('sums qty x unit cost of the lines that carry a cost, rounded half up per line', () => {
    expect(
      costAmountOf([
        { qty: '2.000', unitCostSnapshot: 85000 },
        { qty: '0.500', unitCostSnapshot: 333 },
        { qty: '1.000', unitCostSnapshot: 0 },
      ]),
    ).toBe(170000 + 167);
  });

  it('is undefined (omitted) when no line has a cost', () => {
    expect(costAmountOf([])).toBeUndefined();
    expect(
      costAmountOf([{ qty: '3', unitCostSnapshot: 0 }, { quantity: 1 }]),
    ).toBeUndefined();
  });

  it('adds channel, channelId and costAmount, and no costAmount key without a cost', () => {
    expect(
      completedEventExtras({ channelType: 'POS' }, [
        { qty: '1', unitCostSnapshot: 40000 },
      ]),
    ).toEqual({ channel: 'pos', costAmount: 40000 });
    const bare = completedEventExtras(
      { channelType: 'MARKETPLACE', channelId: 'c1' },
      [],
      'shopee',
    );
    expect(bare).toEqual({ channel: 'shopee', channelId: 'c1' });
    expect('costAmount' in bare).toBe(false);
  });
});
