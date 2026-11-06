import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** The plan limits catalog enforces (products, storage), kept from platform's events. See TenantPlanQuotaEntity. */
export class CreateTenantPlanQuota1792800000000 implements MigrationInterface {
  name = 'CreateTenantPlanQuota1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'tenant_plan_quota');
    await queryRunner.query(`
      CREATE TABLE ${table} (
        "tenant_id" uuid NOT NULL,
        "plan_code" character varying(32) NOT NULL,
        "quota_products" integer NOT NULL,
        "quota_storage_mb" integer NOT NULL,
        "source_changed_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_tenant_plan_quota_tenant_id" PRIMARY KEY ("tenant_id"),
        CONSTRAINT "CHK_tenant_plan_quota_non_negative" CHECK ("quota_products" >= 0 AND "quota_storage_mb" >= 0)
      )
    `);
    await enableTenantRlsPolicy(queryRunner, table);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'tenant_plan_quota')}`,
    );
  }
}
