import {
  screenLoyaltyType,
  toScreenLoyaltySettings,
} from '../modules/loyalty/loyalty.service';
import { formatPhoneMasked } from './customer-domain';

describe('screen helpers', () => {
  it('formatPhoneMasked reveals only 3 leading and 2 trailing digits', () => {
    expect(formatPhoneMasked('0901234528')).toBe('090 ••• •• 28');
    expect(formatPhoneMasked('+84 901 234 528')).toBe('849 ••• •• 28');
    expect(formatPhoneMasked('123')).toBe('•••');
    expect(formatPhoneMasked(null)).toBeNull();
  });

  it('maps ledger types to the screen vocabulary', () => {
    expect(screenLoyaltyType('EARN')).toBe('earn');
    expect(screenLoyaltyType('REDEEM')).toBe('redeem');
    expect(screenLoyaltyType('MANUAL_ADJUSTMENT')).toBe('adjust');
    expect(screenLoyaltyType('MERGE_IN')).toBe('adjust');
    expect(screenLoyaltyType('EXPIRE')).toBe('expire');
    expect(screenLoyaltyType('EARN_REVERSAL')).toBe('reverse');
    expect(screenLoyaltyType('REDEMPTION_REVERSAL')).toBe('reverse');
  });

  it('maps expiration days to months', () => {
    const base = {
      isEnabled: true,
      earnAmountPerPoint: 1,
      redeemValuePerPoint: 1,
      minRedeemPoints: 1,
      maxRedeemPointsPerOrder: null,
      holdTtlSeconds: 60,
      version: 1,
    } as any;
    expect(
      toScreenLoyaltySettings({ ...base, pointsExpirationDays: 360 })
        .pointsExpireMonths,
    ).toBe(12);
    expect(
      toScreenLoyaltySettings({ ...base, pointsExpirationDays: null })
        .pointsExpireMonths,
    ).toBeNull();
  });
});
