import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ADMIN_READ_POLICY,
  ADMIN_READ_TABLES,
  adminReadPolicySql,
} from '../common/admin-read-context';

/**
 * Admin ("Tich hop") read path: a SELECT-only policy branch per RLS table that opens on the transaction-local
 * `app.admin_read`, and the `tenant_projection` / `branch_projection` tables (names of stores and branches, fed by
 * platform events). The projections hold platform data and no store-owned content, like `tenant_status`: no RLS.
 * Nothing is backfilled, so this needs no per-tenant binding.
 */
export class AddAdminReadAndProjections1793300000000
  implements MigrationInterface
{
  name = 'AddAdminReadAndProjections1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ADMIN_READ_TABLES) {
      await queryRunner.query(
        adminReadPolicySql(qualifiedTable(queryRunner, table)),
      );
    }
    await queryRunner.query(`
      CREATE TABLE ${qualifiedTable(queryRunner, 'tenant_projection')} (
        "tenant_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "source_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_tenant_projection_tenant_id" PRIMARY KEY ("tenant_id")
      )`);
    await queryRunner.query(`
      CREATE TABLE ${qualifiedTable(queryRunner, 'branch_projection')} (
        "branch_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "source_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_branch_projection_branch_id" PRIMARY KEY ("branch_id")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'branch_projection')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'tenant_projection')}`,
    );
    for (const table of ADMIN_READ_TABLES) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${ADMIN_READ_POLICY}" ON ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
