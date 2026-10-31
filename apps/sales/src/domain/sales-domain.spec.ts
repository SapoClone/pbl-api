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
        unitPrice: '150000.00',
        status: 'ACTIVE',
        unitCostSnapshot: '85000.00',
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
        unitPrice: '350000.00',
        status: 'ACTIVE',
        unitCostSnapshot: '190000.00',
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
        unitPrice: '100000.00',
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

      expect(quote.subtotal).toBe('300000.00');
      expect(quote.itemDiscountTotal).toBe('30000.00');
      expect(quote.orderDiscountTotal).toBe('0.00');
      expect(quote.grandTotal).toBe('270000.00');
      expect(quote.lines[0]).toMatchObject({
        lineGross: '300000.00',
        itemDiscountAmount: '30000.00',
        lineAfterItemDiscount: '270000.00',
        allocatedOrderDiscount: '0.00',
        lineNet: '270000.00',
        lineTotal: '270000.00',
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

      expect(quote.subtotal).toBe('500000.00');
      expect(quote.orderDiscountTotal).toBe('10000.00');
      expect(quote.lines[0].allocatedOrderDiscount).toBe('3000.00');
      expect(quote.lines[1].allocatedOrderDiscount).toBe('7000.00');
      expect(quote.grandTotal).toBe('490000.00');
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
      const cashSummary = validateOrderTenders('270000.00', [
        { method: 'CASH', amount: 270000, tenderedCash: 300000 },
      ]);
      expect(cashSummary).toMatchObject({
        totalAllocated: '270000.00',
        totalConfirmed: '270000.00',
        totalCashSales: '270000.00',
        totalChangeDue: '30000.00',
        allConfirmed: true,
        paymentStatus: 'PAID',
      });

      const combinedSummary = validateOrderTenders('500000.00', [
        { method: 'CASH', amount: 200000, tenderedCash: 200000 },
        {
          method: 'BANK_TRANSFER',
          amount: 300000,
          externalRef: 'FT26303001',
          verified: true,
        },
      ]);
      expect(combinedSummary).toMatchObject({
        totalAllocated: '500000.00',
        totalConfirmed: '500000.00',
        totalCashSales: '200000.00',
        allConfirmed: true,
        paymentStatus: 'PAID',
      });
    });

    it('keeps unverified BANK_TRANSFER as PENDING (PARTIALLY_PAID or UNPAID)', () => {
      const unverified = validateOrderTenders('300000.00', [
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
        openingCash: '1000000.00',
        cashSalesTotal: '3000000.00',
        cashRefundsTotal: '200000.00',
        expectedCash: '3800000.00',
        actualCash: '3750000.00',
        variance: '-50000.00',
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
          unitPrice: '150000.00',
          lineNet: '270000.00', // 10% discount applied
          taxAmount: '0.00',
          lineTotal: '270000.00',
          alreadyRefundedAmount: '0.00',
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

      expect(firstReturn.totalRefundAmount).toBe('135000.00');
      expect(firstReturn.isFullOrderReturn).toBe(false);
      expect(firstReturn.lines[0].remainingReturnableAfter).toBe('1.000');

      // Second return attempting 2 units when only 1 remains must fail
      expect(() =>
        calculateReturnRefund(
          [
            {
              ...originalLines[0],
              alreadyReturnedQty: '1.000',
              alreadyRefundedAmount: '135000.00',
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
});
