import { currentMonth, monthRange } from './customers.service';

describe('store calendar months (Asia/Ho_Chi_Minh)', () => {
  it('names the month by the store clock, not UTC', () => {
    // 2026-10-31 18:00 UTC is already 1 November in Ho Chi Minh City
    expect(currentMonth(new Date('2026-10-31T18:00:00Z'))).toBe('2026-11');
    expect(currentMonth(new Date('2026-10-31T16:59:00Z'))).toBe('2026-10');
  });

  it('gives the half-open range of a month in UTC instants', () => {
    const [from, to] = monthRange('2026-10');
    expect(from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(monthRange('2026-12')[1].toISOString()).toBe(
      '2026-12-31T17:00:00.000Z',
    );
  });
});
