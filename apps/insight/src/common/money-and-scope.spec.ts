import { NotFoundException } from '@nestjs/common';
import { assertBranchInScope, resolveScope } from './branch-scope';
import { moneyTransformer, toMoney, toMoneyOrNull } from './money';

describe('money (integer VND)', () => {
  it('reads bigint strings and numbers, refuses fractions and unsafe values', () => {
    expect(toMoney('150000')).toBe(150000);
    expect(toMoney('-5')).toBe(-5);
    expect(toMoney(42)).toBe(42);
    expect(toMoney(10n)).toBe(10);
    expect(() => toMoney('150000.50')).toThrow();
    expect(() => toMoney(1.5)).toThrow();
    expect(() => toMoney('9007199254740993')).toThrow();
    expect(toMoneyOrNull(null)).toBeNull();
  });

  it('transforms a column both ways, null passes through', () => {
    expect(moneyTransformer.from?.('123')).toBe(123);
    expect(moneyTransformer.from?.(null)).toBeNull();
    expect(moneyTransformer.to?.(7)).toBe(7);
  });
});

describe('branch scope helpers', () => {
  const B1 = 'b1';
  const B2 = 'b2';

  it('answers 404 (never 403) for a branch outside the scope', () => {
    expect(() => assertBranchInScope([B1], B2)).toThrow(NotFoundException);
    expect(() => assertBranchInScope([B1], B1)).not.toThrow();
    expect(() => assertBranchInScope(null, B2)).not.toThrow();
    expect(() => assertBranchInScope([], B1)).toThrow(NotFoundException);
  });

  it('resolves the filter: named branch, named list, or the scope itself', () => {
    expect(resolveScope([B1], B1)).toEqual({
      branchId: B1,
      allowedBranchIds: [B1],
    });
    expect(resolveScope(null, B2)).toEqual({
      branchId: B2,
      allowedBranchIds: undefined,
    });
    expect(resolveScope([B1, B2], null, [B2])).toEqual({
      allowedBranchIds: [B2],
    });
    expect(() => resolveScope([B1], null, [B1, B2])).toThrow(NotFoundException);
    expect(resolveScope([B1])).toEqual({ allowedBranchIds: [B1] });
    expect(resolveScope(null)).toEqual({ allowedBranchIds: undefined });
    // an empty scope stays empty: the reads match no branch
    expect(resolveScope([])).toEqual({ allowedBranchIds: [] });
  });
});
