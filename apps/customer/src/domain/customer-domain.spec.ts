import { moneyTransformer } from '../common/money';
import {
  CustomerDomainErrorCode,
  calculateEarnedPoints,
  calculateReturnPointReversal,
  computeAvailablePoints,
  computeCanonicalHash,
  maskEmailAddress,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
  parseVndBigInt,
  resolveEligibleMembershipTier,
  sanitizeCsvCell,
  toVndNumber,
  validatePointRedemption,
} from './customer-domain';

describe('M4 Customer & Loyalty Pure Domain Logic (customer-domain.ts)', () => {
  describe('Vietnamese & International Phone Number Normalization', () => {
    it('normalizes equivalent Vietnamese phone formats to canonical 0xxxxxxxxx', () => {
      expect(normalizePhoneNumber('0912345678')).toBe('0912345678');
      expect(normalizePhoneNumber('+84912345678')).toBe('0912345678');
      expect(normalizePhoneNumber('84 912 345 678')).toBe('0912345678');
      expect(normalizePhoneNumber('+84 0912-345-678')).toBe('0912345678');
      expect(normalizePhoneNumber('(0912) 345.678')).toBe('0912345678');
      expect(normalizePhoneNumber('028 3822 1234')).toBe('02838221234');
    });

    it('returns null for null, undefined, or whitespace-only phone numbers', () => {
      expect(normalizePhoneNumber(null)).toBeNull();
      expect(normalizePhoneNumber(undefined)).toBeNull();
      expect(normalizePhoneNumber('   ')).toBeNull();
    });

    it('supports valid international E.164 phone numbers', () => {
      expect(normalizePhoneNumber('+1 415 555 2671')).toBe('+14155552671');
      expect(normalizePhoneNumber('+65 9123 4567')).toBe('+6591234567');
    });

    it('rejects malformed phone numbers with 422 INVALID_PHONE_NUMBER', () => {
      for (const bad of ['abc12345', '091234', '0112345678', '+84123']) {
        expect(() => normalizePhoneNumber(bad)).toThrow(
          expect.objectContaining({
            code: CustomerDomainErrorCode.INVALID_PHONE_NUMBER,
            httpStatus: 422,
          }),
        );
      }
    });
  });

  describe('Email Normalization, PII Masking & CSV Formula-Injection Protection', () => {
    it('normalizes and validates email addresses', () => {
      expect(normalizeEmail('  NguyenVanA@Example.COM ')).toBe(
        'nguyenvana@example.com',
      );
      expect(normalizeEmail('')).toBeNull();
      expect(() => normalizeEmail('not-an-email')).toThrow(
        expect.objectContaining({
          code: CustomerDomainErrorCode.VALIDATION_ERROR,
          httpStatus: 422,
        }),
      );
    });

    it('masks phone and email PII fields for non-privileged callers', () => {
      expect(maskPhoneNumber('0912345678')).toBe('091***5678');
      expect(maskEmailAddress('nguyenvana@example.com')).toBe(
        'ng***a@example.com',
      );
      expect(maskPhoneNumber(null)).toBeNull();
    });

    it('escapes spreadsheet formula injection prefixes (=, +, -, @) in CSV exports', () => {
      expect(sanitizeCsvCell("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
      expect(sanitizeCsvCell('+SUM(A1:A10)')).toBe("'+SUM(A1:A10)");
      expect(sanitizeCsvCell('-100+200')).toBe("'-100+200");
      expect(sanitizeCsvCell('@IMPORTXML()')).toBe("'@IMPORTXML()");
      expect(sanitizeCsvCell('Nguyễn Văn A, VIP')).toBe('"Nguyễn Văn A, VIP"');
    });
  });

  describe('Loyalty Point Earning & Redemption Accounting', () => {
    const defaultSettings = {
      isEnabled: true,
      earnAmountPerPoint: 10000,
      redeemValuePerPoint: 1000,
      minRedeemPoints: 10,
      maxRedeemPointsPerOrder: 500,
      holdTtlSeconds: 900,
    };

    it('awards integer floor points based on eligible spend and earnAmountPerPoint', () => {
      const res1 = calculateEarnedPoints(500000, defaultSettings);
      expect(res1.earnedPoints).toBe(50);
      expect(res1.eligibleSpendVnd).toBe(500000);
      expect(res1.appliedRateVnd).toBe(10000);

      const res2 = calculateEarnedPoints(509999, defaultSettings);
      expect(res2.earnedPoints).toBe(50);

      const disabled = calculateEarnedPoints(500000, {
        ...defaultSettings,
        isEnabled: false,
      });
      expect(disabled.earnedPoints).toBe(0);
    });

    it('rejects fractional, string, negative and unsafe VND amounts', () => {
      for (const bad of [10000.5, '10000', '10000.00', -1, 2 ** 60]) {
        expect(() => parseVndBigInt(bad as number)).toThrow(
          expect.objectContaining({
            code: CustomerDomainErrorCode.VALIDATION_ERROR,
            httpStatus: 422,
          }),
        );
      }
      expect(parseVndBigInt(10000)).toBe(10000n);
    });

    it('converts bigint VND to number and fails beyond the safe range', () => {
      expect(toVndNumber(5500000n)).toBe(5500000);
      expect(() => toVndNumber(2n ** 60n)).toThrow();
    });

    it('computes redeem value as points x whole VND per point and refund-based reversal proportionally', () => {
      const r = validatePointRedemption({
        requestedPoints: 33,
        postedPointsBalance: 100,
        heldPoints: 0,
        settings: { ...defaultSettings, redeemValuePerPoint: 1250 },
      });
      expect(r.discountValueVnd).toBe(41250);
      expect(Number.isInteger(r.discountValueVnd)).toBe(true);
    });

    it('round-trips bigint strings through the column transformer', () => {
      expect(moneyTransformer.from('2000000')).toBe(2000000);
      expect(moneyTransformer.from(null)).toBeNull();
      expect(() => moneyTransformer.from('1.5')).toThrow();
    });

    it('computes available points as GREATEST(0, posted - held) and validates redemptions', () => {
      expect(computeAvailablePoints(100, 80)).toBe(20);
      expect(computeAvailablePoints(-50, 0)).toBe(0);

      const valid = validatePointRedemption({
        requestedPoints: 80,
        postedPointsBalance: 100,
        heldPoints: 0,
        settings: defaultSettings,
      });
      expect(valid).toEqual({
        requestedPoints: 80,
        availableBefore: 100,
        availableAfter: 20,
        discountValueVnd: 80000,
      });

      // Insufficient available points due to existing hold
      expect(() =>
        validatePointRedemption({
          requestedPoints: 80,
          postedPointsBalance: 100,
          heldPoints: 30,
          settings: defaultSettings,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CustomerDomainErrorCode.INSUFFICIENT_LOYALTY_POINTS,
          httpStatus: 409,
        }),
      );

      // Below minRedeemPoints
      expect(() =>
        validatePointRedemption({
          requestedPoints: 5,
          postedPointsBalance: 100,
          heldPoints: 0,
          settings: defaultSettings,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CustomerDomainErrorCode.LOYALTY_MINIMUM_NOT_MET,
          httpStatus: 422,
        }),
      );

      // Above maxRedeemPointsPerOrder
      expect(() =>
        validatePointRedemption({
          requestedPoints: 600,
          postedPointsBalance: 1000,
          heldPoints: 0,
          settings: defaultSettings,
        }),
      ).toThrow(
        expect.objectContaining({
          code: CustomerDomainErrorCode.LOYALTY_MAXIMUM_EXCEEDED,
          httpStatus: 422,
        }),
      );
    });
  });

  describe('Pro-Rated Return Point Reversal & Membership Tier Qualification', () => {
    it('reverses proportional points across partial returns without exceeding original earned points', () => {
      // Order of 500,000 VND earned 50 points.
      // Partial return 1: 200,000 VND -> 20 points reversed
      const r1 = calculateReturnPointReversal({
        originalEarnedPoints: 50,
        alreadyReversedPoints: 0,
        originalEligibleSpendVnd: 500000,
        returnRefundAmountVnd: 200000,
        cumulativeRefundedAmountVnd: 200000,
      });
      expect(r1.pointsToReverse).toBe(20);
      expect(r1.remainingReversibleAfter).toBe(30);

      // Partial return 2 (final): 300,000 VND -> 30 points reversed
      const r2 = calculateReturnPointReversal({
        originalEarnedPoints: 50,
        alreadyReversedPoints: 20,
        originalEligibleSpendVnd: 500000,
        returnRefundAmountVnd: 300000,
        cumulativeRefundedAmountVnd: 500000,
      });
      expect(r2.pointsToReverse).toBe(30);
      expect(r2.remainingReversibleAfter).toBe(0);
    });

    it('resolves highest qualifying active membership tier', () => {
      const tiers = [
        {
          id: 't-member',
          code: 'MEMBER',
          name: 'Member',
          minPoints: 0,
          discountRate: '0.00',
          status: 'ACTIVE',
        },
        {
          id: 't-silver',
          code: 'SILVER',
          name: 'Silver',
          minPoints: 100,
          discountRate: '3.00',
          status: 'ACTIVE',
        },
        {
          id: 't-gold',
          code: 'GOLD',
          name: 'Gold',
          minPoints: 500,
          discountRate: '5.00',
          status: 'ACTIVE',
        },
      ];

      expect(resolveEligibleMembershipTier(50, tiers)?.code).toBe('MEMBER');
      expect(resolveEligibleMembershipTier(100, tiers)?.code).toBe('SILVER');
      expect(resolveEligibleMembershipTier(750, tiers)?.code).toBe('GOLD');
    });

    it('computes identical canonical SHA-256 hash regardless of key order', () => {
      const h1 = computeCanonicalHash({ a: 1, b: { x: 10, y: 20 } });
      const h2 = computeCanonicalHash({ b: { y: 20, x: 10 }, a: 1 });
      expect(h1).toBe(h2);
    });
  });
});
