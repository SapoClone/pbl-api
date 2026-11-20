import { UnprocessableEntityException } from '@nestjs/common';
import {
  audienceFilter,
  audienceProblem,
  normalizeAudience,
} from './announcements/audience';
import {
  daysInRange,
  eachDay,
  instantBounds,
  previousRange,
  resolveRange,
} from './date-range';

describe('date ranges of the admin dashboard', () => {
  const now = new Date('2026-10-20T20:00:00.000Z'); // already 21/10 in Vietnam

  it('defaults to today in Vietnam', () => {
    expect(resolveRange(undefined, undefined, { now })).toEqual({
      from: '2026-10-21',
      to: '2026-10-21',
    });
  });

  it('refuses from after to, a bad date and a range over the maximum with 422', () => {
    expect(() => resolveRange('2026-10-02', '2026-10-01')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => resolveRange('2026-02-30', '2026-03-01')).toThrow(
      UnprocessableEntityException,
    );
    expect(() =>
      resolveRange('2026-01-01', '2026-04-03', { maxDays: 92 }),
    ).toThrow(UnprocessableEntityException);
    expect(
      resolveRange('2026-01-01', '2026-04-02', { maxDays: 92 }),
    ).toBeTruthy();
  });

  it('counts both ends, takes the previous range of the same length and lists every day', () => {
    const range = { from: '2026-10-17', to: '2026-10-23' };
    expect(daysInRange(range)).toBe(7);
    expect(previousRange(range)).toEqual({
      from: '2026-10-10',
      to: '2026-10-16',
    });
    expect(eachDay({ from: '2026-10-30', to: '2026-11-02' })).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('turns Vietnam days into UTC instants', () => {
    expect(instantBounds({ from: '2026-10-20', to: '2026-10-20' })).toEqual({
      start: new Date('2026-10-19T17:00:00.000Z'),
      end: new Date('2026-10-20T17:00:00.000Z'),
    });
  });
});

describe('announcement audiences', () => {
  it('accepts the four kinds and refuses malformed ones', () => {
    expect(audienceProblem({ type: 'all' })).toBeNull();
    expect(audienceProblem({ type: 'plan', planCodes: ['pro'] })).toBeNull();
    expect(
      audienceProblem({ type: 'integration_provider', providers: ['shopee'] }),
    ).toBeNull();
    expect(
      audienceProblem({
        type: 'tenants',
        tenantIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      }),
    ).toBeNull();
    expect(audienceProblem(null)).not.toBeNull();
    expect(audienceProblem({ type: 'plan' })).not.toBeNull();
    expect(audienceProblem({ type: 'plan', planCodes: [] })).not.toBeNull();
    expect(audienceProblem({ type: 'plan', planCodes: [1] })).not.toBeNull();
    expect(
      audienceProblem({ type: 'integration_provider', providers: ['ebay'] }),
    ).not.toBeNull();
    expect(
      audienceProblem({ type: 'tenants', tenantIds: ['x'] }),
    ).not.toBeNull();
    expect(audienceProblem({ type: 'everyone' })).not.toBeNull();
  });

  it('normalizes to the fields of its kind without duplicates', () => {
    expect(
      normalizeAudience({
        type: 'plan',
        planCodes: ['pro', ' pro', 'free'],
        junk: 1,
      } as never),
    ).toEqual({ type: 'plan', planCodes: ['pro', 'free'] });
    expect(
      normalizeAudience({ type: 'all', planCodes: ['x'] } as never),
    ).toEqual({
      type: 'all',
    });
  });

  it('never selects suspended stores', () => {
    for (const audience of [
      { type: 'all' as const },
      { type: 'plan' as const, planCodes: ['pro'] },
      { type: 'integration_provider' as const, providers: ['shopee'] },
      { type: 'tenants' as const, tenantIds: [] },
    ]) {
      expect(audienceFilter(audience).where).toContain(
        `"status" <> 'suspended'`,
      );
    }
  });
});
