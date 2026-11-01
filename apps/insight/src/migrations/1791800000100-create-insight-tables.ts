import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInsightTables1791800000100 implements MigrationInterface {
  name = 'CreateInsightTables1791800000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const audit = qualifiedTable(queryRunner, 'audit_log');

    await queryRunner.query(`
      CREATE TABLE ${audit} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "type" character varying(150) NOT NULL,
        "actor_id" uuid,
        "summary" character varying(300) NOT NULL,
        "data" jsonb NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_tenant_occurred" ON ${audit} ("tenant_id", "occurred_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'audit_log')}`,
    );
  }
}
