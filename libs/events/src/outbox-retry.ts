import { OutboxEventEntity } from './entities';

const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Wait before the next publish attempt: 2, 4, 8 ... seconds, at most five minutes */
export const backoffMs = (attempts: number): number =>
  Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);

type Row = Pick<
  OutboxEventEntity,
  'publishedAt' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'failedAt'
>;

export function markPublished(row: Row, now: Date): void {
  row.publishedAt = now;
  row.lastError = null;
}

/**
 * Records a failed publish. The row is rescheduled with backoff; after
 * `maxAttempts` it is flagged `failedAt` and left for inspection, never dropped.
 */
export function markFailed(
  row: Row,
  error: unknown,
  now: Date,
  maxAttempts: number,
): void {
  row.attempts += 1;
  row.lastError = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 500);
  if (row.attempts >= maxAttempts) {
    row.failedAt = now;
  } else {
    row.nextAttemptAt = new Date(now.getTime() + backoffMs(row.attempts));
  }
}
