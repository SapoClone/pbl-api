import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Announcements written by platform admins, and one recipient row per store they reached. Platform tables, not
 * row-level-security ones: they hold ids and the admin's text, never store data, and only the platform-admin
 * routes and the send job touch them. What a store sees is a row of `notification` (RLS, the store's own bell).
 */
export class CreateAnnouncements1792100000200 implements MigrationInterface {
  name = 'CreateAnnouncements1792100000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const announcement = qualifiedTable(queryRunner, 'announcement');
    const recipient = qualifiedTable(queryRunner, 'announcement_recipient');

    await queryRunner.query(`
      CREATE TABLE ${announcement} (
        "id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "content" text NOT NULL,
        "type" character varying(20) NOT NULL,
        "audience" jsonb NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "scheduled_at" TIMESTAMP WITH TIME ZONE,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "recipient_count" integer NOT NULL DEFAULT 0,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_announcement_type" CHECK ("type" IN ('maintenance', 'update', 'guide')),
        CONSTRAINT "CHK_announcement_status" CHECK ("status" IN ('draft', 'scheduled', 'sent'))
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_status_created" ON ${announcement} ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcement_due" ON ${announcement} ("scheduled_at") WHERE "status" = 'scheduled'`,
    );

    // `id` is also the id of the store's `notification` row, so a retry can never write a second one
    await queryRunner.query(`
      CREATE TABLE ${recipient} (
        "id" uuid NOT NULL,
        "announcement_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcement_recipient_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_announcement_recipient_announcement_tenant" UNIQUE ("announcement_id", "tenant_id"),
        CONSTRAINT "FK_announcement_recipient_announcement" FOREIGN KEY ("announcement_id")
          REFERENCES ${announcement} ("id") ON DELETE CASCADE
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'announcement_recipient')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'announcement')}`,
    );
  }
}
