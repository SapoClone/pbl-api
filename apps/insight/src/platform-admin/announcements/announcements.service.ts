import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuditWriter } from '../../audit/audit-writer.service';
import { InsightErrorCode } from '../../insight-errors';
import { instantBounds } from '../date-range';
import {
  AnnouncementDeliveryService,
  AnnouncementRow,
} from './announcement-delivery.service';
import {
  AnnouncementStatus,
  AudiencePreviewReqDto,
  CreateAnnouncementReqDto,
  ListAnnouncementsReqDto,
  UpdateAnnouncementReqDto,
} from './announcements.dto';
import { Audience, normalizeAudience } from './audience';

export interface AdminActor {
  id: string;
}

const iso = (date: Date | null) => (date ? new Date(date).toISOString() : null);

export function toAnnouncement(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    type: row.type,
    audience: row.audience,
    status: row.status as AnnouncementStatus,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    scheduledAt: iso(row.scheduled_at),
    sentAt: iso(row.sent_at),
    recipientCount: row.recipient_count,
  };
}

/** Platform-admin side of announcements: drafts, preview, send, schedule, cancel, delete */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  /** Replaced by tests */
  clock: () => Date = () => new Date();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly delivery: AnnouncementDeliveryService,
    private readonly audit: AuditWriter,
  ) {}

  private get announcements() {
    return qualifiedTable(this.dataSource, 'announcement');
  }

  async list(query: ListAnnouncementsReqDto) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.q?.trim()) {
      params.push(`%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`a."title" ILIKE $${params.length}`);
    }
    if (query.type) {
      params.push(query.type);
      where.push(`a."type" = $${params.length}`);
    }
    if (query.from) {
      params.push(instantBounds({ from: query.from, to: query.from }).start);
      where.push(`a."created_at" >= $${params.length}`);
    }
    if (query.to) {
      params.push(instantBounds({ from: query.to, to: query.to }).end);
      where.push(`a."created_at" < $${params.length}`);
    }
    const base = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRows: { status: AnnouncementStatus; n: number }[] =
      await this.dataSource.query(
        `SELECT a."status", count(*)::int AS n FROM ${this.announcements} a ${base} GROUP BY a."status"`,
        params,
      );
    const counts = { all: 0, draft: 0, scheduled: 0, sent: 0 };
    for (const row of countRows) {
      counts[row.status] = row.n;
      counts.all += row.n;
    }

    const listParams = [...params];
    let filtered = base;
    if (query.status) {
      listParams.push(query.status);
      filtered = `${base ? `${base} AND` : 'WHERE'} a."status" = $${listParams.length}`;
    }
    const totalRecords = query.status ? counts[query.status] : counts.all;
    const direction = query.order === 'asc' ? 'ASC' : 'DESC';
    listParams.push(query.limit, (query.page - 1) * query.limit);
    const rows: AnnouncementRow[] = await this.dataSource.query(
      `SELECT a.* FROM ${this.announcements} a ${filtered}
       ORDER BY a."created_at" ${direction}, a."id" LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    const totalPages = Math.max(1, Math.ceil(totalRecords / query.limit));
    return {
      data: rows.map(toAnnouncement),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        ...(query.page > 1 ? { previousPage: query.page - 1 } : {}),
        totalRecords,
        totalPages,
      },
      counts,
    };
  }

  async get(id: string) {
    return toAnnouncement(await this.find(this.dataSource, id));
  }

  async create(dto: CreateAnnouncementReqDto, admin: AdminActor) {
    const scheduledAt = this.futureOrNull(dto.scheduledAt);
    const id = randomUUID();
    await this.dataSource.query(
      `INSERT INTO ${this.announcements}
         ("id", "title", "content", "type", "audience", "status", "scheduled_at", "created_by")
       VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6, $7)`,
      [
        id,
        dto.title.trim(),
        dto.content,
        dto.type,
        JSON.stringify(normalizeAudience(dto.audience)),
        scheduledAt,
        admin.id,
      ],
    );
    return this.get(id);
  }

  /** Only a draft can be edited: a scheduled one is cancelled first, a sent one never changes */
  async update(id: string, dto: UpdateAnnouncementReqDto) {
    return this.dataSource.transaction(async (em) => {
      const row = await this.find(em, id, true);
      this.requireDraft(row);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (column: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`"${column}" = $${params.length}${cast}`);
      };
      if (dto.title !== undefined) set('title', dto.title.trim());
      if (dto.content !== undefined) set('content', dto.content);
      if (dto.type !== undefined) set('type', dto.type);
      if (dto.audience !== undefined) {
        set(
          'audience',
          JSON.stringify(normalizeAudience(dto.audience)),
          '::jsonb',
        );
      }
      if (dto.scheduledAt !== undefined) {
        set('scheduled_at', this.futureOrNull(dto.scheduledAt));
      }
      if (sets.length > 0) {
        await em.query(
          `UPDATE ${this.announcements} SET ${sets.join(', ')}, "updated_at" = now() WHERE "id" = $1`,
          params,
        );
      }
      return toAnnouncement(await this.find(em, id));
    });
  }

  async audiencePreview(dto: AudiencePreviewReqDto) {
    return {
      tenantCount: await this.delivery.countTargets(
        normalizeAudience(dto.audience),
      ),
    };
  }

  /**
   * Sends now (no `scheduledAt`) or schedules. The audience is resolved when the send happens (for a schedule: when it
   * comes due); a send or schedule that finds no store is refused (N002).
   */
  async send(
    id: string,
    scheduledAtInput: string | null | undefined,
    admin: AdminActor,
  ) {
    const now = this.clock();
    let scheduledAt: Date | null = null;
    if (scheduledAtInput) {
      scheduledAt = new Date(scheduledAtInput);
      if (scheduledAt.getTime() <= now.getTime()) {
        throw new UnprocessableEntityException({
          message: 'Validation failed',
          details: [
            {
              property: 'scheduledAt',
              code: 'isFuture',
              message: 'scheduledAt must be in the future',
            },
          ],
        });
      }
    }
    const { row, recipientCount } = await this.dataSource.transaction(
      async (em) => {
        const locked = await this.find(em, id, true);
        if (locked.status === 'sent') {
          throw new BadRequestException({
            errorCode: InsightErrorCode.ANNOUNCEMENT_ALREADY_SENT,
            message: 'The announcement was already sent',
          });
        }
        if ((await this.delivery.targets(locked.audience, em)).length === 0) {
          throw new BadRequestException({
            errorCode: InsightErrorCode.ANNOUNCEMENT_NO_AUDIENCE,
            message: 'The audience has no store',
          });
        }
        if (scheduledAt) {
          await em.query(
            `UPDATE ${this.announcements}
               SET "status" = 'scheduled', "scheduled_at" = $2, "updated_at" = $3 WHERE "id" = $1`,
            [id, scheduledAt, now],
          );
          return { row: await this.find(em, id), recipientCount: 0 };
        }
        const count = await this.delivery.deliver(em, locked, now);
        return { row: await this.find(em, id), recipientCount: count };
      },
    );
    await this.record(
      scheduledAt ? 'announcement.scheduled' : 'announcement.sent',
      row,
      admin,
      scheduledAt
        ? { scheduledAt: scheduledAt.toISOString() }
        : { recipientCount },
    );
    return toAnnouncement(row);
  }

  /** A scheduled announcement goes back to a draft; a draft stays one; a sent one cannot be taken back */
  async cancel(id: string, admin: AdminActor) {
    const now = this.clock();
    const { row, changed } = await this.dataSource.transaction(async (em) => {
      const locked = await this.find(em, id, true);
      if (locked.status === 'sent') {
        throw new BadRequestException({
          errorCode: InsightErrorCode.ANNOUNCEMENT_ALREADY_SENT,
          message: 'The announcement was already sent',
        });
      }
      if (locked.status === 'draft') return { row: locked, changed: false };
      await em.query(
        `UPDATE ${this.announcements}
           SET "status" = 'draft', "scheduled_at" = NULL, "updated_at" = $2 WHERE "id" = $1`,
        [id, now],
      );
      return { row: await this.find(em, id), changed: true };
    });
    if (changed) await this.record('announcement.cancelled', row, admin);
    return toAnnouncement(row);
  }

  /** Only a draft is deleted */
  async remove(id: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const row = await this.find(em, id, true);
      this.requireDraft(row);
      await em.query(`DELETE FROM ${this.announcements} WHERE "id" = $1`, [id]);
    });
  }

  private requireDraft(row: AnnouncementRow): void {
    if (row.status === 'sent') {
      throw new BadRequestException({
        errorCode: InsightErrorCode.ANNOUNCEMENT_ALREADY_SENT,
        message: 'The announcement was already sent',
      });
    }
    if (row.status === 'scheduled') {
      throw new BadRequestException({
        errorCode: InsightErrorCode.ANNOUNCEMENT_SCHEDULED,
        message: 'Cancel the schedule first',
      });
    }
  }

  private futureOrNull(value: string | null | undefined): Date | null {
    if (!value) return null;
    const at = new Date(value);
    if (at.getTime() <= this.clock().getTime()) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        details: [
          {
            property: 'scheduledAt',
            code: 'isFuture',
            message: 'scheduledAt must be in the future',
          },
        ],
      });
    }
    return at;
  }

  private async find(
    source: EntityManager | DataSource,
    id: string,
    lock = false,
  ): Promise<AnnouncementRow> {
    const [row] = await source.query(
      `SELECT * FROM ${this.announcements} WHERE "id" = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!row) {
      throw new NotFoundException({
        message: 'Announcement not found',
      });
    }
    return row;
  }

  /** The admin action is already committed, so a failing audit write is logged and does not undo it */
  private async record(
    action: string,
    row: AnnouncementRow,
    admin: AdminActor,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.audit.record({
        scope: 'platform',
        actor: { type: 'platform_admin', id: admin.id, name: null },
        action,
        target: { type: 'announcement', id: row.id, name: row.title },
        result: 'success',
        data: { audience: row.audience as Audience, ...data },
      });
    } catch (error) {
      this.logger.error(
        `Audit of ${action} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
