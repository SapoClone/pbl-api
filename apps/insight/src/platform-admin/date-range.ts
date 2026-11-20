import { UnprocessableEntityException } from '@nestjs/common';
import { STORE_TIME_ZONE, addDays, salesDate } from '../common/store-time';

export const MAX_DAILY_RANGE_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DateRange {
  /** YYYY-MM-DD, inclusive, a Vietnam calendar day */
  from: string;
  to: string;
}

const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/** Days from `from` to `to`, both counted */
export const daysInRange = ({ from, to }: DateRange): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

/**
 * The range of a request: missing ends default to today (Vietnam), `from` after `to` is a 422, and so is a range
 * longer than `maxDays`.
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  options: { maxDays?: number; now?: Date } = {},
): DateRange {
  const today = salesDate((options.now ?? new Date()).toISOString());
  const range = { from: from ?? to ?? today, to: to ?? from ?? today };
  for (const [property, value] of Object.entries(range)) {
    if (!isDate(value)) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        details: [
          {
            property,
            code: 'isDate',
            message: `${property} must be YYYY-MM-DD`,
          },
        ],
      });
    }
  }
  if (range.from > range.to) {
    throw new UnprocessableEntityException({
      message: 'Validation failed',
      details: [
        {
          property: 'from',
          code: 'rangeOrder',
          message: 'from must not be after to',
        },
      ],
    });
  }
  if (options.maxDays && daysInRange(range) > options.maxDays) {
    throw new UnprocessableEntityException({
      message: 'Validation failed',
      details: [
        {
          property: 'to',
          code: 'rangeTooLong',
          message: `the range is at most ${options.maxDays} days`,
        },
      ],
    });
  }
  return range;
}

/** The range right before this one with the same number of days (the comparison period) */
export function previousRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** Every day of the range, in order */
export function eachDay({ from, to }: DateRange): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The instants a Vietnam day range covers: `[start, end)` as UTC dates (Vietnam is UTC+7 all year) */
export function instantBounds({ from, to }: DateRange): {
  start: Date;
  end: Date;
} {
  const offset = 7 * 60 * 60 * 1000;
  return {
    start: new Date(Date.parse(from) - offset),
    end: new Date(Date.parse(addDays(to, 1)) - offset),
  };
}

export const OVERVIEW_TIME_ZONE = STORE_TIME_ZONE;
