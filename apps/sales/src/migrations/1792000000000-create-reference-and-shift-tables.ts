import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data (channels, shipping providers), registers, shifts and the
 * per-tenant readable-code counter (D4). Reference rows are seeded lazily per
 * tenant on first read, so this migration inserts no data.
 */
export class CreateReferenceAndShiftTables1792000000000
  implements MigrationInterface
{
  name = 'CreateReferenceAndShiftTables1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const channels = qualifiedTable(queryRunner, 'sales_channel');
    const providers = qualifiedTable(queryRunner, 'shipping_provider');
    const registers = qualifiedTable(queryRunner, 'register');
    const shifts = qualifiedTable(queryRunner, 'shift');
    const sequences = qualifiedTable(queryRunner, 'code_sequence');

    await queryRunner.query(`
      CREATE TABLE ${channels} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(30) NOT NULL,
        "type" character varying(30) NOT NULL,
        "name" character varying(100) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_channel_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sales_channel_tenant_code" ON ${channels} ("tenant_id", "code")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${providers} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(30) NOT NULL,
        "type" character varying(30) NOT NULL,
        "name" character varying(100) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shipping_provider_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shipping_provider_tenant_code" ON ${providers} ("tenant_id", "code")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${registers} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(100) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_register_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_register_status" CHECK ("status" IN ('active', 'inactive'))
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_register_tenant_code" ON ${registers} ("tenant_id", "code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_register_tenant_branch" ON ${registers} ("tenant_id", "branch_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${shifts} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "register_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'open',
        "opened_by" uuid NOT NULL,
        "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "opening_cash" bigint NOT NULL DEFAULT 0,
        "closed_by" uuid,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "closing_cash_expected" bigint,
        "closing_cash_actual" bigint,
        "difference" bigint,
        "note" text,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_shift_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_shift_register" FOREIGN KEY ("register_id") REFERENCES ${registers} ("id"),
        CONSTRAINT "CHK_shift_status" CHECK ("status" IN ('open', 'closed'))
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shift_tenant_code" ON ${shifts} ("tenant_id", "code")`,
    );
    // one open shift per register: the index decides when two requests race
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shift_open_register" ON ${shifts} ("tenant_id", "register_id") WHERE "status" = 'open'`,
    );

    await queryRunner.query(`
      CREATE TABLE ${sequences} (
        "tenant_id" uuid NOT NULL,
        "key" character varying(30) NOT NULL,
        "value" bigint NOT NULL,
        CONSTRAINT "PK_code_sequence" PRIMARY KEY ("tenant_id", "key")
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'code_sequence',
      'shift',
      'register',
      'shipping_provider',
      'sales_channel',
    ]) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
