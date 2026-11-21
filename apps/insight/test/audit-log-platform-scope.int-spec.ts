/**
 * The platform-scope audit log under the database role production uses: owner of the tables, not a superuser, no
 * BYPASSRLS. Covers the migration (backfill under forced row-level security, down), the policies (a store sees its own
 * rows only, platform-scope rows need the write flag, the admin read path is read-only and admin-only), the writer and
 * the two read services. Run with
 * `pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1 apps/insight/test/audit-log-platform-scope.int-spec.ts`.
 */
import { ForbiddenException } from '@nestjs/common';
import { RequestContext, TenantScopedRepository } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { AdminAuditQueryService } from '../src/audit/admin-audit-query.service';
import { AuditLogEntity } from '../src/audit/audit-log.entity';
import { AuditQueryService } from '../src/audit/audit-query.service';
import { AuditWriter } from '../src/audit/audit-writer.service';
import { AdminReadContext } from '../src/common/admin-read-context';
import { M7_INSIGHT_ENTITIES } from '../src/infrastructure/persistence/insight.entities';
import { CreateInsightTables1791800000100 } from '../src/migrations/1791800000100-create-insight-tables';
import { CreateM7InsightCore1791900000300 } from '../src/migrations/1791900000300-create-m7-insight-core';
import { CreateNotifications1792000000200 } from '../src/migrations/1792000000200-create-notifications';
import { AuditLogPlatformScope1793500000000 } from '../src/migrations/1793500000000-audit-log-platform-scope';
import { NOTIFICATION_ENTITIES } from '../src/notifications/notification.entities';

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MEMBER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('platform-scope audit log as the production database role (Postgres)', () => {
  const schema = uniqueSchema('insight_audit_it');
  const role = `${schema}_app`;
  let admin: DataSource;
  let roleDs: DataSource;
  let writer: AuditWriter;
  let adminRead: AdminReadContext;
  let adminAudit: AdminAuditQueryService;
  let storeAudit: AuditQueryService;
  const t = (name: string) => `"${schema}"."${name}"`;

  const legacyRow = (
    tenant: string,
    type: string,
    actorId: string | null,
    data: Record<string, unknown>,
    occurredAt = '2026-10-01T00:00:00Z',
  ) =>
    admin.query(
      `INSERT INTO ${t('audit_log')} (id, tenant_id, type, actor_id, summary, data, occurred_at)
       VALUES ($1, $2, $3, $4, 'legacy', $5::jsonb, $6)`,
      [randomUUID(), tenant, type, actorId, JSON.stringify(data), occurredAt],
    );

  /** A raw query as the restricted role, in a transaction with the given settings bound */
  const asRole = async <R>(
    settings: Record<string, string>,
    work: (
      q: (sql: string, params?: unknown[]) => Promise<any[]>,
    ) => Promise<R>,
  ): Promise<R> => {
    const runner = roleDs.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      for (const [key, value] of Object.entries(settings)) {
        await runner.query(`SELECT set_config($1, $2, true)`, [key, value]);
      }
      return await work((sql, params) => runner.query(sql, params));
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  };

  const tenantCount = (settings: Record<string, string>) =>
    asRole(settings, async (q) => {
      const [{ n }] = await q(
        `SELECT count(*)::int AS n FROM ${t('audit_log')}`,
      );
      return n as number;
    });

  beforeAll(async () => {
    useDatabase(schema);
    admin = await initializeDatabase(
      databaseOptions({
        entities: [
          AuditLogEntity,
          ...NOTIFICATION_ENTITIES,
          ...M7_INSIGHT_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        // everything BEFORE the migration under test
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInsightTables1791800000100,
          CreateM7InsightCore1791900000300,
          CreateNotifications1792000000200,
        ],
      }),
    );

    // legacy rows, as the old handler wrote them
    await legacyRow(T1, 'platform.tenant.updated', ADMIN, {
      id: T1,
      code: 'TN0001',
      name: 'Cua hang A',
      actor: { type: 'platform_admin', id: ADMIN },
      changes: { name: { from: 'x', to: 'Cua hang A' } },
    });
    await legacyRow(T1, 'platform.account.logged_in', MEMBER, {
      accountId: MEMBER,
    });
    await legacyRow(T2, 'inventory.purchase_order.approved', null, {
      code: 'PO1',
    });

    // the production role: owner of the table, not a superuser, no BYPASSRLS
    await provisionServiceRole(admin, schema, role);
    await admin.query(`GRANT CREATE ON SCHEMA "${schema}" TO "${role}"`);
    await admin.query(`ALTER TABLE ${t('audit_log')} OWNER TO "${role}"`);

    roleDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: role,
      password: role,
      database: 'pbl',
      schema,
      entities: [AuditLogEntity],
    });
    await roleDs.initialize();

    writer = new AuditWriter(roleDs);
    adminRead = new AdminReadContext(roleDs);
    adminAudit = new AdminAuditQueryService(roleDs, adminRead);
    storeAudit = new AuditQueryService(
      TenantScopedRepository.forEntity(roleDs, AuditLogEntity),
    );
  });

  afterAll(async () => {
    await roleDs?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.destroy();
  });

  const runMigration = async (direction: 'up' | 'down') => {
    const runner = roleDs.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await new AuditLogPlatformScope1793500000000()[direction](runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  };

  it('runs as a restricted role', async () => {
    const [{ rolsuper, rolbypassrls }] = await admin.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(rolsuper).toBe(false);
    expect(rolbypassrls).toBe(false);
  });

  it('migrates up as that role and backfills every tenant', async () => {
    await runMigration('up');

    const rows = await admin.query(
      `SELECT type, scope, actor_type, action, target_type, target_id, target_name, tenant_name, result
       FROM ${t('audit_log')} ORDER BY type`,
    );
    expect(rows).toEqual([
      {
        type: 'inventory.purchase_order.approved',
        scope: 'tenant',
        actor_type: 'system',
        action: 'inventory.purchase_order.approved',
        target_type: null,
        target_id: null,
        target_name: null,
        tenant_name: null,
        result: 'success',
      },
      {
        type: 'platform.account.logged_in',
        scope: 'tenant',
        actor_type: 'member',
        action: 'platform.account.logged_in',
        target_type: null,
        target_id: null,
        target_name: null,
        tenant_name: null,
        result: 'success',
      },
      {
        type: 'platform.tenant.updated',
        scope: 'tenant',
        actor_type: 'platform_admin',
        action: 'tenant.updated',
        target_type: 'tenant',
        target_id: T1,
        target_name: 'TN0001',
        tenant_name: 'Cua hang A',
        result: 'success',
      },
    ]);
    const [{ relforcerowsecurity }] = await admin.query(
      `SELECT relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'audit_log'`,
      [schema],
    );
    expect(relforcerowsecurity).toBe(true);
  });

  it('shows a store its own rows only, and nothing without a tenant bound', async () => {
    expect(await tenantCount({})).toBe(0);
    expect(await tenantCount({ 'app.tenant_id': T1 })).toBe(2);
    expect(await tenantCount({ 'app.tenant_id': T2 })).toBe(1);
  });

  it('refuses a row for another store and a platform row without the write flag', async () => {
    const insert = (
      q: (s: string, p?: unknown[]) => Promise<any[]>,
      scope: string,
      tenant: string | null,
    ) =>
      q(
        `INSERT INTO ${t('audit_log')} (id, tenant_id, scope, type, action, summary, data, occurred_at)
         VALUES ($1, $2, $3, 'x', 'x', 'x', '{}', now())`,
        [randomUUID(), tenant, scope],
      );
    await expect(
      asRole({ 'app.tenant_id': T1 }, (q) => insert(q, 'tenant', T2)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asRole({ 'app.tenant_id': T1 }, (q) => insert(q, 'platform', null)),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asRole({}, (q) => insert(q, 'platform', null)),
    ).rejects.toThrow(/row-level security/);
    // the admin read flag opens SELECT only, never INSERT
    await expect(
      asRole({ 'app.admin_read': 'on' }, (q) => insert(q, 'platform', null)),
    ).rejects.toThrow(/row-level security/);
  });

  describe('the writer', () => {
    it('writes a platform-scope row that no store can see', async () => {
      await writer.record({
        scope: 'platform',
        actor: { type: 'platform_admin', id: ADMIN, name: 'Lan Anh' },
        action: 'settings.changed',
        target: {
          type: 'setting',
          id: 'security.lockoutMaxAttempts',
          name: 'security.lockoutMaxAttempts',
        },
        result: 'success',
        data: {
          changes: { 'security.lockoutMaxAttempts': { from: 5, to: 6 } },
        },
      });
      expect(await tenantCount({ 'app.tenant_id': T1 })).toBe(2);
      expect(await tenantCount({ 'app.tenant_id': T2 })).toBe(1);
      expect(await tenantCount({})).toBe(0);
      expect(await tenantCount({ 'app.admin_read': 'on' })).toBe(4);
    });

    it('writes a store row, taking the store name from the last row when the entry has none', async () => {
      await writer.record({
        scope: 'tenant',
        tenantId: T1,
        actor: { type: 'platform_admin', id: ADMIN, name: 'Lan Anh' },
        action: 'account.sessions_revoked',
        target: { type: 'account', id: MEMBER, name: 'Minh' },
        result: 'failed',
        errorCode: 'X1',
        errorMessage: 'nope',
      });
      const [row] = await admin.query(
        `SELECT tenant_name, result, error_code FROM ${t('audit_log')} WHERE action = 'account.sessions_revoked'`,
      );
      expect(row).toEqual({
        tenant_name: 'Cua hang A',
        result: 'failed',
        error_code: 'X1',
      });
      expect(await tenantCount({ 'app.tenant_id': T1 })).toBe(3);
      expect(await tenantCount({ 'app.tenant_id': T2 })).toBe(1);
    });

    it('is idempotent on the row id and rejects an inconsistent scope', async () => {
      const id = randomUUID();
      const entry = {
        scope: 'platform' as const,
        actor: { type: 'system' as const },
        action: 'settings.changed',
        result: 'success' as const,
      };
      await roleDs.transaction(async (m) => {
        await writer.recordIn(m, entry, { id });
        await writer.recordIn(m, entry, { id });
      });
      const [{ n }] = await admin.query(
        `SELECT count(*)::int AS n FROM ${t('audit_log')} WHERE id = $1`,
        [id],
      );
      expect(n).toBe(1);
      await expect(writer.record({ ...entry, tenantId: T1 })).rejects.toThrow(
        /platform-scope/,
      );
      await expect(
        writer.record({ ...entry, scope: 'tenant' }),
      ).rejects.toThrow(/needs a tenantId/);
    });
  });

  describe('the store route keeps returning only the store', () => {
    it('does not return platform-scope rows or another store', async () => {
      const as = <R>(tenantId: string, work: () => Promise<R>) =>
        RequestContext.run({ tenantId, requestId: 'it' }, work);
      const a = await as(T1, () =>
        storeAudit.auditLogs({ page: 1, limit: 50 }),
      );
      const b = await as(T2, () =>
        storeAudit.auditLogs({ page: 1, limit: 50 }),
      );
      expect(a.pagination.totalRecords).toBe(3);
      expect(a.data.every((r) => r.type !== 'settings.changed')).toBe(true);
      expect(b.pagination.totalRecords).toBe(1);
      await expect(
        storeAudit.auditLogs({ page: 1, limit: 10 }),
      ).rejects.toThrow(/tenant/i);
    });
  });

  describe('the admin read path', () => {
    const adminUser = { subjectType: 'platform_admin' as const };

    it('reads every store and platform-scope rows, with the contract shape', async () => {
      const all = await adminAudit.list(adminUser as any, {
        page: 1,
        limit: 50,
        order: 'DESC',
      });
      expect(all.pagination.totalRecords).toBe(6);
      const platform = await adminAudit.list(adminUser as any, {
        page: 1,
        limit: 50,
        order: 'DESC',
        scope: 'platform',
      });
      expect(platform.data).toHaveLength(2);
      expect(platform.data[0]).toEqual(
        expect.objectContaining({
          actor: expect.objectContaining({ type: expect.any(String) }),
          scope: { type: 'platform', tenantId: null, tenantName: null },
          result: 'success',
          errorCode: null,
          errorMessage: null,
        }),
      );
      const one = await adminAudit.list(adminUser as any, {
        page: 1,
        limit: 50,
        order: 'DESC',
        tenantId: T1,
        action: 'tenant.updated',
        actorId: ADMIN,
        q: 'tn0001',
        from: '2026-10-01',
        to: '2026-10-01',
      });
      expect(one.data).toEqual([
        expect.objectContaining({
          action: 'tenant.updated',
          scope: { type: 'tenant', tenantId: T1, tenantName: 'Cua hang A' },
          target: { type: 'tenant', id: T1, name: 'TN0001' },
          actor: { type: 'platform_admin', id: ADMIN, name: null },
        }),
      ]);
      const failed = await adminAudit.list(adminUser as any, {
        page: 1,
        limit: 50,
        order: 'DESC',
        result: 'failed',
      });
      expect(failed.data.map((r) => r.action)).toEqual([
        'account.sessions_revoked',
      ]);
    });

    it('refuses a caller that is not a platform admin and cannot write', async () => {
      await expect(
        adminRead.run({ subjectType: 'account' }, async () => 1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        adminRead.run(adminUser, (m) =>
          m.query(`DELETE FROM ${t('audit_log')}`),
        ),
      ).rejects.toThrow(/read-only/);
    });
  });

  it('migrates down: platform-scope rows go, columns go, the owner is exempt again', async () => {
    await runMigration('down');
    const columns = await admin.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'audit_log'`,
      [schema],
    );
    const names = columns.map((c: any) => c.column_name);
    expect(names).not.toContain('scope');
    expect(names).not.toContain('action');
    expect(
      columns.find((c: any) => c.column_name === 'tenant_id').is_nullable,
    ).toBe('NO');
    const [{ n }] = await admin.query(
      `SELECT count(*)::int AS n FROM ${t('audit_log')}`,
    );
    expect(n).toBe(4); // 3 legacy + the store row; the 2 platform rows are gone
    // and up again works on the data that is there
    await runMigration('up');
    const [{ m }] = await admin.query(
      `SELECT count(*)::int AS m FROM ${t('audit_log')}`,
    );
    expect(m).toBe(4);
  });
});
