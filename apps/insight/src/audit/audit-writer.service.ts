import { Injectable } from '@nestjs/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

/**
 * One thing that happened, for the platform-wide audit log. The stable input of `AuditWriter`: announcements (in
 * process) and the event handlers of insight both write through it. Do not change it without telling its callers.
 */
export interface AdminAuditEntry {
  /** Defaults to now */
  occurredAt?: Date;
  /** `platform`: belongs to no store (`tenantId` null); `tenant`: happened in or to the store `tenantId` */
  scope: 'platform' | 'tenant';
  tenantId?: string | null;
  actor: {
    type: 'platform_admin' | 'member' | 'system';
    id?: string | null;
    name?: string | null;
  };
  /** The action code, e.g. `tenant.updated` (see docs/guides/audit-log.md) */
  action: string;
  target?: { type: string; id?: string | null; name?: string | null };
  result: 'success' | 'failed';
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * Free details kept with the row (before/after values, reasons). Never secrets. `tenantName` here is the store's
   * name, which the list shows as `scope.tenantName`.
   */
  data?: Record<string, unknown>;
}

const clip = (value: string | null | undefined, max: number) =>
  value === undefined || value === null ? null : value.slice(0, max);

/**
 * Writes `audit_log` rows. `record` is the public entry (its own transaction); `recordIn` joins the transaction of
 * an event handler, with the event id as the row id so one event stays one row (a redelivery is ignored).
 *
 * The table is under forced row-level security: a store's row is written with that store bound
 * (`app.tenant_id`), a platform-scope row with `app.audit_platform_write`, both transaction-local.
 */
@Injectable()
export class AuditWriter {
  constructor(private readonly dataSource: DataSource) {}

  async record(entry: AdminAuditEntry): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.recordIn(manager, entry),
    );
  }

  /**
   * Inside the caller's transaction. `meta.id` makes the write idempotent (the event id); without one a new id is used.
   * (No RETURNING: a platform-scope row is not visible to the writer's own SELECT policy.)
   */
  async recordIn(
    manager: EntityManager,
    entry: AdminAuditEntry,
    meta: { id?: string; eventType?: string; summary?: string } = {},
  ): Promise<void> {
    const id = meta.id ?? randomUUID();
    const tenantId = entry.tenantId ?? null;
    if (entry.scope === 'platform' && tenantId !== null) {
      throw new Error('A platform-scope audit entry has no tenantId');
    }
    if (entry.scope === 'tenant' && tenantId === null) {
      throw new Error('A tenant-scope audit entry needs a tenantId');
    }
    const table = qualifiedTable(this.dataSource, 'audit_log');

    if (tenantId) {
      await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
    } else {
      await manager.query(
        `SELECT set_config('app.audit_platform_write', 'on', true)`,
      );
    }

    const data = entry.data ?? {};
    let tenantName =
      typeof data.tenantName === 'string' ? data.tenantName : null;
    if (tenantId && !tenantName) {
      // the last name this store was written under
      const [row] = await manager.query(
        `SELECT "tenant_name" FROM ${table}
         WHERE "tenant_id" = $1 AND "tenant_name" IS NOT NULL
         ORDER BY "occurred_at" DESC LIMIT 1`,
        [tenantId],
      );
      tenantName = row?.tenant_name ?? null;
    }

    const actorName = entry.actor.name ?? null;
    const summary =
      meta.summary ??
      [
        actorName ?? entry.actor.type,
        entry.action,
        entry.target?.name ?? entry.target?.id ?? '',
      ]
        .filter(Boolean)
        .join(' ');

    await manager.query(
      `INSERT INTO ${table}
        ("id", "tenant_id", "scope", "type", "action", "actor_id", "actor_type", "actor_name", "summary", "data",
         "occurred_at", "target_type", "target_id", "target_name", "result", "error_code", "error_message",
         "tenant_name")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT ("id") DO NOTHING`,
      [
        id,
        tenantId,
        entry.scope,
        clip(meta.eventType ?? entry.action, 150),
        clip(entry.action, 100),
        entry.actor.id ?? null,
        entry.actor.type,
        clip(actorName, 150),
        clip(summary, 300),
        JSON.stringify(data),
        (entry.occurredAt ?? new Date()).toISOString(),
        clip(entry.target?.type, 40),
        clip(entry.target?.id, 64),
        clip(entry.target?.name, 200),
        entry.result,
        clip(entry.errorCode, 40),
        clip(entry.errorMessage, 500),
        clip(tenantName, 200),
      ],
    );
    if (!tenantId) {
      await manager.query(
        `SELECT set_config('app.audit_platform_write', 'off', true)`,
      );
    }
  }
}
