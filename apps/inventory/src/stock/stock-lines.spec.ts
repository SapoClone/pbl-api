import { readReservationTtlMinutes } from '../config/inventory.config';
import { compareSku, mergeLines, sameLines } from './stock-lines';

describe('stock lines', () => {
  it('merges a SKU asked twice and orders by bytes (upper case before lower)', () => {
    expect(
      mergeLines([
        { sku: 'ao-01', quantity: 1 },
        { sku: 'AO-01', quantity: 2 },
        { sku: 'ao-01', quantity: 3 },
      ]),
    ).toEqual([
      { sku: 'AO-01', quantity: 2 },
      { sku: 'ao-01', quantity: 4 },
    ]);
    expect(compareSku('AO-01', 'ao-01')).toBeLessThan(0);
  });

  it('compares sets of lines regardless of order or splitting', () => {
    expect(
      sameLines(
        [
          { sku: 'A', quantity: 1 },
          { sku: 'B', quantity: 2 },
        ],
        [
          { sku: 'B', quantity: 1 },
          { sku: 'A', quantity: 1 },
          { sku: 'B', quantity: 1 },
        ],
      ),
    ).toBe(true);
    expect(
      sameLines([{ sku: 'A', quantity: 1 }], [{ sku: 'A', quantity: 2 }]),
    ).toBe(false);
  });
});

describe('readReservationTtlMinutes', () => {
  it.each([
    [undefined, 15],
    ['', 15],
    ['abc', 15],
    ['0', 15],
    ['2.5', 15],
    ['-3', 15],
    ['30', 30],
  ])('%p gives %p', (value, expected) => {
    expect(
      readReservationTtlMinutes({ INVENTORY_RESERVATION_TTL_MINUTES: value }),
    ).toBe(expected);
  });
});
