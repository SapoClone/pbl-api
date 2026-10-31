import { parseRange, todayRange } from './order-query.service';

describe('date ranges of the order list', () => {
  it('reads a date as a day in UTC+7 and the end date as inclusive', () => {
    const { from, to } = parseRange('2026-10-20', '2026-10-20');
    expect(from?.toISOString()).toBe('2026-10-19T17:00:00.000Z');
    expect(to?.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('takes a datetime as given', () => {
    const { from, to } = parseRange(
      '2026-10-20T01:00:00.000Z',
      '2026-10-20T02:00:00.000Z',
    );
    expect(from?.toISOString()).toBe('2026-10-20T01:00:00.000Z');
    expect(to?.toISOString()).toBe('2026-10-20T02:00:00.000Z');
  });

  it('leaves open ends open', () => {
    expect(parseRange()).toEqual({ from: undefined, to: undefined });
  });

  it('today starts at midnight of UTC+7', () => {
    // 23:30 UTC on the 20th is already the 21st in Ho Chi Minh City
    const { from, to } = todayRange(new Date('2026-10-20T23:30:00.000Z'));
    expect(from.toISOString()).toBe('2026-10-20T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-21T17:00:00.000Z');
  });
});
