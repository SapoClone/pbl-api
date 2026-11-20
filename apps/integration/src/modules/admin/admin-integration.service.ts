import { Injectable } from '@nestjs/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource } from 'typeorm';
import { runAsAdminRead } from '../../common/admin-read-context';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import { ConnectionsService } from '../connections/connections.service';
import {
  ListAdminConnectionsQueryDto,
  ListSyncHistoryQueryDto,
  ListWebhookEventsQueryDto,
} from './admin-integration.dto';
import {
  CONNECTION_STATUSES,
  ConnectionDetailRow,
  ConnectionRow,
  FAILED_JOB_STATUSES,
  SyncJobRow,
  WebhookRow,
  escapeLike,
  lower,
  paginate,
  toConnectionDetail,
  toConnectionItem,
  toSyncHistoryItem,
  toWebhookEventItem,
  upper,
} from './admin-integration.mapper';

/** How long the synchronous connection check may take before it answers 504-style `timeout` */
export const CHECK_TIMEOUT_MS = 5000;

const TZ = `'Asia/Ho_Chi_Minh'`;

/** `2026-02-30` matches the pattern but is not a day */
function isRealDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Collects `$n` parameters for a WHERE clause */
class Where {
  readonly params: unknown[] = [];
  readonly clauses: string[] = [];
  add(sql: (placeholder: string) => string, value: unknown): void {
    this.params.push(value);
    this.clauses.push(sql(`$${this.params.length}`));
  }
  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

/**
 * Cross-store reads and actions of the platform admin on marketplace connections. Reads go through `runAsAdminRead`
 * (SELECT-only policy branch); the disconnect reuses the store-side transition for the connection's own store.
 * Never selects a token, secret, oauth state, webhook secret or payload column.
 */
@Injectable()
export class AdminIntegrationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connections: ConnectionsService,
  ) {}

  private t(name: string): string {
    return qualifiedTable(this.dataSource, name);
  }

  async listConnections(query: ListAdminConnectionsQueryDto) {
    const base = new Where();
    if (query.q?.trim()) {
      base.add(
        (p) => `(c.shop_name ILIKE ${p} OR t.name ILIKE ${p})`,
        `%${escapeLike(query.q.trim())}%`,
      );
    }
    if (query.provider)
      base.add((p) => `c.provider = ${p}`, upper(query.provider));
    if (query.branchId) base.add((p) => `c.branch_id = ${p}`, query.branchId);
    const filtered = new Where();
    filtered.params.push(...base.params);
    filtered.clauses.push(...base.clauses);
    if (query.status) {
      filtered.add((p) => `c.status = ${p}`, upper(query.status as string));
    }
    const from = `FROM ${this.t('channel_connections')} c
      LEFT JOIN ${this.t('tenant_projection')} t ON t.tenant_id = c.tenant_id
      LEFT JOIN ${this.t('branch_projection')} b ON b.branch_id = c.branch_id`;
    const dir = query.order === 'ASC' ? 'ASC' : 'DESC';

    return runAsAdminRead(this.dataSource, async (em) => {
      const [{ total }] = await em.query(
        `SELECT count(*)::int AS total ${from} ${filtered.sql}`,
        filtered.params,
      );
      const rows: ConnectionRow[] = await em.query(
        `SELECT c.id, c.code, c.tenant_id, t.name AS tenant_name, c.branch_id, b.name AS branch_name,
                c.provider, c.external_shop_id, c.shop_name, c.status, c.last_sync_at
         ${from} ${filtered.sql}
         ORDER BY c.created_at ${dir}, c.id
         LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        filtered.params,
      );
      const byStatus: { status: string; n: number }[] = await em.query(
        `SELECT c.status, count(*)::int AS n ${from} ${base.sql} GROUP BY c.status`,
        base.params,
      );
      const counts: Record<string, number> = { all: 0 };
      for (const s of CONNECTION_STATUSES) counts[s] = 0;
      for (const r of byStatus) {
        counts[lower(r.status)] = r.n;
        counts.all += r.n;
      }
      return {
        ...paginate(rows.map(toConnectionItem), query.page, query.limit, total),
        counts,
      };
    });
  }

  async getConnection(id: string) {
    return runAsAdminRead(this.dataSource, async (em) => {
      const rows: ConnectionDetailRow[] = await em.query(
        `SELECT c.id, c.code, c.tenant_id, t.name AS tenant_name, c.branch_id, b.name AS branch_name,
                c.provider, c.external_shop_id, c.shop_name, c.status, c.last_sync_at,
                c.last_order_sync_at, c.last_inventory_sync_at, c.last_error_code, c.last_error_message,
                c.consecutive_failures, c.safety_stock_buffer, c.stock_allocation_percent, c.created_at,
                cr.scopes, cr.access_token_expires_at, cr.refresh_token_expires_at,
                (SELECT count(*) FROM ${this.t('sku_mappings')} m
                  WHERE m.connection_id = c.id AND m.status = 'ACTIVE') AS mapped_skus,
                (SELECT count(*) FROM ${this.t('integration_catalog_variants')} v
                  WHERE v.tenant_id = c.tenant_id AND v.status = 'ACTIVE') AS total_skus,
                (SELECT count(*) FROM ${this.t('sync_jobs')} j
                  WHERE j.connection_id = c.id
                    AND j.created_at >= (date_trunc('day', now() AT TIME ZONE ${TZ})) AT TIME ZONE ${TZ}) AS jobs_today,
                (SELECT count(*) FROM ${this.t('sync_jobs')} j
                  WHERE j.connection_id = c.id AND j.status = ANY($2)
                    AND j.created_at >= (date_trunc('day', now() AT TIME ZONE ${TZ})) AT TIME ZONE ${TZ}) AS jobs_failed_today
         FROM ${this.t('channel_connections')} c
         LEFT JOIN ${this.t('connection_credentials')} cr ON cr.connection_id = c.id
         LEFT JOIN ${this.t('tenant_projection')} t ON t.tenant_id = c.tenant_id
         LEFT JOIN ${this.t('branch_projection')} b ON b.branch_id = c.branch_id
         WHERE c.id = $1`,
        [id, FAILED_JOB_STATUSES],
      );
      if (rows.length === 0) throw this.notFound(id);
      return toConnectionDetail(rows[0]);
    });
  }

  async listSyncHistory(query: ListSyncHistoryQueryDto) {
    const w = new Where();
    if (query.connectionId)
      w.add((p) => `j.connection_id = ${p}`, query.connectionId);
    if (query.tenantId) w.add((p) => `j.tenant_id = ${p}`, query.tenantId);
    if (query.status) w.add((p) => `j.status = ${p}`, upper(query.status));
    if (query.jobType) w.add((p) => `j.job_type = ${p}`, upper(query.jobType));
    this.addDateRange(w, 'j.created_at', query.from, query.to);
    const dir = query.order === 'ASC' ? 'ASC' : 'DESC';
    return runAsAdminRead(this.dataSource, async (em) => {
      const [{ total }] = await em.query(
        `SELECT count(*)::int AS total FROM ${this.t('sync_jobs')} j ${w.sql}`,
        w.params,
      );
      const rows: SyncJobRow[] = await em.query(
        `SELECT j.id, j.code, j.connection_id, j.job_type, j.status, j.attempt_count, j.last_error_code,
                j.last_error_message, j.started_at, j.created_at, j.completed_at
         FROM ${this.t('sync_jobs')} j ${w.sql}
         ORDER BY j.created_at ${dir}, j.id
         LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        w.params,
      );
      return paginate(
        rows.map(toSyncHistoryItem),
        query.page,
        query.limit,
        total,
      );
    });
  }

  async listWebhookEvents(query: ListWebhookEventsQueryDto) {
    const w = new Where();
    if (query.connectionId)
      w.add((p) => `e.connection_id = ${p}`, query.connectionId);
    if (query.provider)
      w.add((p) => `e.provider = ${p}`, upper(query.provider));
    if (query.status)
      w.add((p) => `e.processing_status = ${p}`, upper(query.status));
    this.addDateRange(w, 'e.received_at', query.from, query.to);
    const dir = query.order === 'ASC' ? 'ASC' : 'DESC';
    return runAsAdminRead(this.dataSource, async (em) => {
      const [{ total }] = await em.query(
        `SELECT count(*)::int AS total FROM ${this.t('webhook_inbox_events')} e ${w.sql}`,
        w.params,
      );
      // named columns only: never `encrypted_payload`
      const rows: WebhookRow[] = await em.query(
        `SELECT e.id, e.connection_id, e.provider, e.event_type, e.external_event_id, e.processing_status,
                e.last_error, e.received_at
         FROM ${this.t('webhook_inbox_events')} e ${w.sql}
         ORDER BY e.received_at ${dir}, e.id
         LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        w.params,
      );
      return paginate(
        rows.map(toWebhookEventItem),
        query.page,
        query.limit,
        total,
      );
    });
  }

  /**
   * The same probe as the store's `GET connections/:id/health` (in-process: token expiry, circuit breaker, status;
   * no call to the marketplace), under a timeout. It changes no state.
   */
  async checkConnection(id: string) {
    const tenantId = await this.tenantOf(id);
    const probe = this.connections.getConnectionHealth(id, tenantId);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CHECK_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([probe, timeout]);
      const checkedAt = new Date().toISOString();
      if (result === 'timeout') {
        return {
          status: 'timeout',
          checkedAt,
          message: `The check did not finish within ${CHECK_TIMEOUT_MS / 1000} seconds`,
        };
      }
      return {
        status: lower(result.status),
        checkedAt,
        message: this.describe(result),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Finds the store of a connection through the admin read path; 404 when there is none */
  async tenantOf(id: string): Promise<string> {
    return runAsAdminRead(this.dataSource, async (em) => {
      const rows: { tenant_id: string }[] = await em.query(
        `SELECT tenant_id FROM ${this.t('channel_connections')} WHERE id = $1`,
        [id],
      );
      if (rows.length === 0) throw this.notFound(id);
      return rows[0].tenant_id;
    });
  }

  async disconnect(params: {
    id: string;
    reason: string;
    admin: { id: string; name: string | null };
    idempotencyKey?: string;
  }) {
    const tenantId = await this.tenantOf(params.id);
    const { view, replayed } =
      await this.connections.disconnectConnectionAsAdmin({
        tenantId,
        connectionId: params.id,
        admin: params.admin,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
      });
    return { replayed, connection: await this.getConnection(view.id) };
  }

  private describe(
    h: Awaited<ReturnType<ConnectionsService['getConnectionHealth']>>,
  ) {
    if (h.healthy) return 'The connection is healthy';
    if (h.tokenStatus.isExpired) return 'The access token has expired';
    if (h.circuitBreaker.state !== 'CLOSED') {
      return 'The provider circuit breaker is open after repeated failures';
    }
    return `The connection is ${lower(h.status).replace(/_/g, ' ')}`;
  }

  private addDateRange(w: Where, column: string, from?: string, to?: string) {
    for (const [name, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value !== undefined && !isRealDate(value)) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.VALIDATION_ERROR,
          `${name} is not a valid date`,
          422,
        );
      }
    }
    if (from) {
      w.add(
        (p) => `${column} >= (${p}::date)::timestamp AT TIME ZONE ${TZ}`,
        from,
      );
    }
    if (to) {
      w.add(
        (p) => `${column} < ((${p}::date) + 1)::timestamp AT TIME ZONE ${TZ}`,
        to,
      );
    }
  }

  private notFound(id: string): IntegrationDomainError {
    return new IntegrationDomainError(
      IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
      `Channel connection ${id} not found`,
      404,
    );
  }
}
