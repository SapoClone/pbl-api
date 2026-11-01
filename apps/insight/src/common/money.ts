import { ValueTransformer } from 'typeorm';

/**
 * Money is a whole number of VND (docs/specs/2026-11-01-adopt-m1-m6/phase-3-rules.md). Postgres returns
 * bigint (and every SUM or raw cast) as a string: this is the one place that turns it back into a
 * number and fails loudly when it is not a safe integer. Same contract as the money helper of the sales service.
 */
export function toMoney(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'string' && /^-?\d+$/.test(value.trim())
          ? Number(value)
          : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Money value is not a safe integer: ${String(value)}`);
  }
  return n;
}

/** Same as toMoney, null and undefined pass through */
export function toMoneyOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toMoney(value);
}

/** Column transformer for every bigint money column */
export const moneyTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? value : toMoney(value),
};
