import { MigrationInterface, QueryRunner } from 'typeorm';
import { qualifiedTable } from './table-name';

export class CreateOutboxEventTable1791700000000 implements MigrationInterface {
  name = 'CreateOutboxEventTable1791700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'outbox_event');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "type" character varying(150) NOT NULL,
        "version" integer NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_error" text,
        "failed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_outbox_event_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_outbox_event_due" ON ${table} ("next_attempt_at")
      WHERE "published_at" IS NULL AND "failed_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'outbox_event')}`,
    );
  }
}
