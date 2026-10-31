import { discountTierFor } from '../presentation/access';
import {
  AuthoritativeCatalogVariant,
  SalesDomainErrorCode,
  assertCanCancelOrder,
  assertDiscountAuthority,
  calculateOrderQuote,
  calculateReturnRefund,
  calculateShiftCloseSummary,
  validateOrderStateCombination,
  validateOrderTenders,
} from './sales-domain';

describe('Sales M3 Pure Domain Layer', () => {
  const catalogVariants = new Map<string, AuthoritativeCatalogVariant>([
    [
      'var-tshirt-blk-m',
      {
        variantId: 'var-tshirt-blk-m',
        productId: 'prod-tshirt',
        skuCode: 'TSHIRT-BLK-M',
        barcode: '8930001',
        productName: 'Áo thun cotton nam',
        variantName: 'Đen / M',
        unitCode: 'PCS',
        conversionFactor: '1.0000',
        unitPrice: 150000,
        status: 'ACTIVE',
        unitCostSnapshot: 85000,
      },
    ],
    [
      'var-jeans-blu-32',
      {
        variantId: 'var-jeans-blu-32',
        productId: 'prod-jeans',
        skuCode: 'JEANS-BLU-32',
        barcode: '8930002',
        productName: 'Quần jeans nam',
        variantName: 'Xanh / 32',
        unitCode: 'PCS',
        conversionFactor: '1.0000',
        unitPrice: 350000,
        status: 'ACTIVE',
        unitCostSnapshot: 190000,
      },
    ],
    [
      'var-inactive',
      {
        variantId: 'var-inactive',
        productId: 'prod-inactive',
        skuCode: 'OLD-SKU',
        barcode: null,
        productName: 'Sản phẩm ngừng bán',
        variantName: 'Default',
        unitCode: 'PCS',
        conversionFactor: '1.0000',
        unitPrice: 100000,
        status: 'INACTIVE',
      },
    ],
  ]);

  describe('Price waterfall & discount allocation', () => {
    it('calculates exact item and order percentage discounts without floating-point drift', () => {
      const quote = calculateOrderQuote(
        {
          lines: [
            {
              variantId: 'var-tshirt-blk-m',
              qty: 2,
              expectedUnitPrice: 150000,
              discountType: 'PERCENT',
              discountValue: 10,
            },
          ],
        },
        catalogVariants,
      );

      expect(quote.subtotal).toBe(300000);
      expect(quote.itemDiscountTotal).toBe(30000);
      expect(quote.orderDiscountTotal).toBe(0);
      expect(quote.grandTotal).toBe(270000);
      expect(quote.lines[0]).toMatchObject({
        lineGross: 300000,
        itemDiscountAmount: 30000,
        lineAfterItemDiscount: 270000,
        allocatedOrderDiscount: 0,
        lineNet: 270000,
        lineTotal: 270000,
      });
    });

    it('allocates fixed order discounts proportionally across multiple lines with exact residual reconciliation', () => {
      const quote = calculateOrderQuote(
        {
          lines: [
            { variantId: 'var-tshirt-blk-m', qty: 1 }, // 150,000
            { variantId: 'var-jeans-blu-32', qty: 1 }, // 350,000
          ],
          orderDiscountType: 'FIXED',
          orderDiscountValue: 10000, // 3,000 + 7,000 = 10,000
        },
        catalogVariants,
      );

      expect(quote.subtotal).toBe(500000);
      expect(quote.orderDiscountTotal).toBe(10000);
      expect(quote.lines[0].allocatedOrderDiscount).toBe(3000);
      expect(quote.lines[1].allocatedOrderDiscount).toBe(7000);
      expect(quote.grandTotal).toBe(490000);
    });

    it('rejects stale client prices with PRICE_CHANGED and inactive products with PRODUCT_NOT_SELLABLE', () => {
      expect(() =>
        calculateOrderQuote(
          {
            lines: [
              {
                variantId: 'var-tshirt-blk-m',
                qty: 1,
                expectedUnitPrice: 120000,
              },
            ],
          },
          catalogVariants,
        ),
      ).toThrow(
        expect.objectContaining({ code: SalesDomainErrorCode.PRICE_CHANGED }),
      );

      expect(() =>
        calculateOrderQuote(
          {
            lines: [{ variantId: 'var-inactive', qty: 1 }],
          },
          catalogVariants,
        ),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.PRODUCT_NOT_SELLABLE,
        }),
      );
    });
  });

  describe('RBAC discount authority', () => {
    it('enforces the sales_staff 10% limit unless override permission or approval is present', () => {
      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 10,
          role: 'sales_staff',
        }),
      ).not.toThrow();

      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 15,
          role: 'sales_staff',
        }),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.DISCOUNT_APPROVAL_REQUIRED,
        }),
      );

      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 25,
          role: 'branch_manager',
        }),
      ).not.toThrow();

      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 50,
          role: 'sales_staff',
          permissions: ['sales.pos.discount.override'],
        }),
      ).not.toThrow();
    });
  });

  describe('discount tier from permissions', () => {
    it('owner (*) gets 100, whoever approves orders 30, others 10', () => {
      expect(discountTierFor(['*'])).toBe('owner');
      expect(discountTierFor(['orders.approve'])).toBe('branch_manager');
      expect(discountTierFor(['orders.create'])).toBe('sales_staff');
      expect(discountTierFor([])).toBe('sales_staff');
    });

    it('accepts the legacy role names as input', () => {
      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 25,
          role: 'manager',
        }),
      ).not.toThrow();
      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 15,
          role: 'cashier',
        }),
      ).toThrow();
    });
  });

  describe('Tender validation & cash change calculation', () => {
    it('computes change due on CASH tender and supports COMBINED cash + bank transfer', () => {
      const cashSummary = validateOrderTenders(270000, [
        { method: 'CASH', amount: 270000, tenderedCash: 300000 },
      ]);
      expect(cashSummary).toMatchObject({
        totalAllocated: 270000,
        totalConfirmed: 270000,
        totalCashSales: 270000,
        totalChangeDue: 30000,
        allConfirmed: true,
        paymentStatus: 'PAID',
      });

      const combinedSummary = validateOrderTenders(500000, [
        { method: 'CASH', amount: 200000, tenderedCash: 200000 },
        {
          method: 'BANK_TRANSFER',
          amount: 300000,
          externalRef: 'FT26303001',
          verified: true,
        },
      ]);
      expect(combinedSummary).toMatchObject({
        totalAllocated: 500000,
        totalConfirmed: 500000,
        totalCashSales: 200000,
        allConfirmed: true,
        paymentStatus: 'PAID',
      });
    });

    it('keeps unverified BANK_TRANSFER as PENDING (PARTIALLY_PAID or UNPAID)', () => {
      const unverified = validateOrderTenders(300000, [
        { method: 'BANK_TRANSFER', amount: 300000 },
      ]);
      expect(unverified.allConfirmed).toBe(false);
      expect(unverified.paymentStatus).toBe('UNPAID');
    });
  });

  describe('Shift close cash reconciliation', () => {
    it('reconciles opening cash, cash sales, cash refunds, and actual cash variance', () => {
      const summary = calculateShiftCloseSummary({
        openingCash: 1000000,
        cashSalesTotal: 3000000,
        cashRefundsTotal: 200000,
        actualCash: 3750000,
      });
      expect(summary).toEqual({
        openingCash: 1000000,
        cashSalesTotal: 3000000,
        cashRefundsTotal: 200000,
        expectedCash: 3800000,
        actualCash: 3750000,
        variance: -50000,
      });
    });
  });

  describe('Partial returns & pro-rated refund calculation', () => {
    it('calculates pro-rated refund from original discounted line total and prevents over-returns', () => {
      const originalLines = [
        {
          orderItemId: 'item-1',
          variantId: 'var-tshirt-blk-m',
          skuCode: 'TSHIRT-BLK-M',
          productName: 'Áo thun cotton nam',
          soldQty: '2.000',
          alreadyReturnedQty: '0.000',
          unitPrice: 150000,
          lineNet: 270000, // 10% discount applied
          taxAmount: 0,
          lineTotal: 270000,
          alreadyRefundedAmount: 0,
        },
      ];

      const firstReturn = calculateReturnRefund(originalLines, [
        {
          orderItemId: 'item-1',
          returnQty: 1,
          disposition: 'RESTOCK',
          reason: 'Customer changed size',
        },
      ]);

      expect(firstReturn.totalRefundAmount).toBe(135000);
      expect(firstReturn.isFullOrderReturn).toBe(false);
      expect(firstReturn.lines[0].remainingReturnableAfter).toBe('1.000');

      // Second return attempting 2 units when only 1 remains must fail
      expect(() =>
        calculateReturnRefund(
          [
            {
              ...originalLines[0],
              alreadyReturnedQty: '1.000',
              alreadyRefundedAmount: 135000,
            },
          ],
          [{ orderItemId: 'item-1', returnQty: 2, disposition: 'RESTOCK' }],
        ),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.RETURN_QUANTITY_EXCEEDED,
        }),
      );
    });
  });

  describe('3D Order State Machine', () => {
    it('rejects invalid state combinations and forbids cancelling completed orders', () => {
      expect(() =>
        validateOrderStateCombination({
          orderStatus: 'CANCELLED',
          paymentStatus: 'UNPAID',
          fulfillmentStatus: 'RESERVED',
        }),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.ORDER_INVALID_STATE,
        }),
      );

      expect(() =>
        assertCanCancelOrder({
          orderStatus: 'COMPLETED',
          fulfillmentStatus: 'FULFILLED',
        }),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.ORDER_ALREADY_COMPLETED,
        }),
      );
    });
  });

  describe('Integer VND money (phase 3)', () => {
    const line = (over: Record<string, unknown> = {}) => ({
      variantId: 'var-tshirt-blk-m',
      qty: 1,
      ...over,
    });

    it('rejects a fractional or string money input with a 422 validation error', () => {
      for (const bad of [
        { expectedUnitPrice: 150000.5 },
        { expectedUnitPrice: '150000' },
        { discountType: 'FIXED', discountValue: 100.5 },
      ]) {
        expect(() =>
          calculateOrderQuote({ lines: [line(bad) as never] }, catalogVariants),
        ).toThrow(expect.objectContaining({ httpStatus: 422 }));
      }
      expect(() =>
        calculateOrderQuote(
          { lines: [line()], shippingFee: 1000.25 },
          catalogVariants,
        ),
      ).toThrow(expect.objectContaining({ httpStatus: 422 }));
      expect(() =>
        calculateOrderQuote(
          {
            lines: [line()],
            orderDiscountType: 'FIXED',
            orderDiscountValue: 0.5,
          },
          catalogVariants,
        ),
      ).toThrow(expect.objectContaining({ httpStatus: 422 }));
      expect(() =>
        validateOrderTenders(150000, [
          { method: 'CASH', amount: 150000.4 as number },
        ]),
      ).toThrow(expect.objectContaining({ httpStatus: 422 }));
      expect(() =>
        calculateShiftCloseSummary({
          openingCash: 0,
          cashSalesTotal: 0,
          cashRefundsTotal: 0,
          actualCash: '10' as never,
        }),
      ).toThrow(expect.objectContaining({ httpStatus: 422 }));
    });

    it('returns only safe-integer numbers, never strings', () => {
      const quote = calculateOrderQuote(
        { lines: [line({ qty: '1.5', taxRatePercent: 8 })] },
        catalogVariants,
      );
      const moneyValues = [
        quote.subtotal,
        quote.itemDiscountTotal,
        quote.orderDiscountTotal,
        quote.promotionDiscountTotal,
        quote.totalDiscount,
        quote.shippingFee,
        quote.taxTotal,
        quote.grandTotal,
        ...quote.lines.flatMap((l) => [
          l.unitPrice,
          l.lineGross,
          l.lineNet,
          l.taxAmount,
          l.lineTotal,
          l.unitCostSnapshot,
        ]),
      ];
      for (const v of moneyValues) {
        expect(typeof v).toBe('number');
        expect(Number.isSafeInteger(v)).toBe(true);
      }
    });

    it('rounds half up at each line: gross (fractional qty), percent discount, tax', () => {
      // 0.003 x 150000 = 450 exactly; 1.5 x 150000 = 225000
      // qty 0.0035 is not allowed (3 decimals), use 0.001 x 150000 = 150
      const tiny = calculateOrderQuote(
        { lines: [line({ qty: '0.001' })] },
        catalogVariants,
      );
      expect(tiny.lines[0].lineGross).toBe(150);
      // 3.333 x 150000 = 499950 ; 10% = 49995 ; net 449955 ; 8% tax = 35996.4 -> 35996
      const q = calculateOrderQuote(
        {
          lines: [
            line({
              qty: '3.333',
              discountType: 'PERCENT',
              discountValue: 10,
              taxRatePercent: 8,
            }),
          ],
        },
        catalogVariants,
      );
      expect(q.lines[0]).toMatchObject({
        lineGross: 499950,
        itemDiscountAmount: 49995,
        lineNet: 449955,
        taxAmount: 35996,
        lineTotal: 485951,
      });
      // half exactly: 0.5 VND rounds up. 0.005 of 100 -> use 7.5% of 10 VND is not available;
      // 0.001 x 150000 = 150, tax 5% = 7.5 -> 8
      const half = calculateOrderQuote(
        { lines: [line({ qty: '0.001', taxRatePercent: 5 })] },
        catalogVariants,
      );
      expect(half.lines[0].taxAmount).toBe(8);
    });

    it('totals equal the sum of the rounded lines (tax and order discount shares)', () => {
      const quote = calculateOrderQuote(
        {
          lines: [
            line({ qty: '1.333', taxRatePercent: 10 }),
            { variantId: 'var-jeans-blu-32', qty: '2.001', taxRatePercent: 8 },
            line({ qty: '0.7', taxRatePercent: 5 }),
          ],
          orderDiscountType: 'PERCENT',
          orderDiscountValue: 7.5,
          shippingFee: 25000,
        },
        catalogVariants,
      );
      const sum = (f: (l: (typeof quote.lines)[number]) => number) =>
        quote.lines.reduce((acc, l) => acc + f(l), 0);
      expect(quote.subtotal).toBe(sum((l) => l.lineGross));
      expect(quote.taxTotal).toBe(sum((l) => l.taxAmount));
      expect(quote.orderDiscountTotal).toBe(
        sum((l) => l.allocatedOrderDiscount),
      );
      expect(sum((l) => l.lineTotal)).toBe(
        quote.subtotal -
          quote.itemDiscountTotal -
          quote.orderDiscountTotal +
          quote.taxTotal,
      );
      expect(quote.grandTotal).toBe(sum((l) => l.lineTotal) + 25000);
    });

    it('splits a refund by rounding half up and the last unit takes the residual', () => {
      const original = [
        {
          orderItemId: 'item-1',
          variantId: 'v',
          skuCode: 'S',
          productName: 'P',
          soldQty: '3.000',
          alreadyReturnedQty: '0.000',
          unitPrice: 33334,
          lineNet: 100001,
          taxAmount: 0,
          lineTotal: 100001,
          alreadyRefundedAmount: 0,
        },
      ];
      const first = calculateReturnRefund(original, [
        { orderItemId: 'item-1', returnQty: 1, disposition: 'RESTOCK' },
      ]);
      // 100001 / 3 = 33333.67 -> 33334
      expect(first.totalRefundAmount).toBe(33334);
      const second = calculateReturnRefund(
        [
          {
            ...original[0],
            alreadyReturnedQty: '1.000',
            alreadyRefundedAmount: 33334,
          },
        ],
        [{ orderItemId: 'item-1', returnQty: 2, disposition: 'RESTOCK' }],
      );
      // the rest of the line: refunds add up to the line total exactly
      expect(33334 + second.totalRefundAmount).toBe(100001);
      expect(second.isFullOrderReturn).toBe(true);
      expect(Number.isSafeInteger(second.lines[0].unitRefundAmount)).toBe(true);
    });
  });
});
