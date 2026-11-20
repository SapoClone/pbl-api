import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { AuditWriter } from '../../audit/audit-writer.service';
import {
  AnnouncementDeliveryService,
  AnnouncementRow,
} from './announcement-delivery.service';

export const ANNOUNCEMENT_JOB_EVERY_MS = 60 * 1000;
/** Announcements one round delivers at most; the rest wait for the next round */
const MAX_PER_ROUND = 20;

export interface AnnouncementRunResult {
  sent: number;
  failed: number;
}

/**
 * Sends the scheduled announcements that came due. Each one is claimed with `FOR UPDATE SKIP LOCKED` inside the
 * transaction that delivers it, so replicas running together share the work and never deliver one announcement twice;
 * the recipient rows are unique per (announcement, store) as a second guard. A failure rolls that announcement back
 * and it stays `scheduled`, so the next round retries it; the others of the round are not held up by it.
 */
@Injectable()
export class AnnouncementSchedulerJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AnnouncementSchedulerJob.name);
  private timer?: NodeJS.Timeout;
  /** Replaced by tests */
  clock: () => Date = () => new Date();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly delivery: AnnouncementDeliveryService,
    private readonly audit: AuditWriter,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), ANNOUNCEMENT_JOB_EVERY_MS);
    this.timer.unref?.();
    void this.run();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<AnnouncementRunResult> {
    const result = { sent: 0, failed: 0 };
    const failedIds: string[] = [];
    const table = qualifiedTable(this.dataSource, 'announcement');
    while (result.sent + result.failed < MAX_PER_ROUND) {
      const now = this.clock();
      let delivered: { row: AnnouncementRow; recipients: number } | null = null;
      try {
        delivered = await this.dataSource.transaction(async (em) => {
          const [row]: AnnouncementRow[] = await em.query(
            `SELECT * FROM ${table}
              WHERE "status" = 'scheduled' AND "scheduled_at" <= $1 AND "id" <> ALL($2::uuid[])
              ORDER BY "scheduled_at", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [now, failedIds],
          );
          if (!row) return null;
          // remembered before delivering: if delivery throws, this round skips it
          failedIds.push(row.id);
          const recipients = await this.delivery.deliver(em, row, now);
          failedIds.pop();
          return { row, recipients };
        });
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          `Announcement send failed, it stays scheduled: ${error instanceof Error ? error.message : error}`,
        );
        continue;
      }
      if (!delivered) break;
      result.sent += 1;
      await this.recordSent(delivered.row, delivered.recipients);
    }
    if (result.sent + result.failed > 0) {
      this.logger.log(
        `Announcements: ${result.sent} sent, ${result.failed} failed`,
      );
    }
    return result;
  }

  private async recordSent(
    row: AnnouncementRow,
    recipientCount: number,
  ): Promise<void> {
    try {
      await this.audit.record({
        scope: 'platform',
        actor: { type: 'system', id: null, name: null },
        action: 'announcement.sent',
        target: { type: 'announcement', id: row.id, name: row.title },
        result: 'success',
        data: { audience: row.audience, recipientCount, scheduled: true },
      });
    } catch (error) {
      this.logger.error(
        `Audit of announcement.sent failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
