import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Audience, audienceFilter } from './audience';

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  type: string;
  audience: Audience;
  status: string;
  scheduled_at: Date | null;
  sent_at: Date | null;
  recipient_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Notification type the store's bell shows an announcement as */
export const ANNOUNCEMENT_NOTIFICATION_TYPE = 'announcement';

/**
 * Resolves who an announcement reaches and writes it into their inboxes. Always called inside a transaction that holds
 * the announcement row locked, so two replicas never deliver the same announcement, and a failure rolls back every
 * row it wrote (the announcement stays as it was and is retried).
 */
@Injectable()
export class AnnouncementDeliveryService {
  private readonly logger = new Logger(AnnouncementDeliveryService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private table(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  /** The stores an audience reaches right now (suspended ones never), from `tenant_projection` */
  async targets(
    audience: Audience,
    em: EntityManager | DataSource = this.dataSource,
  ): Promise<string[]> {
    const { where, params } = audienceFilter(audience);
    const rows: { tenant_id: string }[] = await em.query(
      `SELECT t."tenant_id" FROM ${this.table('tenant_projection')} t WHERE ${where} ORDER BY t."tenant_id"`,
      params,
    );
    return rows.map((r) => r.tenant_id);
  }

  async countTargets(audience: Audience): Promise<number> {
    const { where, params } = audienceFilter(audience);
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ${this.table('tenant_projection')} t WHERE ${where}`,
      params,
    );
    return row.n;
  }

  /**
   * Writes one recipient row and one `notification` row per target store and marks the announcement sent. The recipient
   * row is unique per (announcement, store) and the notification takes its id, so running this twice for the same
   * announcement adds nothing the second time. The store is bound to the transaction (`app.tenant_id`) for each write
   * into the row-level-security table `notification`.
   */
  async deliver(
    em: EntityManager,
    announcement: AnnouncementRow,
    now: Date,
  ): Promise<number> {
    const tenantIds = await this.targets(announcement.audience, em);
    if (tenantIds.length === 0) {
      this.logger.warn(
        `Announcement ${announcement.id} reached no store when it was sent`,
      );
    }
    const recipient = this.table('announcement_recipient');
    const notification = this.table('notification');
    for (const tenantId of tenantIds) {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const inserted = await em.query(
        `INSERT INTO ${recipient} ("id", "announcement_id", "tenant_id") VALUES ($1, $2, $3)
         ON CONFLICT ("announcement_id", "tenant_id") DO NOTHING RETURNING "id"`,
        [randomUUID(), announcement.id, tenantId],
      );
      if (inserted.length === 0) continue;
      await em.query(
        `INSERT INTO ${notification}
           ("id", "tenant_id", "type", "title", "body", "ref_type", "ref_id", "severity", "created_at")
         VALUES ($1, $2, $3, $4, $5, 'announcement', $6, 'info', $7)`,
        [
          inserted[0].id,
          tenantId,
          ANNOUNCEMENT_NOTIFICATION_TYPE,
          announcement.title.slice(0, 300),
          announcement.content,
          announcement.id,
          now,
        ],
      );
    }
    const [{ n }] = await em.query(
      `SELECT count(*)::int AS n FROM ${recipient} WHERE "announcement_id" = $1`,
      [announcement.id],
    );
    await em.query(
      `UPDATE ${this.table('announcement')}
         SET "status" = 'sent', "sent_at" = $2, "recipient_count" = $3, "updated_at" = $2
       WHERE "id" = $1`,
      [announcement.id, now, n],
    );
    return n;
  }
}
