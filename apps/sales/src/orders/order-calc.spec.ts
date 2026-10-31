import { BadRequestException } from '@nestjs/common';
import {
  allowedActions,
  computeMoney,
  maskPhone,
  paymentStatusOf,
  planPayments,
} from './order-calc';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as { errorCode: string };
  }
  throw new Error('did not throw');
};

describe('order maths', () => {
  describe('computeMoney', () => {
    it.each([
      // lines, discount, shipping, [subtotal, total, feePayer]
      [[[2, 120000]], 0, undefined, [240000, 240000, null]],
      [
        [
          [2, 290000],
          [1, 150000],
        ],
        0,
        { shippingFee: 30000 },
        [730000, 760000, 'customer'],
      ],
      [
        [[1, 100000]],
        30000,
        { shippingFee: 20000, feePayer: 'shop' },
        [100000, 70000, 'shop'],
      ],
      [[[3, 0]], 0, undefined, [0, 0, null]],
      [
        [[1, 50000]],
        50000,
        { shippingFee: 0, feePayer: 'customer' },
        [50000, 0, null],
      ],
    ] as const)(
      'lines %j discount %d shipping %j',
      (lines, discount, shipping, [sub, total, payer]) => {
        const money = computeMoney(
          lines.map(([quantity, unitPrice]) => ({ quantity, unitPrice })),
          discount,
          shipping as never,
        );
        expect(money).toMatchObject({
          subtotal: sub,
          totalAmount: total,
          feePayer: payer,
        });
      },
    );

    it('refuses a discount above the subtotal with S023', () => {
      expect(
        code(() => computeMoney([{ quantity: 1, unitPrice: 100 }], 101)),
      ).toMatchObject({ errorCode: 'S023' });
    });
  });

  it.each([
    [1000, 0, false, 'unpaid'],
    [1000, 400, false, 'partially_paid'],
    [1000, 1000, false, 'paid'],
    [1000, 1200, false, 'paid'],
    [1000, 0, true, 'refunded'],
    [1000, 300, true, 'partially_paid'],
    [0, 0, false, 'paid'],
  ])(
    'paymentStatusOf(total %d, paid %d, refunded %s) is %s',
    (t, p, r, expected) => {
      expect(paymentStatusOf(t, p, r)).toBe(expected);
    },
  );

  describe('planPayments', () => {
    it('a legacy completed sale is paid in full with its method', () => {
      expect(
        planPayments({
          orderStatus: 'completed',
          totalAmount: 500,
          paymentMethod: 'card',
        }),
      ).toEqual({
        rows: [{ method: 'card', amount: 500 }],
        paidAmount: 500,
        changeAmount: 0,
        method: 'card',
      });
    });

    it.each([
      ['cod on a completed sale', 'completed', 'cod'],
      ['a confirmed order', 'confirmed', 'cash'],
      ['a draft', 'draft', 'cash'],
    ] as const)(
      'records nothing paid for %s',
      (_n, orderStatus, paymentMethod) => {
        expect(
          planPayments({ orderStatus, totalAmount: 500, paymentMethod }),
        ).toMatchObject({
          rows: [],
          paidAmount: 0,
        });
      },
    );

    it('takes cash change off the cash rows', () => {
      expect(
        planPayments({
          orderStatus: 'completed',
          totalAmount: 850000,
          source: 'pos',
          payments: [{ method: 'cash', amount: 1000000 }],
        }),
      ).toMatchObject({
        rows: [{ method: 'cash', amount: 850000 }],
        paidAmount: 850000,
        changeAmount: 150000,
      });
      expect(
        planPayments({
          orderStatus: 'completed',
          totalAmount: 100,
          payments: [
            { method: 'card', amount: 60 },
            { method: 'cash', amount: 60 },
          ],
        }),
      ).toMatchObject({
        paidAmount: 100,
        changeAmount: 20,
        rows: [
          { method: 'card', amount: 60 },
          { method: 'cash', amount: 40 },
        ],
      });
    });

    it('refuses an excess no cash can absorb (S017) and a short pos checkout (S011)', () => {
      expect(
        code(() =>
          planPayments({
            orderStatus: 'confirmed',
            totalAmount: 100,
            payments: [{ method: 'transfer', amount: 150 }],
          }),
        ),
      ).toMatchObject({ errorCode: 'S017' });
      expect(
        code(() =>
          planPayments({
            orderStatus: 'completed',
            totalAmount: 100,
            source: 'pos',
            payments: [{ method: 'cash', amount: 50 }],
          }),
        ),
      ).toMatchObject({ errorCode: 'S011' });
    });

    it('a manual completed order may be partly paid', () => {
      expect(
        planPayments({
          orderStatus: 'completed',
          totalAmount: 100,
          source: 'manual',
          payments: [{ method: 'transfer', amount: 50 }],
        }),
      ).toMatchObject({ paidAmount: 50 });
    });
  });

  it.each([
    ['draft', 'unfulfilled', ['confirm', 'cancel']],
    ['new', 'unfulfilled', ['confirm', 'cancel']],
    ['confirmed', 'unfulfilled', ['pack', 'complete', 'cancel']],
    ['confirmed', 'packing', ['ship', 'complete', 'cancel']],
    ['confirmed', 'shipping', ['complete']],
    ['completed', 'delivered', []],
    ['cancelled', 'unfulfilled', []],
  ])('allowedActions(%s, %s)', (status, fulfillmentStatus, expected) => {
    expect(allowedActions({ status, fulfillmentStatus })).toEqual(expected);
  });

  it.each([
    ['0901234528', '090 ••• •• 28'],
    ['+84 901 234 528', '849 ••• •• 28'],
    [null, null],
    ['123', '•••'],
  ])('maskPhone(%s)', (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });
});
