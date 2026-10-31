import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerTables1792000000000 implements MigrationInterface {
  name = 'CreateCustomerTables1792000000000';

  async up(q: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(q, name);

    await q.query(`
      CREATE TABLE ${t('code_sequence')} (
        "tenant_id" uuid NOT NULL,
        "key" character varying(30) NOT NULL,
        "value" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_code_sequence" PRIMARY KEY ("tenant_id", "key")
      )`);

    await q.query(`
      CREATE TABLE ${t('customer_group')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(40) NOT NULL,
        "name" character varying(100) NOT NULL,
        "is_seeded" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_group_id" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_group_tenant_code" ON ${t('customer_group')} ("tenant_id", "code")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_group_tenant_name" ON ${t('customer_group')} ("tenant_id", lower("name"))`,
    );

    await q.query(`
      CREATE TABLE ${t('customer')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "member_code" character varying(20),
        "group_id" uuid,
        "name" character varying(150) NOT NULL,
        "phone" character varying(20) NOT NULL,
        "email" character varying(150),
        "gender" character varying(10),
        "dob" date,
        "source" character varying(20) NOT NULL DEFAULT 'store',
        "note" text,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "order_count" integer NOT NULL DEFAULT 0,
        "total_spent" bigint NOT NULL DEFAULT 0,
        "last_purchase_at" TIMESTAMP WITH TIME ZONE,
        "points_balance" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_customer_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_group" FOREIGN KEY ("group_id") REFERENCES ${t('customer_group')} ("id"),
        -- the last line of defence: whatever the code does, points cannot go below zero
        CONSTRAINT "CHK_customer_points_balance" CHECK ("points_balance" >= 0),
        CONSTRAINT "CHK_customer_status" CHECK ("status" IN ('active', 'inactive'))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_tenant_code" ON ${t('customer')} ("tenant_id", "code")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_tenant_phone" ON ${t('customer')} ("tenant_id", "phone") WHERE "deleted_at" IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_tenant_member_code" ON ${t('customer')} ("tenant_id", "member_code") WHERE "member_code" IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_customer_tenant_group" ON ${t('customer')} ("tenant_id", "group_id") WHERE "deleted_at" IS NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_customer_tenant_created" ON ${t('customer')} ("tenant_id", "created_at") WHERE "deleted_at" IS NULL`,
    );

    await q.query(`
      CREATE TABLE ${t('customer_tag')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" character varying(60) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_tag_id" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_tag_tenant_name" ON ${t('customer_tag')} ("tenant_id", lower("name"))`,
    );

    await q.query(`
      CREATE TABLE ${t('customer_tag_link')} (
        "customer_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        CONSTRAINT "PK_customer_tag_link" PRIMARY KEY ("customer_id", "tag_id"),
        CONSTRAINT "FK_customer_tag_link_customer" FOREIGN KEY ("customer_id") REFERENCES ${t('customer')} ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_tag_link_tag" FOREIGN KEY ("tag_id") REFERENCES ${t('customer_tag')} ("id") ON DELETE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_customer_tag_link_tag" ON ${t('customer_tag_link')} ("tag_id")`,
    );

    await q.query(`
      CREATE TABLE ${t('customer_address')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "recipient_name" character varying(150) NOT NULL,
        "phone" character varying(20) NOT NULL,
        "address_line" character varying(255) NOT NULL,
        "ward" character varying(100) NOT NULL,
        "district" character varying(100) NOT NULL,
        "province" character varying(100) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_address_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_address_customer" FOREIGN KEY ("customer_id") REFERENCES ${t('customer')} ("id") ON DELETE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_customer_address_customer" ON ${t('customer_address')} ("customer_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_customer_address_default" ON ${t('customer_address')} ("customer_id") WHERE "is_default"`,
    );

    await q.query(`
      CREATE TABLE ${t('loyalty_transaction')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "type" character varying(10) NOT NULL,
        "points" integer NOT NULL,
        "balance_after" integer NOT NULL,
        "ref_type" character varying(20),
        "ref_id" uuid,
        "ref_code" character varying(30),
        "note" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_transaction_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_loyalty_transaction_customer" FOREIGN KEY ("customer_id") REFERENCES ${t('customer')} ("id"),
        CONSTRAINT "CHK_loyalty_transaction_type" CHECK ("type" IN ('earn', 'redeem', 'adjust')),
        CONSTRAINT "CHK_loyalty_transaction_balance" CHECK ("balance_after" >= 0)
      )`);
    await q.query(
      `CREATE INDEX "IDX_loyalty_transaction_customer" ON ${t('loyalty_transaction')} ("tenant_id", "customer_id", "created_at")`,
    );
    // an order earns once, whatever the delivery
    await q.query(
      `CREATE UNIQUE INDEX "UQ_loyalty_transaction_ref" ON ${t('loyalty_transaction')} ("tenant_id", "type", "ref_type", "ref_id") WHERE "ref_id" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE ${t('loyalty_setting')} (
        "tenant_id" uuid NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "amount_per_point" bigint NOT NULL DEFAULT 10000,
        "redeem_value_per_point" integer NOT NULL DEFAULT 1000,
        "points_expire_months" integer,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_setting_tenant" PRIMARY KEY ("tenant_id"),
        CONSTRAINT "CHK_loyalty_setting_amount" CHECK ("amount_per_point" >= 1)
      )`);
  }

  async down(q: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(q, name);
    for (const table of [
      'loyalty_setting',
      'loyalty_transaction',
      'customer_address',
      'customer_tag_link',
      'customer_tag',
      'customer',
      'customer_group',
      'code_sequence',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${t(table)}`);
    }
  }
}
