import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboxEventEntity } from './entities';
import { EventsConfig } from './events-config';
import { qualifiedTable } from './migrations';
import { markFailed, markPublished } from './outbox-retry';
import { EVENT_PUBLISHER, EventPublisher } from './publishers';
import { EVENTS_CONFIG, EVENTS_OPTIONS, PblEventsOptions } from './tokens';

/** The relay checks for old rows to delete once an hour */
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

/**
 * Publishes the outbox of a producing service. Polls for due rows with
 * `FOR UPDATE SKIP LOCKED`, so several replicas never publish the same row,
 * and retries a failed row with backoff (ADR-0007).
 */
@Injectable()
export class OutboxRelay
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private lastCleanup = 0;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(EVENTS_CONFIG) private readonly config: EventsConfig,
    @Inject(EVENTS_OPTIONS) private readonly options: PblEventsOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.options.produces) return;
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * One pass: claim due rows, publish each, record the outcome. Returns the
   * number published. Public so tests and tools can drive the relay.
   */
  async relayOnce(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OutboxEventEntity);
      const rows = await repository
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('o.published_at IS NULL')
        .andWhere('o.failed_at IS NULL')
        .andWhere('o.next_attempt_at <= now()')
        .orderBy('o.created_at', 'ASC')
        .limit(this.config.relayBatch)
        .getMany();

      let published = 0;
      for (const row of rows) {
        const now = new Date();
        try {
          await this.publisher.publish(row.payload);
          markPublished(row, now);
          published += 1;
        } catch (error) {
          markFailed(row, error, now, this.config.maxAttempts);
          if (row.failedAt) {
            this.logger.error(
              `Outbox event ${row.id} (${row.type}) failed ${row.attempts} times and is parked: ${row.lastError}`,
            );
          } else {
            this.logger.warn(
              `Publishing ${row.type} ${row.id} failed (attempt ${row.attempts}): ${row.lastError}`,
            );
          }
        }
      }
      if (rows.length > 0) await repository.save(rows);
      return published;
    });
  }

  /** Deletes rows published more than the retention period ago */
  async cleanup(): Promise<number> {
    const result = await this.dataSource.query(
      `DELETE FROM ${qualifiedTable(this.dataSource, 'outbox_event')}
       WHERE "published_at" < now() - make_interval(days => $1)`,
      [this.config.outboxRetentionDays],
    );
    // postgres DELETE returns [rows, rowCount]
    return Array.isArray(result) ? (result[1] ?? 0) : 0;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(async () => {
      try {
        await this.relayOnce();
        if (Date.now() - this.lastCleanup > CLEANUP_EVERY_MS) {
          this.lastCleanup = Date.now();
          await this.cleanup();
        }
      } catch (error) {
        this.logger.error(
          `Outbox relay pass failed: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        if (!this.stopped) this.schedule(this.config.relayIntervalMs);
      }
    }, delayMs);
    this.timer.unref?.();
  }
}
