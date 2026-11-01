import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Insight filters by tenant in every query and never binds `app.tenant_id`, so the policy is not forced on the
 * owning role it connects as (forcing it made every read return nothing). Known gap: binding the tenant per
 * query would let this be forced like the other services.
 */
const ownerRls = (
  queryRunner: Parameters<typeof enableTenantRlsPolicy>[0],
  table: string,
) => enableTenantRlsPolicy(queryRunner, table, undefined, false);

export class CreateNotifications1792000000200 implements MigrationInterface {
  name = 'CreateNotifications1792000000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const notification = qualifiedTable(queryRunner, 'notification');
    const read = qualifiedTable(queryRunner, 'notification_read');
    const device = qualifiedTable(queryRunner, 'device_token');

    await queryRunner.query(`
      CREATE TABLE ${notification} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "type" character varying(50) NOT NULL,
        "title" character varying(300) NOT NULL,
        "body" text,
        "ref_type" character varying(50),
        "ref_id" character varying(100),
        "branch_id" uuid,
        "severity" character varying(20) NOT NULL DEFAULT 'info',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notification_severity" CHECK ("severity" IN ('info', 'warning', 'critical'))
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_tenant_created" ON ${notification} ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${read} (
        "notification_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_read" PRIMARY KEY ("notification_id", "account_id"),
        CONSTRAINT "FK_notification_read_notification" FOREIGN KEY ("notification_id")
          REFERENCES ${notification} ("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_read_account" ON ${read} ("account_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${device} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "token" character varying(512) NOT NULL,
        "platform" character varying(10) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_token_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_device_token_account_token" UNIQUE ("tenant_id", "account_id", "token"),
        CONSTRAINT "CHK_device_token_platform" CHECK ("platform" IN ('ios', 'android', 'web'))
      )`);

    await ownerRls(queryRunner, notification);
    await ownerRls(queryRunner, device);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['device_token', 'notification_read', 'notification']) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
