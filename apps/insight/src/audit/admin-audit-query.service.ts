import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { AuthUser } from '@pbl/auth';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { AdminReadContext } from '../common/admin-read-context';
import { addDays } from '../common/store-time';
import { ListAdminAuditLogsReqDto } from './admin-audit.dto';
import { AUDIT_ACTIONS } from './audit-actions';

export interface AdminAuditLogItem {
  id: string;
  occurredAt: string;
  actor: {
    type: 'platform_admin' | 'member' | 'system';
    id: string | null;
    name: string | null;
  };
  scope: {
    type: 'platform' | 'tenant';
    tenantId: string | null;
    tenantName: string | null;
  };
  action: string;
  target: { type: string | null; id: string | null; name: string | null };
  result: 'success' | 'failed';
  errorCode: string | null;
  errorMessage: string | null;
}

const VN_OFFSET = '+07:00';

/** The platform-wide audit log for the admin web: every store plus platform-scope rows, read-only */
@Injectable()
export class AdminAuditQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adminRead: AdminReadContext,
  ) {}

  actions(): { data: string[] } {
    return { data: [...AUDIT_ACTIONS] };
  }

  async list(admin: AuthUser, query: ListAdminAuditLogsReqDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        details: [
          {
            property: 'from',
            code: 'fromAfterTo',
            message: 'from must not be after to',
          },
        ],
      });
    }
    const table = qualifiedTable(this.dataSource, 'audit_log');
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.scope) add(`"scope" = ?`, query.scope);
    if (query.tenantId) add(`"tenant_id" = ?`, query.tenantId);
    if (query.result) add(`"result" = ?`, query.result);
    if (query.action) add(`"action" = ?`, query.action);
    if (query.actorId) add(`"actor_id" = ?`, query.actorId);
    // days are Vietnam days, inclusive
    if (query.from) {
      add(
        `"occurred_at" >= ?::timestamptz`,
        `${query.from}T00:00:00${VN_OFFSET}`,
      );
    }
    if (query.to) {
      add(
        `"occurred_at" < ?::timestamptz`,
        `${addDays(query.to, 1)}T00:00:00${VN_OFFSET}`,
      );
    }
    if (query.q?.trim()) {
      const like = `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      params.push(like);
      const n = `$${params.length}`;
      where.push(
        `("action" ILIKE ${n} OR "target_name" ILIKE ${n} OR "actor_name" ILIKE ${n})`,
      );
    }
    const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const direction = query.order === 'ASC' ? 'ASC' : 'DESC';

    const { rows, total } = await this.adminRead.run(admin, async (em) => {
      const [{ n }] = await em.query(
        `SELECT count(*)::int AS n FROM ${table} ${condition}`,
        params,
      );
      const page: Record<string, any>[] = await em.query(
        `SELECT "id", "occurred_at", "actor_type", "actor_id", "actor_name", "scope", "tenant_id", "tenant_name",
                "action", "target_type", "target_id", "target_name", "result", "error_code", "error_message"
         FROM ${table} ${condition}
         ORDER BY "occurred_at" ${direction}, "id" ${direction}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return { rows: page, total: n as number };
    });

    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      data: rows.map(
        (r): AdminAuditLogItem => ({
          id: r.id,
          occurredAt: new Date(r.occurred_at).toISOString(),
          actor: { type: r.actor_type, id: r.actor_id, name: r.actor_name },
          scope: {
            type: r.scope,
            tenantId: r.tenant_id,
            tenantName: r.tenant_name,
          },
          action: r.action,
          target: { type: r.target_type, id: r.target_id, name: r.target_name },
          result: r.result,
          errorCode: r.error_code,
          errorMessage: r.error_message,
        }),
      ),
      pagination: {
        limit: query.limit,
        currentPage: query.page,
        ...(query.page < totalPages ? { nextPage: query.page + 1 } : {}),
        ...(query.page > 1 ? { previousPage: query.page - 1 } : {}),
        totalRecords: total,
        totalPages,
      },
    };
  }
}
