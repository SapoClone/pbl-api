import {
  computeValuationAfterDeduction,
  computeWeightedAverageCostOnReceipt,
  convertToBaseQtyMilli,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeAndSortWarehouseLines,
  normalizeInventoryCode,
  parseMoneyToVnd,
  parseQtyToMilli,
  vndToNumber,
} from './inventory-domain';

describe('InventoryDomain (M2 pure unit tests)', () => {
  describe('quantity and money parsing', () => {
    it('parses and formats NUMERIC(18,3) quantities accurately without floating-point drift', () => {
      expect(parseQtyToMilli('1.500')).toBe(1500n);
      expect(parseQtyToMilli('0.25')).toBe(250n);
      expect(formatMilliToQty(1500n)).toBe('1.500');
      expect(formatMilliToQty(250n)).toBe('0.250');
    });

    it('rejects zero, negative, or >3 decimal places when positive quantity is required', () => {
      expect(() => parseQtyToMilli('0.000')).toThrow(InventoryDomainError);
      expect(() => parseQtyToMilli('-1.000')).toThrow(InventoryDomainError);
      expect(() => parseQtyToMilli('1.1234')).toThrow(InventoryDomainError);
    });

    it('parses and formats integer VND money amounts', () => {
      expect(parseMoneyToVnd('120000')).toBe(120000n);
      expect(parseMoneyToVnd(120000)).toBe(120000n);
      expect(parseMoneyToVnd(null)).toBe(0n);
      expect(vndToNumber(11000000n)).toBe(11000000);
    });

    it('rejects fractional, negative and non-integer money', () => {
      for (const bad of [
        '120000.50',
        1.5,
        -1,
        'abc',
        '1e3',
        Number.MAX_SAFE_INTEGER + 2,
      ]) {
        expect(() => parseMoneyToVnd(bad)).toThrow(InventoryDomainError);
      }
    });

    it('fails loudly when a bigint exceeds the safe integer range', () => {
      expect(() => vndToNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
        InventoryDomainError,
      );
    });

    it('converts packaging unit quantities to base quantities using NUMERIC(18,4) factor', () => {
      // 2 boxes * 24.0000 = 48.000 base units
      const baseMilli = convertToBaseQtyMilli('2.000', '24.0000');
      expect(formatMilliToQty(baseMilli)).toBe('48.000');
    });
  });

  describe('weighted-average cost valuation', () => {
    it('calculates 10 units @ 100,000 + 10 units @ 120,000 = 20 units @ 110,000.00 VND', () => {
      const res = computeWeightedAverageCostOnReceipt({
        currentOnHandQty: '10.000',
        currentAvgUnitCost: 100000,
        receivedBaseQty: '10.000',
        receivedUnitCost: 120000,
      });

      expect(res.newOnHandQty).toBe('20.000');
      expect(res.newAvgUnitCost).toBe(110000);
      expect(res.newValuationAmount).toBe(2200000);
    });

    it('rounds the weighted-average cost half up to whole VND and keeps valuation equal to on-hand x avg', () => {
      // (1 * 100 + 2 * 101) / 3 = 100.666... -> 101
      const up = computeWeightedAverageCostOnReceipt({
        currentOnHandQty: '1.000',
        currentAvgUnitCost: 100,
        receivedBaseQty: '2.000',
        receivedUnitCost: 101,
      });
      expect(up.newAvgUnitCost).toBe(101);
      expect(up.newValuationAmount).toBe(303);

      // (1 * 100 + 1 * 101) / 2 = 100.5 -> 101 (half up)
      const half = computeWeightedAverageCostOnReceipt({
        currentOnHandQty: '1.000',
        currentAvgUnitCost: 100,
        receivedBaseQty: '1.000',
        receivedUnitCost: 101,
      });
      expect(half.newAvgUnitCost).toBe(101);

      // (2 * 100 + 1 * 101) / 3 = 100.333... -> 100
      const down = computeWeightedAverageCostOnReceipt({
        currentOnHandQty: '2.000',
        currentAvgUnitCost: 100,
        receivedBaseQty: '1.000',
        receivedUnitCost: 101,
      });
      expect(down.newAvgUnitCost).toBe(100);

      // fractional quantity valuation: 0.5 x 101 = 50.5 -> 51
      const frac = computeValuationAfterDeduction({
        currentOnHandQty: '1.000',
        currentAvgUnitCost: 101,
        deductedBaseQty: '0.500',
      });
      expect(frac.newValuationAmount).toBe(51);
    });

    it('preserves avg_unit_cost on outbound deduction and zeroes valuation when on-hand hits 0', () => {
      const partial = computeValuationAfterDeduction({
        currentOnHandQty: '20.000',
        currentAvgUnitCost: 110000,
        deductedBaseQty: '5.000',
      });
      expect(partial.newOnHandQty).toBe('15.000');
      expect(partial.newAvgUnitCost).toBe(110000);
      expect(partial.newValuationAmount).toBe(1650000);

      const empty = computeValuationAfterDeduction({
        currentOnHandQty: '15.000',
        currentAvgUnitCost: 110000,
        deductedBaseQty: '15.000',
      });
      expect(empty.newOnHandQty).toBe('0.000');
      expect(empty.newAvgUnitCost).toBe(110000);
      expect(empty.newValuationAmount).toBe(0);
    });
  });

  describe('deterministic line sorting and deduplication', () => {
    it('merges duplicate (warehouseId, skuId) pairs and sorts by warehouseId then skuId', () => {
      const normalized = normalizeAndSortWarehouseLines([
        { warehouseId: 'wh-b', skuId: 'sku-2', qty: '1.000' },
        { warehouseId: 'wh-a', skuId: 'sku-2', qty: '2.000' },
        { warehouseId: 'wh-a', skuId: 'sku-1', qty: '0.500' },
        { warehouseId: 'wh-a', skuId: 'sku-2', qty: '1.500' },
      ]);

      expect(normalized).toEqual([
        {
          warehouseId: 'wh-a',
          skuId: 'sku-1',
          qtyMilli: 500n,
          qty: '0.500',
        },
        {
          warehouseId: 'wh-a',
          skuId: 'sku-2',
          qtyMilli: 3500n,
          qty: '3.500',
        },
        {
          warehouseId: 'wh-b',
          skuId: 'sku-2',
          qtyMilli: 1000n,
          qty: '1.000',
        },
      ]);
    });

    it('normalizes inventory codes and rejects invalid characters', () => {
      expect(normalizeInventoryCode(' wh-main 01 ')).toBe('WH-MAIN-01');
      expect(() => normalizeInventoryCode('invalid@code!')).toThrow(
        expect.objectContaining({
          code: InventoryDomainErrorCode.INVALID_QUANTITY,
        }),
      );
    });
  });
});
