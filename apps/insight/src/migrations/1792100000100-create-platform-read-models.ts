import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform-wide read models for the admin dashboard. They hold platform data (one row per store, one row per day),
 * not store data, so they are deliberately NOT row-level-security tables: only the platform-admin routes read them
 * and no store route has a controller on them.
 */
export class CreatePlatformReadModels1792100000100
  implements MigrationInterface
{
  name = 'CreatePlatformReadModels1792100000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tenant = qualifiedTable(queryRunner, 'tenant_projection');
    const daily = qualifiedTable(queryRunner, 'platform_daily_transactions');

    await queryRunner.query(`
      CREATE TABLE ${tenant} (
        "tenant_id" uuid NOT NULL,
        "code" character varying(50),
        "name" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "tenant_created_at" TIMESTAMP WITH TIME ZONE,
        "status_changed_at" TIMESTAMP WITH TIME ZONE,
        "subscription_id" uuid,
        "plan_code" character varying(50),
        "plan_name" character varying(255),
        "subscription_status" character varying(20),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "plan_changed_at" TIMESTAMP WITH TIME ZONE,
        "quota_branches" integer,
        "quota_products" integer,
        "quota_storage_mb" integer,
        "products_used" integer,
        "storage_mb_used" integer,
        "usage_measured_at" TIMESTAMP WITH TIME ZONE,
        "connections" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_projection_tenant_id" PRIMARY KEY ("tenant_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tenant_projection_status" ON ${tenant} ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tenant_projection_plan" ON ${tenant} ("plan_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tenant_projection_expires" ON ${tenant} ("expires_at") WHERE "expires_at" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE ${daily} (
        "date" date NOT NULL,
        "order_count" bigint NOT NULL DEFAULT 0,
        "revenue" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_daily_transactions_date" PRIMARY KEY ("date")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'platform_daily_transactions')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'tenant_projection')}`,
    );
  }
}
