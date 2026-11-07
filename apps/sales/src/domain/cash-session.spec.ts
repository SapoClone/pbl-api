import { validateCashSettings } from '../modules/shifts/cash-settings.service';
import {
  DEFAULT_CASH_DENOMINATIONS,
  cashSaleDrawerAmount,
  countedTotalFromDenominations,
  decideShiftClose,
  expectedCashFromEntries,
} from './sales-domain';

/** expected = opening + cash sales - cash refunds + pay-ins - pay-outs; variance = counted - expected */
describe('the cash formula', () => {
  const settings = { toleranceVnd: 10000, approvalAboveVnd: 10000 };
  type E = { kind: string; amount: number };

  const cases: {
    name: string;
    opening: number;
    entries: E[];
    counted: number;
    expected: number;
    variance: number;
    decision: ReturnType<typeof decideShiftClose>;
  }[] = [
    {
      name: 'exact match',
      opening: 1000000,
      entries: [
        { kind: 'CASH_SALE', amount: 200000 },
        { kind: 'CASH_SALE', amount: 300000 },
      ],
      counted: 1500000,
      expected: 1500000,
      variance: 0,
      decision: 'WITHIN_TOLERANCE',
    },
    {
      name: 'a shortage within the tolerance closes at once',
      opening: 1000000,
      entries: [{ kind: 'CASH_SALE', amount: 500000 }],
      counted: 1495000,
      expected: 1500000,
      variance: -5000,
      decision: 'WITHIN_TOLERANCE',
    },
    {
      name: 'a shortage above the threshold needs approval',
      opening: 1000000,
      entries: [
        { kind: 'CASH_SALE', amount: 300000 },
        { kind: 'CASH_SALE', amount: 200000 },
        { kind: 'CASH_SALE', amount: 100000 },
        { kind: 'CASH_REFUND', amount: -30000 },
        { kind: 'PAY_OUT', amount: -20000 },
      ],
      counted: 1500000,
      expected: 1550000,
      variance: -50000,
      decision: 'APPROVAL_REQUIRED',
    },
    {
      name: 'an overage',
      opening: 500000,
      entries: [{ kind: 'CASH_SALE', amount: 100000 }],
      counted: 650000,
      expected: 600000,
      variance: 50000,
      decision: 'APPROVAL_REQUIRED',
    },
    {
      name: 'a refund of an earlier shift order is simply a refund entry of this drawer',
      opening: 0,
      entries: [
        { kind: 'PAY_IN', amount: 300000 },
        { kind: 'CASH_REFUND', amount: -150000 },
      ],
      counted: 150000,
      expected: 150000,
      variance: 0,
      decision: 'WITHIN_TOLERANCE',
    },
    {
      name: 'a pay-in and a pay-out',
      opening: 1000000,
      entries: [
        { kind: 'PAY_IN', amount: 500000 },
        { kind: 'PAY_OUT', amount: -120000 },
      ],
      counted: 1380000,
      expected: 1380000,
      variance: 0,
      decision: 'WITHIN_TOLERANCE',
    },
    {
      name: 'a card-only sale writes no entry, so expected stays the float',
      opening: 1000000,
      entries: [],
      counted: 1000000,
      expected: 1000000,
      variance: 0,
      decision: 'WITHIN_TOLERANCE',
    },
    {
      name: 'the closing shortage entry does not move expected cash',
      opening: 1000000,
      entries: [
        { kind: 'CASH_SALE', amount: 100000 },
        { kind: 'CASH_SHORTAGE', amount: -50000 },
      ],
      counted: 1050000,
      expected: 1100000,
      variance: -50000,
      decision: 'APPROVAL_REQUIRED',
    },
  ];

  it.each(cases)(
    '$name',
    ({ opening, entries, counted, expected, variance, decision }) => {
      const exp = expectedCashFromEntries(opening, entries);
      expect(exp).toBe(expected);
      expect(counted - exp).toBe(variance);
      expect(decideShiftClose({ variance, ...settings })).toBe(decision);
    },
  );

  it('a split payment puts only the cash part in the drawer', () => {
    expect(
      cashSaleDrawerAmount([
        { method: 'CASH', amount: 120000 },
        { method: 'BANK_TRANSFER', amount: 80000 },
      ]),
    ).toBe(120000);
  });

  it('a card, QR, transfer or on-account sale puts nothing in the drawer', () => {
    expect(
      cashSaleDrawerAmount([
        { method: 'CARD', amount: 100000 },
        { method: 'E_WALLET', amount: 50000 },
        { method: 'ON_ACCOUNT', amount: 10000 },
      ]),
    ).toBe(0);
  });

  it('a middle band needs a reason only when the threshold is above the tolerance', () => {
    const wide = { toleranceVnd: 10000, approvalAboveVnd: 50000 };
    expect(decideShiftClose({ variance: -30000, ...wide })).toBe(
      'REASON_REQUIRED',
    );
    expect(decideShiftClose({ variance: 50000, ...wide })).toBe(
      'REASON_REQUIRED',
    );
    expect(decideShiftClose({ variance: -50001, ...wide })).toBe(
      'APPROVAL_REQUIRED',
    );
    expect(decideShiftClose({ variance: 10000, ...wide })).toBe(
      'WITHIN_TOLERANCE',
    );
  });
});

describe('count by denomination', () => {
  it('totals the notes', () => {
    expect(
      countedTotalFromDenominations(
        { '500000': 1, '200000': 2, '100000': 3 },
        DEFAULT_CASH_DENOMINATIONS,
      ),
    ).toBe(1200000);
  });

  it('refuses a note the store does not use and fractional counts', () => {
    expect(() =>
      countedTotalFromDenominations(
        { '300000': 1 },
        DEFAULT_CASH_DENOMINATIONS,
      ),
    ).toThrow(/not one of the store's notes/);
    expect(() =>
      countedTotalFromDenominations(
        { '500000': 1.5 },
        DEFAULT_CASH_DENOMINATIONS,
      ),
    ).toThrow(/whole number/);
    expect(() =>
      countedTotalFromDenominations(
        { '500000': -1 },
        DEFAULT_CASH_DENOMINATIONS,
      ),
    ).toThrow();
  });
});

describe('cash settings validation', () => {
  const ok = {
    toleranceVnd: 10000,
    approvalAboveVnd: 10000,
    responsibility: 'none' as const,
    maxOpenHours: 16,
    maxOpeningFloatVnd: 5000000,
    denominations: [500000, 200000],
  };

  it('accepts the defaults', () => {
    expect(() => validateCashSettings(ok)).not.toThrow();
  });

  it.each([
    ['a tolerance above the approval threshold', { toleranceVnd: 20000 }],
    ['a fractional amount', { approvalAboveVnd: 10000.5 }],
    ['a negative float limit', { maxOpeningFloatVnd: -1 }],
    ['no hours', { maxOpenHours: 0 }],
    ['an unknown responsibility', { responsibility: 'nobody' as never }],
    ['an empty list of notes', { denominations: [] }],
    ['a duplicate note', { denominations: [1000, 1000] }],
    ['a zero note', { denominations: [0, 1000] }],
  ])('refuses %s', (_name, patch) => {
    expect(() => validateCashSettings({ ...ok, ...patch })).toThrow();
  });
});
