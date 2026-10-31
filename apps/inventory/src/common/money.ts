import { ValueTransformer } from 'typeorm';

/**
 * Money is a whole number of VND. Postgres stores it as bigint (returned by
 * the driver as a string); this module converts it back to a safe integer and
 * fails loudly on anything else.
 */
export function toVnd(value: unknown, label = 'money'): number {
  if (typeof value === 'string' && value.trim() !== '') {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(
      `${label} must be a safe integer VND amount, got ${String(value)}`,
    );
  }
  return value;
}

export function toVndOrNull(value: unknown, label = 'money'): number | null {
  return value === null || value === undefined ? null : toVnd(value, label);
}

export const moneyTransformer: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: unknown) =>
    value === null || value === undefined ? value : toVnd(value),
};
