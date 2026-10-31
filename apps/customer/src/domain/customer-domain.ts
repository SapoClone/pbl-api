import { createHash } from 'node:crypto';

export enum CustomerDomainErrorCode {
  CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND',
  CUSTOMER_ALREADY_EXISTS = 'CUSTOMER_ALREADY_EXISTS',
  INVALID_PHONE_NUMBER = 'INVALID_PHONE_NUMBER',
  CUSTOMER_INACTIVE = 'CUSTOMER_INACTIVE',
  CUSTOMER_MERGE_CONFLICT = 'CUSTOMER_MERGE_CONFLICT',

  CUSTOMER_GROUP_NOT_FOUND = 'CUSTOMER_GROUP_NOT_FOUND',
  CUSTOMER_GROUP_ALREADY_EXISTS = 'CUSTOMER_GROUP_ALREADY_EXISTS',
  CUSTOMER_GROUP_NOT_EMPTY = 'CUSTOMER_GROUP_NOT_EMPTY',

  CUSTOMER_ADDRESS_NOT_FOUND = 'CUSTOMER_ADDRESS_NOT_FOUND',

  MEMBERSHIP_TIER_NOT_FOUND = 'MEMBERSHIP_TIER_NOT_FOUND',
  MEMBERSHIP_TIER_ALREADY_EXISTS = 'MEMBERSHIP_TIER_ALREADY_EXISTS',

  LOYALTY_NOT_ENABLED = 'LOYALTY_NOT_ENABLED',
  LOYALTY_ACCOUNT_NOT_FOUND = 'LOYALTY_ACCOUNT_NOT_FOUND',
  INSUFFICIENT_LOYALTY_POINTS = 'INSUFFICIENT_LOYALTY_POINTS',
  LOYALTY_HOLD_NOT_FOUND = 'LOYALTY_HOLD_NOT_FOUND',
  LOYALTY_HOLD_EXPIRED = 'LOYALTY_HOLD_EXPIRED',
  LOYALTY_HOLD_ALREADY_COMMITTED = 'LOYALTY_HOLD_ALREADY_COMMITTED',
  LOYALTY_STATE_CONFLICT = 'LOYALTY_STATE_CONFLICT',
  LOYALTY_REVERSAL_CONFLICT = 'LOYALTY_REVERSAL_CONFLICT',
  LOYALTY_MINIMUM_NOT_MET = 'LOYALTY_MINIMUM_NOT_MET',
  LOYALTY_MAXIMUM_EXCEEDED = 'LOYALTY_MAXIMUM_EXCEEDED',

  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  RESOURCE_VERSION_CONFLICT = 'RESOURCE_VERSION_CONFLICT',
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  IMPORT_LIMIT_EXCEEDED = 'IMPORT_LIMIT_EXCEEDED',
}

export class CustomerDomainError extends Error {
  constructor(
    public readonly code: CustomerDomainErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CustomerDomainError';
  }
}

export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';
export type LoyaltyHoldState = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type LoyaltyTransactionType =
  | 'EARN'
  | 'REDEEM'
  | 'EARN_REVERSAL'
  | 'REDEMPTION_REVERSAL'
  | 'MANUAL_ADJUSTMENT'
  | 'EXPIRE'
  | 'MERGE_IN'
  | 'MERGE_OUT';

/**
 * Normalizes Vietnamese and international phone numbers deterministically.
 * Examples:
 *  - "0912 345 678" -> "0912345678"
 *  - "+84912345678" -> "0912345678"
 *  - "+84 0912-345-678" -> "0912345678"
 *  - "84912345678" -> "0912345678"
 */
export function normalizePhoneNumber(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // Reject characters outside digits, +, spaces, hyphens, dots, parentheses
  if (!/^[+\d\s().-]+$/.test(trimmed)) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.INVALID_PHONE_NUMBER,
      'Phone number contains invalid characters',
      422,
    );
  }

  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.INVALID_PHONE_NUMBER,
      'Phone number must contain digits',
      422,
    );
  }

  // Handle Vietnam country code (+84 or 84)
  let candidate = digitsOnly;
  if (hasPlus && digitsOnly.startsWith('84')) {
    const rest = digitsOnly.slice(2);
    candidate = rest.startsWith('0') ? rest : `0${rest}`;
  } else if (
    !hasPlus &&
    digitsOnly.startsWith('84') &&
    (digitsOnly.length === 11 || digitsOnly.length === 12)
  ) {
    const rest = digitsOnly.slice(2);
    candidate = rest.startsWith('0') ? rest : `0${rest}`;
  } else if (hasPlus && !digitsOnly.startsWith('84')) {
    // Non-VN international E.164
    if (digitsOnly.length < 8 || digitsOnly.length > 15) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.INVALID_PHONE_NUMBER,
        'International phone number must have between 8 and 15 digits',
        422,
      );
    }
    return `+${digitsOnly}`;
  }

  // Validate canonical Vietnamese mobile (03, 05, 07, 08, 09 -> 10 digits) or landline (02 -> 10 or 11 digits)
  const isVnMobile = /^0[35789]\d{8}$/.test(candidate);
  const isVnLandline = /^02\d{8,9}$/.test(candidate);

  if (!isVnMobile && !isVnLandline) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.INVALID_PHONE_NUMBER,
      'Invalid Vietnamese phone number format',
      422,
    );
  }

  return candidate;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      'Invalid email address format',
      422,
    );
  }
  return trimmed;
}

export function maskPhoneNumber(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

export function maskEmailAddress(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

/**
 * Protects CSV exports against spreadsheet formula injection (CSV Injection).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const trimmedLeading = str.replace(/^[\s]+/, '');
  const safe =
    /^[=+\-@|\t\r]/.test(str) || /^[=+\-@]/.test(trimmedLeading)
      ? `'${str}`
      : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function parseVndBigInt(
  raw: string | number | bigint | null | undefined,
  allowZero = true,
): bigint {
  if (raw === null || raw === undefined) {
    if (allowZero) return 0n;
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      'Monetary amount is required',
      422,
    );
  }
  if (typeof raw === 'bigint') {
    if (raw < 0n || (!allowZero && raw === 0n)) {
      throw new CustomerDomainError(
        CustomerDomainErrorCode.VALIDATION_ERROR,
        `Invalid VND amount: ${raw.toString()}`,
        422,
      );
    }
    return raw;
  }
  const str = String(raw).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(str);
  if (!match) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      `Invalid VND amount format: ${str}`,
      422,
    );
  }
  const frac = (match[2] ?? '').padEnd(2, '0');
  if (frac !== '00') {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      `VND amount cannot contain fractional cents: ${str}`,
      422,
    );
  }
  const val = BigInt(match[1]);
  if (!allowZero && val === 0n) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      'VND amount must be strictly positive',
      422,
    );
  }
  return val;
}

export function formatVnd(amount: bigint): string {
  return `${amount.toString()}.00`;
}

export interface LoyaltySettingConfig {
  isEnabled: boolean;
  earnAmountPerPoint: string | number;
  redeemValuePerPoint: string | number;
  minRedeemPoints: number;
  maxRedeemPointsPerOrder?: number | null;
  holdTtlSeconds: number;
}

export function calculateEarnedPoints(
  eligibleSpendVnd: string | number | bigint,
  settings: Pick<LoyaltySettingConfig, 'isEnabled' | 'earnAmountPerPoint'>,
): {
  earnedPoints: number;
  eligibleSpendFormatted: string;
  appliedRateFormatted: string;
} {
  const spend = parseVndBigInt(eligibleSpendVnd, true);
  const rate = parseVndBigInt(settings.earnAmountPerPoint, false);

  if (!settings.isEnabled || spend <= 0n) {
    return {
      earnedPoints: 0,
      eligibleSpendFormatted: formatVnd(spend),
      appliedRateFormatted: formatVnd(rate),
    };
  }

  const points = Number(spend / rate);
  return {
    earnedPoints: Math.max(0, points),
    eligibleSpendFormatted: formatVnd(spend),
    appliedRateFormatted: formatVnd(rate),
  };
}

export function computeAvailablePoints(
  postedPointsBalance: number,
  heldPoints: number,
): number {
  return Math.max(0, postedPointsBalance - heldPoints);
}

export function validatePointRedemption(params: {
  requestedPoints: number;
  postedPointsBalance: number;
  heldPoints: number;
  settings: LoyaltySettingConfig;
}): {
  requestedPoints: number;
  availableBefore: number;
  availableAfter: number;
  discountValueVnd: string;
} {
  const { requestedPoints, postedPointsBalance, heldPoints, settings } = params;

  if (!settings.isEnabled) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.LOYALTY_NOT_ENABLED,
      'Loyalty program is currently disabled for this tenant',
      409,
    );
  }

  if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.VALIDATION_ERROR,
      'Requested loyalty points must be a positive integer',
      422,
    );
  }

  if (requestedPoints < settings.minRedeemPoints) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.LOYALTY_MINIMUM_NOT_MET,
      `Minimum redeemable points is ${settings.minRedeemPoints}`,
      422,
      {
        requestedPoints,
        minRedeemPoints: settings.minRedeemPoints,
      },
    );
  }

  if (
    settings.maxRedeemPointsPerOrder !== null &&
    settings.maxRedeemPointsPerOrder !== undefined &&
    requestedPoints > settings.maxRedeemPointsPerOrder
  ) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.LOYALTY_MAXIMUM_EXCEEDED,
      `Maximum redeemable points per order is ${settings.maxRedeemPointsPerOrder}`,
      422,
      {
        requestedPoints,
        maxRedeemPointsPerOrder: settings.maxRedeemPointsPerOrder,
      },
    );
  }

  const availableBefore = computeAvailablePoints(
    postedPointsBalance,
    heldPoints,
  );
  if (availableBefore < requestedPoints) {
    throw new CustomerDomainError(
      CustomerDomainErrorCode.INSUFFICIENT_LOYALTY_POINTS,
      `Insufficient available loyalty points: requested ${requestedPoints}, available ${availableBefore}`,
      409,
      {
        requestedPoints,
        availablePoints: availableBefore,
        postedPointsBalance,
        heldPoints,
      },
    );
  }

  const redeemRate = parseVndBigInt(settings.redeemValuePerPoint, false);
  const discountVnd = BigInt(requestedPoints) * redeemRate;

  return {
    requestedPoints,
    availableBefore,
    availableAfter: availableBefore - requestedPoints,
    discountValueVnd: formatVnd(discountVnd),
  };
}

/**
 * Calculates deterministic point reversal for full or partial sales returns
 * using the original EARN transaction snapshot (never current loyalty_settings).
 */
export function calculateReturnPointReversal(params: {
  originalEarnedPoints: number;
  alreadyReversedPoints: number;
  originalEligibleSpendVnd: string | number;
  returnRefundAmountVnd: string | number;
  cumulativeRefundedAmountVnd?: string | number;
}): {
  pointsToReverse: number;
  remainingReversibleAfter: number;
} {
  const {
    originalEarnedPoints,
    alreadyReversedPoints,
    originalEligibleSpendVnd,
    returnRefundAmountVnd,
    cumulativeRefundedAmountVnd,
  } = params;

  if (originalEarnedPoints <= 0) {
    return { pointsToReverse: 0, remainingReversibleAfter: 0 };
  }

  const remainingPoints = Math.max(
    0,
    originalEarnedPoints - alreadyReversedPoints,
  );
  if (remainingPoints === 0) {
    return { pointsToReverse: 0, remainingReversibleAfter: 0 };
  }

  const origSpend = parseVndBigInt(originalEligibleSpendVnd, true);
  const returnRefund = parseVndBigInt(returnRefundAmountVnd, true);
  if (origSpend <= 0n || returnRefund <= 0n) {
    return { pointsToReverse: 0, remainingReversibleAfter: remainingPoints };
  }

  if (cumulativeRefundedAmountVnd !== undefined) {
    const cumRefund = parseVndBigInt(cumulativeRefundedAmountVnd, true);
    if (cumRefund >= origSpend) {
      return {
        pointsToReverse: remainingPoints,
        remainingReversibleAfter: 0,
      };
    }
    const targetCumulativeReversed = Number(
      (BigInt(originalEarnedPoints) * cumRefund) / origSpend,
    );
    const delta = Math.max(
      0,
      Math.min(
        remainingPoints,
        targetCumulativeReversed - alreadyReversedPoints,
      ),
    );
    return {
      pointsToReverse: delta,
      remainingReversibleAfter: remainingPoints - delta,
    };
  }

  if (returnRefund >= origSpend) {
    return {
      pointsToReverse: remainingPoints,
      remainingReversibleAfter: 0,
    };
  }

  const proportional = Number(
    (BigInt(originalEarnedPoints) * returnRefund) / origSpend,
  );
  const pointsToReverse = Math.max(0, Math.min(remainingPoints, proportional));
  return {
    pointsToReverse,
    remainingReversibleAfter: remainingPoints - pointsToReverse,
  };
}

export interface MembershipTierCandidate {
  id: string;
  code: string;
  name: string;
  minPoints: number;
  discountRate: string;
  status: string;
}

export function resolveEligibleMembershipTier<
  T extends MembershipTierCandidate,
>(qualifyingPoints: number, tiers: T[]): T | null {
  const active = tiers.filter(
    (t) => t.status === 'ACTIVE' && qualifyingPoints >= t.minPoints,
  );
  if (active.length === 0) {
    return null;
  }
  active.sort((a, b) => {
    if (b.minPoints !== a.minPoints) {
      return b.minPoints - a.minPoints;
    }
    const discDiff = Number(b.discountRate) - Number(a.discountRate);
    if (discDiff !== 0) return discDiff;
    return a.code.localeCompare(b.code);
  });
  return active[0];
}

export function canonicalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizePayload);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = canonicalizePayload(v);
      }
    }
    return sorted;
  }
  return value;
}

export function computeCanonicalHash(payload: unknown): string {
  const json = JSON.stringify(canonicalizePayload(payload));
  return createHash('sha256').update(json).digest('hex');
}
