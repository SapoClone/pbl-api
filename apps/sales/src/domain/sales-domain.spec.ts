import { discountTierFor } from '../presentation/access';
import {
  AuthoritativeCatalogVariant,
  DiscountPercentage,
  OrderAggregate,
  SalesDomainErrorCode,
  StockQuantity,
  VndMoney,
  assertCanCancelOrder,
  assertDiscountAuthority,
  calculateItemDiscount,
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

    it('does not lift the limit for an approver name the caller typed in', () => {
      expect(() =>
        assertDiscountAuthority({
          effectiveDiscountPercent: 50,
          role: 'sales_staff',
          discountApprovedBy: 'manager',
        }),
      ).toThrow(
        expect.objectContaining({
          code: SalesDomainErrorCode.DISCOUNT_APPROVAL_REQUIRED,
        }),
      );
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

  describe('3D Order State Machine & OrderAggregate', () => {
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

    it('enforces OrderAggregate lifecycle transitions and VndMoney/StockQuantity/DiscountPercentage Value Objects', () => {
      const money = VndMoney.of(150000).add(VndMoney.of(50000));
      expect(money.toString()).toBe('200000');
      const qty = StockQuantity.of('2.500');
      expect(qty.toString()).toBe('2.500');
      const pct = DiscountPercentage.of(15);
      expect(pct.basisPoints).toBe(1500n);

      const agg = new OrderAggregate(
        'ord-1',
        'ten-1',
        'SO-001',
        'DRAFT',
        'PAID',
        'UNFULFILLED',
        1,
      );

      expect(() => agg.assertEditable()).not.toThrow();
      agg.confirmWithReservation('wh-1', 'res-100');
      expect(agg.orderStatus).toBe('CONFIRMED');
      expect(agg.fulfillmentStatus).toBe('RESERVED');
      expect(agg.reservationId).toBe('res-100');
      expect(() => agg.assertEditable()).toThrow();

      agg.markFulfilled('FUL-001');
      expect(agg.orderStatus).toBe('COMPLETED');
      expect(agg.fulfillmentStatus).toBe('FULFILLED');
      expect(() => agg.cancel('Too late')).toThrow(
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

  describe('Chức năng 3 (Hius): Bổ sung kiểm thử giá trị biên & tổ hợp cho Tính chiết khấu và giới hạn theo quyền (FR-M06-03, FR-M06-05, BR-02)', () => {
    describe('UT-DISC-BVA: Kiểm tra biên phần trăm (%) và tính toán chiết khấu (calculateItemDiscount)', () => {
      const lineGross = 100000n;

      it.each([
        { percent: 0, expectedDiscount: 0n, desc: 'Mốc 0% (không chiết khấu)' },
        {
          percent: 10,
          expectedDiscount: 10000n,
          desc: 'Mốc 10% (trần sales_staff)',
        },
        {
          percent: 30,
          expectedDiscount: 30000n,
          desc: 'Mốc 30% (trần branch_manager)',
        },
        {
          percent: 50,
          expectedDiscount: 50000n,
          desc: 'Mốc 50% (giảm một nửa)',
        },
        {
          percent: 100,
          expectedDiscount: 100000n,
          desc: 'Mốc 100% (miễn phí hoàn toàn)',
        },
      ])(
        'Hợp lệ: $desc với percent = $percent% -> discount = $expectedDiscount VND',
        ({ percent, expectedDiscount }) => {
          const discount = calculateItemDiscount(lineGross, 'PERCENT', percent);
          expect(discount).toBe(expectedDiscount);
        },
      );

      it.each([
        { percent: -0.01, desc: 'Biên dưới âm nhỏ nhất (-0.01%)' },
        { percent: -5, desc: 'Số âm (-5%)' },
        { percent: 100.01, desc: 'Biên trên vượt quá 100% (100.01%)' },
        { percent: 105, desc: 'Vượt quá 100% (105%)' },
        { percent: Number.NaN, desc: 'Giá trị NaN không hợp lệ' },
        { percent: Number.POSITIVE_INFINITY, desc: 'Dương vô cùng' },
      ])(
        'Bất hợp lệ: ném lỗi 422 INVALID_DISCOUNT khi $desc ($percent)',
        ({ percent }) => {
          expect(() =>
            calculateItemDiscount(lineGross, 'PERCENT', percent),
          ).toThrow(
            expect.objectContaining({
              code: SalesDomainErrorCode.INVALID_DISCOUNT,
              httpStatus: 422,
            }),
          );
        },
      );
    });

    describe('UT-DISC-ROLE: Kiểm tra biên trần chiết khấu theo phân quyền RBAC (assertDiscountAuthority)', () => {
      it.each([
        { role: 'sales_staff', percent: 0, desc: 'sales_staff tại 0%' },
        {
          role: 'sales_staff',
          percent: 10,
          desc: 'sales_staff tại đúng trần 10%',
        },
        { role: 'branch_manager', percent: 0, desc: 'branch_manager tại 0%' },
        {
          role: 'branch_manager',
          percent: 30,
          desc: 'branch_manager tại đúng trần 30%',
        },
        { role: 'owner', percent: 0, desc: 'owner tại 0%' },
        { role: 'owner', percent: 100, desc: 'owner tại đúng trần 100%' },
        {
          role: 'manager',
          percent: 30,
          desc: 'legacy manager tại đúng trần 30%',
        },
        {
          role: 'cashier',
          percent: 10,
          desc: 'legacy cashier tại đúng trần 10%',
        },
        {
          role: undefined,
          percent: 10,
          desc: 'role không truyền (undefined) mặc định trần 10%',
        },
        {
          role: 'unknown_role',
          percent: 10,
          desc: 'role lạ không xác định mặc định trần 10%',
        },
      ])(
        'Hợp lệ không ném lỗi: $desc (role: $role, percent: $percent%)',
        ({ role, percent }) => {
          expect(() =>
            assertDiscountAuthority({
              role,
              effectiveDiscountPercent: percent,
            }),
          ).not.toThrow();
        },
      );

      it.each([
        {
          role: 'sales_staff',
          percent: 10.01,
          limit: 10,
          desc: 'sales_staff vượt trần 0.01% (10.01%)',
        },
        {
          role: 'sales_staff',
          percent: 15,
          limit: 10,
          desc: 'sales_staff vượt trần (15%)',
        },
        {
          role: 'branch_manager',
          percent: 30.01,
          limit: 30,
          desc: 'branch_manager vượt trần 0.01% (30.01%)',
        },
        {
          role: 'branch_manager',
          percent: 35,
          limit: 30,
          desc: 'branch_manager vượt trần (35%)',
        },
        {
          role: 'manager',
          percent: 30.01,
          limit: 30,
          desc: 'legacy manager vượt trần 0.01% (30.01%)',
        },
        {
          role: 'cashier',
          percent: 10.01,
          limit: 10,
          desc: 'legacy cashier vượt trần 0.01% (10.01%)',
        },
        {
          role: undefined,
          percent: 10.01,
          limit: 10,
          desc: 'role không truyền vượt trần mặc định 10% (10.01%)',
        },
        {
          role: 'trainee_intern',
          percent: 10.01,
          limit: 10,
          desc: 'role lạ vượt trần mặc định 10% (10.01%)',
        },
      ])(
        'Vượt trần ném lỗi 403 DISCOUNT_APPROVAL_REQUIRED: $desc',
        ({ role, percent, limit }) => {
          expect(() =>
            assertDiscountAuthority({
              role,
              effectiveDiscountPercent: percent,
            }),
          ).toThrow(
            expect.objectContaining({
              code: SalesDomainErrorCode.DISCOUNT_APPROVAL_REQUIRED,
              httpStatus: 403,
              details: expect.objectContaining({
                effectiveDiscountPercent: percent,
                maxAllowedPercent: limit,
              }),
            }),
          );
        },
      );

      it.each([
        {
          role: 'sales_staff',
          percent: 99.99,
          permissions: ['sales.pos.discount.override'],
          desc: 'sales_staff với quyền sales.pos.discount.override vượt mức 99.99%',
        },
        {
          role: 'cashier',
          percent: 50,
          permissions: ['sales.pos.discount.override'],
          desc: 'legacy cashier với quyền sales.pos.discount.override áp dụng 50%',
        },
        {
          role: 'unknown_role',
          percent: 100,
          permissions: ['*'],
          desc: 'role không xác định với wildcard (*) áp dụng 100%',
        },
      ])(
        'Phân quyền đặc biệt cho phép vượt trần không lỗi: $desc',
        ({ role, percent, permissions }) => {
          expect(() =>
            assertDiscountAuthority({
              role,
              effectiveDiscountPercent: percent,
              permissions,
            }),
          ).not.toThrow();
        },
      );
    });

    describe('UT-DISC-FIXED: Kiểm tra chiết khấu số tiền cố định (FIXED) và làm tròn half-up VND', () => {
      const lineGross = 150000n;

      it('giảm đúng bằng giá trị món hàng -> thành tiền = 0đ (Hợp lệ)', () => {
        const discount = calculateItemDiscount(lineGross, 'FIXED', 150000);
        expect(discount).toBe(150000n);
        expect(lineGross - discount).toBe(0n);
      });

      it('giảm cố định đúng bằng tổng đơn trong calculateOrderQuote -> grandTotal = 0đ (Hợp lệ)', () => {
        const quote = calculateOrderQuote(
          {
            lines: [{ variantId: 'var-tshirt-blk-m', qty: 1 }], // 150,000
            orderDiscountType: 'FIXED',
            orderDiscountValue: 150000,
          },
          catalogVariants,
        );
        expect(quote.subtotal).toBe(150000);
        expect(quote.totalDiscount).toBe(150000);
        expect(quote.grandTotal).toBe(0);
      });

      it('giảm cố định lớn hơn giá trị món hàng -> ném lỗi 422 INVALID_DISCOUNT', () => {
        expect(() => calculateItemDiscount(lineGross, 'FIXED', 150001)).toThrow(
          expect.objectContaining({
            code: SalesDomainErrorCode.INVALID_DISCOUNT,
            httpStatus: 422,
          }),
        );
      });

      it('giảm cố định lớn hơn tổng đơn trong calculateOrderQuote -> ném lỗi 422 INVALID_DISCOUNT', () => {
        expect(() =>
          calculateOrderQuote(
            {
              lines: [{ variantId: 'var-tshirt-blk-m', qty: 1 }], // 150,000
              orderDiscountType: 'FIXED',
              orderDiscountValue: 150001,
            },
            catalogVariants,
          ),
        ).toThrow(
          expect.objectContaining({
            code: SalesDomainErrorCode.INVALID_DISCOUNT,
            httpStatus: 422,
          }),
        );
      });

      it.each([
        {
          gross: 99999n,
          percent: 12.5,
          expectedDiscount: 12500n,
          desc: '12.5% của 99.999đ (12499.875) làm tròn lên 12.500đ',
        },
        {
          gross: 100001n,
          percent: 12.5,
          expectedDiscount: 12500n,
          desc: '12.5% của 100.001đ (12500.125) làm tròn xuống 12.500đ',
        },
        {
          gross: 10n,
          percent: 5,
          expectedDiscount: 1n,
          desc: '5% của 10đ (0.5) làm tròn half-up lên 1đ',
        },
        {
          gross: 10n,
          percent: 4.9,
          expectedDiscount: 0n,
          desc: '4.9% của 10đ (0.49) làm tròn xuống 0đ',
        },
      ])(
        'Làm tròn half-up chính xác theo đơn vị VND: $desc',
        ({ gross, percent, expectedDiscount }) => {
          const discount = calculateItemDiscount(gross, 'PERCENT', percent);
          expect(discount).toBe(expectedDiscount);
        },
      );
    });
  });

  describe('Chức năng 4 (Hius): Bổ sung kiểm thử giá trị biên & tổ hợp cho Thanh toán kết hợp và tiền thừa (FR-M06-08, BR-02)', () => {
    describe('UT-PAY-VALID: Thanh toán hợp lệ, kết hợp phương thức và tính tiền thừa', () => {
      it('kết hợp Tiền mặt + Chuyển khoản (có verified=true và externalRef) -> status: CONFIRMED, allConfirmed: true, paymentStatus: PAID', () => {
        const summary = validateOrderTenders(500000, [
          { method: 'CASH', amount: 200000, tenderedCash: 250000 },
          {
            method: 'BANK_TRANSFER',
            amount: 300000,
            verified: true,
            externalRef: 'FT26303001',
          },
        ]);

        expect(summary).toMatchObject({
          totalAllocated: 500000,
          totalConfirmed: 500000,
          totalCashSales: 200000,
          totalChangeDue: 50000,
          allConfirmed: true,
          paymentStatus: 'PAID',
        });
        expect(summary.tenders[0]).toMatchObject({
          method: 'CASH',
          amount: 200000,
          tenderedCash: 250000,
          changeDue: 50000,
          status: 'CONFIRMED',
        });
        expect(summary.tenders[1]).toMatchObject({
          method: 'BANK_TRANSFER',
          amount: 300000,
          status: 'CONFIRMED',
          externalRef: 'FT26303001',
        });
      });

      it.each([
        {
          amount: 200000,
          tenderedCash: 250000,
          expectedChange: 50000,
          desc: 'khách đưa 250.000đ cho khoản 200.000đ -> thối 50.000đ',
        },
        {
          amount: 100000,
          tenderedCash: 1000000,
          expectedChange: 900000,
          desc: 'khách đưa tờ 1.000.000đ lớn hơn nhiều so với 100.000đ -> thối 900.000đ',
        },
        {
          amount: 150000,
          tenderedCash: 150000,
          expectedChange: 0,
          desc: 'khách trả vừa khít tiền mặt (150.000đ) -> thối 0đ',
        },
        {
          amount: 300000,
          tenderedCash: undefined,
          expectedChange: 0,
          desc: 'không truyền tenderedCash (mặc định bằng amount) -> thối 0đ',
        },
      ])(
        'Tính chính xác tiền thừa (changeDue = tenderedCash - amount): $desc',
        ({ amount, tenderedCash, expectedChange }) => {
          const summary = validateOrderTenders(amount, [
            { method: 'CASH', amount, tenderedCash },
          ]);
          expect(summary.totalChangeDue).toBe(expectedChange);
          expect(summary.tenders[0].changeDue).toBe(expectedChange);
        },
      );

      it('đơn hàng 0 đồng: thanh toán tiền mặt 0đ -> changeDue = 0, allConfirmed = true, paymentStatus = PAID', () => {
        const summary = validateOrderTenders(0, [
          { method: 'CASH', amount: 0, tenderedCash: 0 },
        ]);
        expect(summary).toMatchObject({
          totalAllocated: 0,
          totalConfirmed: 0,
          totalCashSales: 0,
          totalChangeDue: 0,
          allConfirmed: true,
          paymentStatus: 'PAID',
        });
      });

      it.each([
        {
          tenders: [
            {
              method: 'BANK_TRANSFER' as const,
              amount: 300000,
              verified: false,
              externalRef: 'TX123',
            },
          ],
          expectedPaymentStatus: 'UNPAID',
          desc: 'Chuyển khoản có externalRef nhưng verified = false -> PENDING / UNPAID',
        },
        {
          tenders: [
            {
              method: 'BANK_TRANSFER' as const,
              amount: 300000,
              verified: true,
              externalRef: undefined,
            },
          ],
          expectedPaymentStatus: 'UNPAID',
          desc: 'Chuyển khoản có verified = true nhưng thiếu externalRef -> PENDING / UNPAID',
        },
        {
          tenders: [
            { method: 'CASH' as const, amount: 100000, tenderedCash: 100000 },
            {
              method: 'BANK_TRANSFER' as const,
              amount: 200000,
              verified: false,
              externalRef: 'TX123',
            },
          ],
          expectedPaymentStatus: 'PARTIALLY_PAID',
          desc: 'Kết hợp tiền mặt (xác nhận) + chuyển khoản thiếu verified -> PARTIALLY_PAID',
        },
        {
          tenders: [{ method: 'COD' as const, amount: 300000 }],
          expectedPaymentStatus: 'UNPAID',
          desc: 'COD luôn luôn ở trạng thái PENDING -> UNPAID',
        },
      ])(
        'Kiểm tra trạng thái xác nhận và thanh toán tổng: $desc',
        ({ tenders, expectedPaymentStatus }) => {
          const total = tenders.reduce((acc, t) => acc + t.amount, 0);
          const summary = validateOrderTenders(total, tenders);
          expect(summary.allConfirmed).toBe(false);
          expect(summary.paymentStatus).toBe(expectedPaymentStatus);
        },
      );
    });

    describe('UT-PAY-ERROR: Trường hợp lỗi biên (ném lỗi 422 PAYMENT_AMOUNT_MISMATCH hoặc VALIDATION_ERROR)', () => {
      it.each([
        {
          amount: 100000,
          tenderedCash: 99999,
          desc: 'tiền khách đưa thiếu 1đ (tenderedCash 99.999đ < amount 100.000đ)',
        },
        {
          amount: 50000,
          tenderedCash: 0,
          desc: 'khách đưa 0đ cho khoản phân bổ 50.000đ',
        },
      ])(
        'Tiền khách đưa ít hơn phần tiền mặt ném lỗi 422 PAYMENT_AMOUNT_MISMATCH: $desc',
        ({ amount, tenderedCash }) => {
          expect(() =>
            validateOrderTenders(amount, [
              { method: 'CASH', amount, tenderedCash },
            ]),
          ).toThrow(
            expect.objectContaining({
              code: SalesDomainErrorCode.PAYMENT_AMOUNT_MISMATCH,
              httpStatus: 422,
            }),
          );
        },
      );

      it.each([
        {
          grandTotal: 100000,
          tenders: [{ method: 'CASH' as const, amount: 90000 }],
          desc: 'tổng phân bổ thiếu 10.000đ (90.000đ vs 100.000đ)',
        },
        {
          grandTotal: 100000,
          tenders: [{ method: 'CASH' as const, amount: 110000 }],
          desc: 'tổng phân bổ thừa 10.000đ (110.000đ vs 100.000đ)',
        },
        {
          grandTotal: 500000,
          tenders: [
            { method: 'CASH' as const, amount: 200000 },
            { method: 'BANK_TRANSFER' as const, amount: 250000 },
          ],
          desc: 'thanh toán kết hợp phân bổ thiếu (450.000đ vs 500.000đ)',
        },
      ])(
        'Tổng tiền các dòng phân bổ khác tổng tiền đơn hàng ném lỗi 422 PAYMENT_AMOUNT_MISMATCH: $desc',
        ({ grandTotal, tenders }) => {
          expect(() => validateOrderTenders(grandTotal, tenders)).toThrow(
            expect.objectContaining({
              code: SalesDomainErrorCode.PAYMENT_AMOUNT_MISMATCH,
              httpStatus: 422,
            }),
          );
        },
      );

      it('danh sách tenders rỗng ([]) ném lỗi 422 PAYMENT_AMOUNT_MISMATCH', () => {
        expect(() => validateOrderTenders(100000, [])).toThrow(
          expect.objectContaining({
            code: SalesDomainErrorCode.PAYMENT_AMOUNT_MISMATCH,
            httpStatus: 422,
          }),
        );
      });

      it.each([
        {
          tenders: [
            { method: 'CASH' as const, amount: -50000 },
            { method: 'CASH' as const, amount: 150000 },
          ],
          desc: 'số tiền phân bổ âm (-50.000đ)',
        },
        {
          tenders: [
            { method: 'CASH' as const, amount: 50000.5 },
            { method: 'CASH' as const, amount: 49999.5 },
          ],
          desc: 'số tiền phân bổ có số thập phân lẻ (50000.5đ)',
        },
        {
          tenders: [
            { method: 'CASH' as const, amount: 100000, tenderedCash: -10000 },
          ],
          desc: 'tiền khách đưa âm (-10.000đ)',
        },
        {
          tenders: [
            {
              method: 'CASH' as const,
              amount: 100000,
              tenderedCash: 100000.75,
            },
          ],
          desc: 'tiền khách đưa có số thập phân lẻ (100000.75đ)',
        },
      ])(
        'Số tiền âm hoặc có phần lẻ bị từ chối với lỗi 422 (VALIDATION_ERROR): $desc',
        ({ tenders }) => {
          expect(() => validateOrderTenders(100000, tenders)).toThrow(
            expect.objectContaining({
              code: SalesDomainErrorCode.VALIDATION_ERROR,
              httpStatus: 422,
            }),
          );
        },
      );
    });
  });
});
