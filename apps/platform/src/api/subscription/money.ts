import { ValueTransformer } from 'typeorm';

/** Postgres returns bigint as a string; money is a whole number of VND (api conventions, section 3). */
export const bigintMoney: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) => {
    if (value === null || value === undefined) return value;
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`Money value is not a safe integer: ${String(value)}`);
    }
    return n;
  },
};
