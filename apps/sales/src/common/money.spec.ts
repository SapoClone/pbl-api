import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import 'reflect-metadata';
import {
  PosCheckoutDto,
  PosTenderItemDto,
} from '../modules/checkout/checkout.dto';
import { PosQuoteDto } from '../modules/pos/pos.dto';
import { CreatePromotionDto } from '../modules/promotions/promotions.dto';
import { CreateRefundRequestDto } from '../modules/returns/returns.dto';
import {
  CloseShiftReqDto,
  OpenShiftReqDto,
} from '../modules/shifts/shifts.dto';
import {
  discountValueTransformer,
  moneyTransformer,
  toMoney,
  toMoneyOrNull,
} from './money';

const BRANCH = '22222222-2222-4222-8222-222222222222';
const invalid = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('money helper (bigint round trip)', () => {
  it('reads bigint strings back as numbers', () => {
    expect(moneyTransformer.from('150000')).toBe(150000);
    expect(moneyTransformer.from('-50000')).toBe(-50000);
    expect(moneyTransformer.from('0')).toBe(0);
    expect(moneyTransformer.from(null)).toBeNull();
    expect(moneyTransformer.to(150000)).toBe(150000);
    expect(toMoney('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(toMoneyOrNull(undefined)).toBeNull();
  });

  it('fails loudly on a value that is not a safe integer', () => {
    expect(() => toMoney('9007199254740993')).toThrow(/safe integer/);
    expect(() => toMoney('150000.00')).toThrow(/safe integer/);
    expect(() => toMoney(1.5)).toThrow(/safe integer/);
    expect(() => toMoney(undefined)).toThrow(/safe integer/);
    expect(() => moneyTransformer.from('1e3')).toThrow(/safe integer/);
  });

  it('discount value (money or percent) keeps its fraction as a number', () => {
    expect(discountValueTransformer.from('7.50')).toBe(7.5);
    expect(discountValueTransformer.from('10.00')).toBe(10);
  });
});

describe('request DTOs: money is an integer number (422 otherwise)', () => {
  it('shift opening and closing cash', async () => {
    expect(
      await invalid(OpenShiftReqDto, {
        branchId: BRANCH,
        openingCash: 1000000,
      }),
    ).toEqual([]);
    expect(
      await invalid(OpenShiftReqDto, {
        branchId: BRANCH,
        openingCash: 1000000.5,
      }),
    ).toContain('openingCash');
    expect(
      await invalid(OpenShiftReqDto, {
        branchId: BRANCH,
        openingCash: '1000000.00',
      }),
    ).toContain('openingCash');
    expect(
      await invalid(OpenShiftReqDto, { branchId: BRANCH, openingCash: -1 }),
    ).toContain('openingCash');
    expect(
      await invalid(CloseShiftReqDto, { actualCash: '3750000' }),
    ).toContain('actualCash');
    expect(
      await invalid(CloseShiftReqDto, { actualCash: 3750000.25 }),
    ).toContain('actualCash');
  });

  it('tenders, shipping fee, expected price and tendered cash', async () => {
    expect(
      await invalid(PosTenderItemDto, {
        method: 'CASH',
        amount: 100000,
        tenderedCash: 120000,
      }),
    ).toEqual([]);
    expect(
      await invalid(PosTenderItemDto, { method: 'CASH', amount: 100000.5 }),
    ).toContain('amount');
    expect(
      await invalid(PosTenderItemDto, { method: 'CASH', amount: '100000' }),
    ).toContain('amount');
    expect(
      await invalid(PosTenderItemDto, {
        method: 'CASH',
        amount: 1,
        tenderedCash: 1.5,
      }),
    ).toContain('tenderedCash');
    expect(
      await invalid(PosQuoteDto, {
        branchId: BRANCH,
        lines: [{ variantId: BRANCH, qty: 1 }],
        shippingFee: 10.5,
      }),
    ).toContain('shippingFee');
    expect(
      await invalid(PosCheckoutDto, {
        branchId: BRANCH,
        warehouseId: BRANCH,
        lines: [{ variantId: BRANCH, qty: 1 }],
        tenderedCash: 100.1,
      }),
    ).toContain('tenderedCash');
  });

  it('promotions and refund amounts', async () => {
    const promo = {
      code: 'A',
      name: 'A',
      discountType: 'FIXED',
      discountValue: 5000,
    };
    expect(await invalid(CreatePromotionDto, promo)).toEqual([]);
    expect(
      await invalid(CreatePromotionDto, { ...promo, minOrderAmount: 100000.5 }),
    ).toContain('minOrderAmount');
    expect(
      await invalid(CreatePromotionDto, {
        ...promo,
        maxDiscountAmount: '50000',
      }),
    ).toContain('maxDiscountAmount');
    expect(await invalid(CreateRefundRequestDto, { amount: 1000 })).toEqual([]);
    expect(await invalid(CreateRefundRequestDto, { amount: 1000.5 })).toContain(
      'amount',
    );
    expect(await invalid(CreateRefundRequestDto, { amount: 0 })).toContain(
      'amount',
    );
  });
});
