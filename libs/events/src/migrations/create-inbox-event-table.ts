import { MigrationInterface, QueryRunner } from 'typeorm';
import { qualifiedTable } from './table-name';

export class CreateInboxEventTable1791700000001 implements MigrationInterface {
  name = 'CreateInboxEventTable1791700000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${qualifiedTable(queryRunner, 'inbox_event')} (
        "event_id" uuid NOT NULL,
        "type" character varying(150) NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inbox_event_id" PRIMARY KEY ("event_id")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'inbox_event')}`,
    );
  }
}
