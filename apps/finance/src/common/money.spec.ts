import { moneyTransformer, toMoney } from './money';

describe('finance money helper', () => {
  it('round-trips bigint strings through the column transformer', () => {
    expect(moneyTransformer.from('1500000')).toBe(1500000);
    expect(moneyTransformer.from('9007199254740991')).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(moneyTransformer.to(250000)).toBe(250000);
    expect(moneyTransformer.from(null)).toBeNull();
  });

  it('fails loudly on a value that is not a safe integer', () => {
    expect(() => toMoney('9007199254740993')).toThrow();
    expect(() => toMoney('12.50')).toThrow();
    expect(() => toMoney(1.5)).toThrow();
  });
});
