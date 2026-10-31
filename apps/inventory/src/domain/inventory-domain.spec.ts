import {
  computeValuationAfterDeduction,
  computeWeightedAverageCostOnReceipt,
  convertToBaseQtyMilli,
  formatCentsToMoney,
  formatMilliToQty,
  InventoryDomainError,
  InventoryDomainErrorCode,
  normalizeAndSortWarehouseLines,
  normalizeInventoryCode,
  parseMoneyToCents,
  parseQtyToMilli,
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

    it('parses and formats NUMERIC(18,2) money amounts accurately', () => {
      expect(parseMoneyToCents('120000')).toBe(12000000n);
      expect(parseMoneyToCents('120000.50')).toBe(12000050n);
      expect(formatCentsToMoney(11000000n)).toBe('110000.00');
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
        currentAvgUnitCost: '100000.00',
        receivedBaseQty: '10.000',
        receivedUnitCost: '120000.00',
      });

      expect(res.newOnHandQty).toBe('20.000');
      expect(res.newAvgUnitCost).toBe('110000.00');
      expect(res.newValuationAmount).toBe('2200000.00');
    });

    it('preserves avg_unit_cost on outbound deduction and zeroes valuation when on-hand hits 0', () => {
      const partial = computeValuationAfterDeduction({
        currentOnHandQty: '20.000',
        currentAvgUnitCost: '110000.00',
        deductedBaseQty: '5.000',
      });
      expect(partial.newOnHandQty).toBe('15.000');
      expect(partial.newAvgUnitCost).toBe('110000.00');
      expect(partial.newValuationAmount).toBe('1650000.00');

      const empty = computeValuationAfterDeduction({
        currentOnHandQty: '15.000',
        currentAvgUnitCost: '110000.00',
        deductedBaseQty: '15.000',
      });
      expect(empty.newOnHandQty).toBe('0.000');
      expect(empty.newAvgUnitCost).toBe('110000.00');
      expect(empty.newValuationAmount).toBe('0.00');
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
