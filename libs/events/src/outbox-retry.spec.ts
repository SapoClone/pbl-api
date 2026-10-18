import { backoffMs, markFailed, markPublished } from './outbox-retry';

const row = () => ({
  publishedAt: null as Date | null,
  attempts: 0,
  nextAttemptAt: new Date(0),
  lastError: null as string | null,
  failedAt: null as Date | null,
});

describe('outbox retry', () => {
  it('backs off 2, 4, 8 ... seconds up to five minutes', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(5 * 60 * 1000);
  });

  it('marks a row published and clears the last error', () => {
    const r = row();
    r.lastError = 'boom';
    const now = new Date();
    markPublished(r, now);
    expect(r.publishedAt).toBe(now);
    expect(r.lastError).toBeNull();
  });

  it('reschedules a failed row with backoff and keeps the error', () => {
    const r = row();
    const now = new Date('2026-10-18T00:00:00Z');
    markFailed(r, new Error('sns down'), now, 10);
    expect(r.attempts).toBe(1);
    expect(r.lastError).toBe('sns down');
    expect(r.nextAttemptAt.getTime()).toBe(now.getTime() + 2000);
    expect(r.failedAt).toBeNull();
  });

  it('parks the row after the maximum number of attempts, never dropping it', () => {
    const r = row();
    r.attempts = 9;
    const now = new Date();
    markFailed(r, 'still down', now, 10);
    expect(r.attempts).toBe(10);
    expect(r.failedAt).toBe(now);
    expect(r.publishedAt).toBeNull();
  });

  it('truncates a very long error message', () => {
    const r = row();
    markFailed(r, new Error('x'.repeat(2000)), new Date(), 10);
    expect(r.lastError).toHaveLength(500);
  });
});
