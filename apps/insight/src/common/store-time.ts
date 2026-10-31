/** Vietnam is UTC+7 all year round; the reporting timezone of insight (see insight-domain) */
export const STORE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const STORE_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The day an instant falls on in the store's timezone, as YYYY-MM-DD */
export function salesDate(instant: string): string {
  return new Date(Date.parse(instant) + STORE_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** The hour (0-23) an instant falls in, in the store's timezone */
export function salesHour(instant: string): number {
  return new Date(Date.parse(instant) + STORE_UTC_OFFSET_MS).getUTCHours();
}

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
