import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { InsightErrorCode } from '../insight-errors';
import { NotificationEntity, Severity } from './notification.entities';
import { ListNotificationsReqDto } from './notifications.dto';

export interface NewNotification {
  /** Pass the event id from a handler: one event, one notification */
  id?: string;
  type: string;
  title: string;
  body?: string | null;
  refType?: string | null;
  refId?: string | null;
  branchId?: string | null;
  severity?: Severity;
}

interface Row {
  id: string;
  type: string;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  branch_id: string | null;
  severity: Severity;
  created_at: Date;
  is_read: boolean;
}

/** Store-wide notifications with a read state per account */
@Injectable()
export class NotificationsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private table(name: string) {
    return qualifiedTable(this.dataSource, name);
  }

  /** Writes a notification in the tenant of the context; inside a handler pass its transaction manager */
  async create(
    input: NewNotification,
    manager?: EntityManager,
  ): Promise<string> {
    const repo = TenantScopedRepository.forEntity(
      manager ?? this.dataSource,
      NotificationEntity,
    );
    const row = new NotificationEntity();
    row.id = input.id ?? randomUUID();
    row.type = input.type;
    row.title = input.title.slice(0, 300);
    row.body = input.body ?? null;
    row.refType = input.refType ?? null;
    row.refId = input.refId ?? null;
    row.branchId = input.branchId ?? null;
    row.severity = input.severity ?? 'info';
    await repo.save(row);
    return row.id;
  }

  async list(accountId: string, query: ListNotificationsReqDto) {
    const where = ['n."tenant_id" = $1'];
    const params: unknown[] = [TenantContext.require(), accountId];
    if (query.type) {
      params.push(query.type.split(','));
      where.push(`n."type" = ANY($${params.length}::text[])`);
    }
    if (query.branchId) {
      params.push(query.branchId);
      where.push(`n."branch_id" = $${params.length}`);
    }
    if (query.unread) where.push('r."notification_id" IS NULL');
    const from = `FROM ${this.table('notification')} n
      LEFT JOIN ${this.table('notification_read')} r
        ON r."notification_id" = n."id" AND r."account_id" = $2
     WHERE ${where.join(' AND ')}`;

    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*) AS total ${from}`,
      params,
    );
    const rows: Row[] = await this.dataSource.query(
      `SELECT n.*, (r."notification_id" IS NOT NULL) AS is_read ${from}
        ORDER BY n."created_at" DESC, n."id" LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      params,
    );
    const totalRecords = Number(total);
    const totalPages = Math.max(1, Math.ceil(totalRecords / query.limit));
    return {
      data: rows.map(toResponse),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        totalRecords,
        totalPages,
      },
    };
  }

  async unreadCount(accountId: string): Promise<{ count: number }> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM ${this.table('notification')} n
        WHERE n."tenant_id" = $1 AND NOT EXISTS (
          SELECT 1 FROM ${this.table('notification_read')} r
           WHERE r."notification_id" = n."id" AND r."account_id" = $2)`,
      [TenantContext.require(), accountId],
    );
    return { count: Number(row.count) };
  }

  /** Idempotent; a notification of another store is a 404 */
  async markRead(accountId: string, id: string): Promise<void> {
    const rows = await this.dataSource.query(
      `INSERT INTO ${this.table('notification_read')} ("notification_id", "account_id")
       SELECT n."id", $3 FROM ${this.table('notification')} n
        WHERE n."id" = $1 AND n."tenant_id" = $2
       ON CONFLICT DO NOTHING RETURNING "notification_id"`,
      [id, TenantContext.require(), accountId],
    );
    if (rows.length > 0) return;
    const [exists] = await this.dataSource.query(
      `SELECT 1 FROM ${this.table('notification')} WHERE "id" = $1 AND "tenant_id" = $2`,
      [id, TenantContext.require()],
    );
    if (!exists) {
      throw new NotFoundException({
        errorCode: InsightErrorCode.NOTIFICATION_NOT_FOUND,
        message: 'Notification not found',
      });
    }
  }

  async markAllRead(accountId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ${this.table('notification_read')} ("notification_id", "account_id")
       SELECT n."id", $2 FROM ${this.table('notification')} n WHERE n."tenant_id" = $1
       ON CONFLICT DO NOTHING`,
      [TenantContext.require(), accountId],
    );
  }

  /**
   * Things that need the owner's attention: the caller's unread warning and critical
   * notifications. Producers of such notifications (low stock, unmapped SKU, pending
   * receipt) do not exist yet, so the list is usually empty.
   */
  async attentionItems(
    accountId: string,
    query: { branchId?: string; limit: number },
  ) {
    const rows: Row[] = await this.dataSource.query(
      `SELECT n.*, false AS is_read FROM ${this.table('notification')} n
        WHERE n."tenant_id" = $1 AND n."severity" IN ('warning', 'critical')
          AND ($3::uuid IS NULL OR n."branch_id" = $3)
          AND NOT EXISTS (
            SELECT 1 FROM ${this.table('notification_read')} r
             WHERE r."notification_id" = n."id" AND r."account_id" = $2)
        ORDER BY (n."severity" = 'critical') DESC, n."created_at" DESC LIMIT 200`,
      [TenantContext.require(), accountId, query.branchId ?? null],
    );
    return {
      total: rows.length,
      data: rows.slice(0, query.limit).map((n) => ({
        id: n.id,
        type: n.type,
        severity: n.severity,
        title: n.title,
        detail: n.body,
        action: n.ref_type
          ? { label: null, target: n.ref_type, params: { id: n.ref_id } }
          : null,
      })),
    };
  }
}

function toResponse(n: Row) {
  return {
    id: n.id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    body: n.body,
    actionLabel: null,
    refType: n.ref_type,
    refId: n.ref_id,
    branchId: n.branch_id,
    isRead: n.is_read,
    createdAt: new Date(n.created_at).toISOString(),
  };
}
