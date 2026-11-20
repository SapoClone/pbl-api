import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The platform-wide audit log ("Nhật ký hoạt động"): `audit_log` can now hold platform-scope rows (no store) and says
 * who did what to which object with what result.
 *
 * 1. `tenant_id` becomes nullable; new columns: scope, actor_type, actor_name, action, target_*, result, error_*,
 *    tenant_name (the store's name at write time, so no tenant projection is needed to show it).
 * 2. Backfill, one tenant at a time with `app.tenant_id` bound (the table is under row-level security): scope `tenant`,
 *    actor_type `member` when actor_id is set (`platform_admin` when the event's own actor says so) else `system`,
 *    result `success`, action from the event type, target from the payload when it is a store event, else null.
 * 3. Row-level security is now FORCED on the table (the service role owns it): a store sees its own rows; a
 *    transaction that sets `app.admin_read = 'on'` (only the admin read context does, after the platform-admin guard)
 *    can SELECT every row; a platform-scope row (tenant_id NULL) can only be INSERTed with `app.audit_platform_write`.
 *
 * `down` removes the platform-scope rows (they cannot exist under the old NOT NULL), the columns and the forcing.
 */
export class AuditLogPlatformScope1793500000000 implements MigrationInterface {
  name = 'AuditLogPlatformScope1793500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const audit = qualifiedTable(queryRunner, 'audit_log');

    await queryRunner.query(
      `ALTER TABLE ${audit} ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE ${audit}
        ADD COLUMN "scope" character varying(16) NOT NULL DEFAULT 'tenant',
        ADD COLUMN "actor_type" character varying(20) NOT NULL DEFAULT 'system',
        ADD COLUMN "actor_name" character varying(150),
        ADD COLUMN "action" character varying(100),
        ADD COLUMN "target_type" character varying(40),
        ADD COLUMN "target_id" character varying(64),
        ADD COLUMN "target_name" character varying(200),
        ADD COLUMN "result" character varying(10) NOT NULL DEFAULT 'success',
        ADD COLUMN "error_code" character varying(40),
        ADD COLUMN "error_message" character varying(500),
        ADD COLUMN "tenant_name" character varying(200)`);
    await queryRunner.query(`
      ALTER TABLE ${audit}
        ADD CONSTRAINT "CK_audit_log_scope" CHECK ("scope" IN ('platform', 'tenant')),
        ADD CONSTRAINT "CK_audit_log_actor_type" CHECK ("actor_type" IN ('platform_admin', 'member', 'system')),
        ADD CONSTRAINT "CK_audit_log_result" CHECK ("result" IN ('success', 'failed')),
        ADD CONSTRAINT "CK_audit_log_scope_tenant" CHECK (("scope" = 'platform') = ("tenant_id" IS NULL))`);

    // backfill: the tenant list is read while the table is not forced yet (the owner sees it all); the work itself binds
    // the tenant like any request, so it also holds when the policy is forced
    const tenants: { tenant_id: string }[] = await queryRunner.query(
      `SELECT DISTINCT "tenant_id" FROM ${audit} WHERE "tenant_id" IS NOT NULL ORDER BY "tenant_id"`,
    );
    for (const { tenant_id: tenantId } of tenants) {
      await queryRunner.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await queryRunner.query(
        `
        UPDATE ${audit} SET
          "actor_type" = CASE
            WHEN "data" #>> '{actor,type}' = 'platform_admin'
              OR "data" #>> '{changedBy,type}' = 'platform_admin' THEN 'platform_admin'
            WHEN "actor_id" IS NOT NULL THEN 'member'
            ELSE 'system' END,
          "action" = CASE "type"
            WHEN 'platform.tenant.created' THEN 'tenant.created'
            WHEN 'platform.tenant.updated' THEN 'tenant.updated'
            WHEN 'platform.tenant.status_changed' THEN 'tenant.status_changed'
            ELSE "type" END,
          "target_type" = CASE WHEN "type" LIKE 'platform.tenant.%' THEN 'tenant' END,
          "target_id" = CASE WHEN "type" LIKE 'platform.tenant.%'
            THEN left(coalesce("data" ->> 'id', "data" ->> 'tenantId'), 64) END,
          "target_name" = CASE WHEN "type" LIKE 'platform.tenant.%'
            THEN left("data" ->> 'code', 200) END,
          "tenant_name" = CASE WHEN "type" LIKE 'platform.tenant.%'
            THEN left("data" ->> 'name', 200) END
        WHERE "tenant_id" = $1`,
        [tenantId],
      );
    }
    await queryRunner.query(
      `UPDATE ${audit} SET "action" = "type" WHERE "action" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${audit} ALTER COLUMN "action" SET NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_occurred" ON ${audit} ("occurred_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_actor_occurred" ON ${audit} ("actor_id", "occurred_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_action_occurred" ON ${audit} ("action", "occurred_at" DESC)`,
    );

    // forced policies: a store's own rows; the admin read path; platform-scope inserts
    await enableTenantRlsPolicy(queryRunner, audit);
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_admin_read" ON ${audit}`,
    );
    await queryRunner.query(`
      CREATE POLICY "audit_admin_read" ON ${audit} FOR SELECT
      USING (current_setting('app.admin_read', true) = 'on')`);
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_platform_insert" ON ${audit}`,
    );
    await queryRunner.query(`
      CREATE POLICY "audit_platform_insert" ON ${audit} FOR INSERT
      WITH CHECK ("tenant_id" IS NULL AND "scope" = 'platform'
        AND current_setting('app.audit_platform_write', true) = 'on')`);
    // ON CONFLICT DO NOTHING (idempotent writes) needs the new row to be visible to the writer: while the write flag
    // is on, and only for platform-scope rows
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_platform_write_select" ON ${audit}`,
    );
    await queryRunner.query(`
      CREATE POLICY "audit_platform_write_select" ON ${audit} FOR SELECT
      USING ("tenant_id" IS NULL AND current_setting('app.audit_platform_write', true) = 'on')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const audit = qualifiedTable(queryRunner, 'audit_log');
    // the owner is exempt again, so the platform-scope rows can be removed without a tenant bound
    await queryRunner.query(`ALTER TABLE ${audit} NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_admin_read" ON ${audit}`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_platform_insert" ON ${audit}`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS "audit_platform_write_select" ON ${audit}`,
    );
    await queryRunner.query(`DELETE FROM ${audit} WHERE "tenant_id" IS NULL`);
    for (const index of [
      'IDX_audit_log_occurred',
      'IDX_audit_log_actor_occurred',
      'IDX_audit_log_action_occurred',
    ]) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS ${qualifiedTable(queryRunner, index)}`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE ${audit}
        DROP CONSTRAINT "CK_audit_log_scope_tenant",
        DROP CONSTRAINT "CK_audit_log_result",
        DROP CONSTRAINT "CK_audit_log_actor_type",
        DROP CONSTRAINT "CK_audit_log_scope"`);
    await queryRunner.query(`
      ALTER TABLE ${audit}
        DROP COLUMN "tenant_name", DROP COLUMN "error_message", DROP COLUMN "error_code",
        DROP COLUMN "result", DROP COLUMN "target_name", DROP COLUMN "target_id",
        DROP COLUMN "target_type", DROP COLUMN "action", DROP COLUMN "actor_name",
        DROP COLUMN "actor_type", DROP COLUMN "scope"`);
    await queryRunner.query(
      `ALTER TABLE ${audit} ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await enableTenantRlsPolicy(
      queryRunner,
      audit,
      'tenant_isolation_policy',
      false,
    );
  }
}
