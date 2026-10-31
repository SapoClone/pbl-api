import { storeNow, toHm, toMinutes } from './staff-time.util';

describe('staff time helpers', () => {
  it('formats and measures times', () => {
    expect(toHm('08:00:00')).toBe('08:00');
    expect(toMinutes('08:30:00')).toBe(510);
  });

  it.each([
    // Asia/Ho_Chi_Minh is UTC+7, no daylight saving
    ['2026-10-26T01:30:00Z', 1, 8 * 60 + 30], // Monday 08:30
    ['2026-10-26T17:30:00Z', 2, 30], // UTC Monday night is Tuesday 00:30 there
    ['2026-11-01T16:59:00Z', 7, 23 * 60 + 59], // Sunday 23:59
  ])('%s is weekday %i at minute %i', (iso, weekday, minutes) => {
    expect(storeNow(new Date(iso))).toEqual({ weekday, minutes });
  });
});
