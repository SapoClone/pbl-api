import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import 'reflect-metadata';
import { CreatePurchaseOrderItemDto } from '../modules/procurement/procurement.dto';
import { CreateStockReceiptItemDto } from '../modules/receiving/receiving.dto';
import { moneyTransformer, toVnd, toVndOrNull } from './money';

describe('money helper (bigint round trip)', () => {
  it('converts the string a bigint column returns into a number', () => {
    expect(toVnd('9007199254740991')).toBe(9007199254740991);
    expect(moneyTransformer.from('150000')).toBe(150000);
    expect(moneyTransformer.to(150000)).toBe(150000);
    expect(toVndOrNull(null)).toBeNull();
  });

  it('fails loudly on non-integer or unsafe values', () => {
    expect(() => toVnd('1.50')).toThrow();
    expect(() => toVnd('9007199254740993')).toThrow();
    expect(() => toVnd('abc')).toThrow();
    expect(() => moneyTransformer.from('1.5')).toThrow();
  });
});

describe('money request DTOs', () => {
  const po = (unitCost: unknown) =>
    plainToInstance(CreatePurchaseOrderItemDto, {
      skuId: '11111111-1111-4111-8111-111111111111',
      orderedQty: '1.000',
      unitCost,
    });
  const rc = (unitCost: unknown) =>
    plainToInstance(CreateStockReceiptItemDto, {
      skuId: '11111111-1111-4111-8111-111111111111',
      qty: '1.000',
      unitCost,
    });

  it('accepts integer VND', async () => {
    expect(await validate(po(100000))).toHaveLength(0);
    expect(await validate(rc(0))).toHaveLength(0);
  });

  it.each([100.5, '100000', '100000.00', -1])(
    'rejects %p as a money input',
    async (bad) => {
      expect((await validate(po(bad))).length).toBeGreaterThan(0);
      expect((await validate(rc(bad))).length).toBeGreaterThan(0);
    },
  );
});
