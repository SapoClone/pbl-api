import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** The store status and plan projection (D35): who is suspended, fed by platform's events. */
export class CreateTenantStatus1793100000410 implements MigrationInterface {
  name = 'CreateTenantStatus1793100000410';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${qualifiedTable(queryRunner, 'tenant_status')} (
        "tenant_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "plan_code" character varying(30) NULL,
        "status_changed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "plan_changed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_tenant_status_tenant_id" PRIMARY KEY ("tenant_id")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'tenant_status')}`,
    );
  }
}
