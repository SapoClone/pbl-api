import { readReservationTtlMinutes } from '../config/inventory.config';
import {
  formatMilliToDecimal,
  hashReservationRequest,
  normalizeReservationLines,
  parseDecimalToMilli,
} from './reservations.service';
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

describe('warehouse reservation decimal lines & request hashing', () => {
  const WH_1 = '77777777-7777-4777-8777-777777777777';
  const SKU_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
  const SKU_2 = 'bbbbbbbb-0000-4000-8000-000000000002';

  it('parses and formats NUMERIC(18,3) quantities accurately', () => {
    expect(parseDecimalToMilli('2')).toBe(2000n);
    expect(parseDecimalToMilli('1.25')).toBe(1250n);
    expect(parseDecimalToMilli('0.005')).toBe(5n);
    expect(formatMilliToDecimal(3255n)).toBe('3.255');
  });

  it('merges duplicate (warehouseId, skuId) lines and sorts deterministically', () => {
    const normalized = normalizeReservationLines([
      { warehouseId: WH_1, skuId: SKU_2, qty: '1.5' },
      { warehouseId: WH_1, skuId: SKU_1, qty: '2.25' },
      { warehouseId: WH_1, skuId: SKU_2, qty: '0.500' },
    ]);

    expect(normalized).toEqual([
      {
        warehouseId: WH_1,
        skuId: SKU_1,
        qty: '2.250',
        qtyMilli: 2250n,
      },
      {
        warehouseId: WH_1,
        skuId: SKU_2,
        qty: '2.000',
        qtyMilli: 2000n,
      },
    ]);
  });

  it('produces identical request_sha256 for equivalent split/reordered reservation lines', () => {
    const normalizedA = normalizeReservationLines([
      { warehouseId: WH_1, skuId: SKU_2, qty: '1' },
      { warehouseId: WH_1, skuId: SKU_1, qty: '2' },
      { warehouseId: WH_1, skuId: SKU_2, qty: '1' },
    ]);
    const normalizedB = normalizeReservationLines([
      { warehouseId: WH_1, skuId: SKU_1, qty: '2.000' },
      { warehouseId: WH_1, skuId: SKU_2, qty: '2.000' },
    ]);

    const hashA = hashReservationRequest(
      {
        callerService: 'sales',
        sourceRefType: 'ORDER',
        sourceRefId: 'c1',
        ttlSeconds: 900,
        lines: [],
      },
      normalizedA,
    );
    const hashB = hashReservationRequest(
      {
        callerService: 'sales',
        sourceRefType: 'ORDER',
        sourceRefId: 'c1',
        ttlSeconds: 900,
        lines: [],
      },
      normalizedB,
    );
    expect(hashA).toBe(hashB);
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
