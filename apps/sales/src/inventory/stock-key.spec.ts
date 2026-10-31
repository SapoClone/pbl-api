import { inventoryStockKey } from './stock-key';

describe('inventoryStockKey', () => {
  it('is the variant id, so the reservation line carries the UUID inventory validates', () => {
    expect(
      inventoryStockKey('5b1f1c3e-0000-4000-8000-000000000001', 'AO-1'),
    ).toBe('5b1f1c3e-0000-4000-8000-000000000001');
  });

  it('falls back to the SKU code only for a line without a variant', () => {
    expect(inventoryStockKey(null, 'AO-1')).toBe('AO-1');
    expect(inventoryStockKey(undefined, 'AO-1')).toBe('AO-1');
  });
});
