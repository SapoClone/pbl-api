/**
 * Money is a whole number of VND (bigint column, JSON number). TypeORM returns
 * bigint as a string, so every money column uses `moneyTransformer`.
 */
export function toMoney(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Money value is not a safe integer: ${String(value)}`);
  }
  return n;
}

export function toMoneyOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toMoney(value);
}

export const moneyTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null | undefined) =>
    value === null || value === undefined ? value : toMoney(value),
};

/**
 * Rounds an external (possibly fractional) amount to whole VND, half up
 * (`Math.round`). Used at the line level where marketplaces send fractions.
 */
export function roundVnd(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Money value is not a finite number: ${String(value)}`);
  }
  return toMoney(Math.round(n));
}
