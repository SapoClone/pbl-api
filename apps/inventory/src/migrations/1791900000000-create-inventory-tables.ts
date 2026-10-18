import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryTables1791900000000 implements MigrationInterface {
  name = 'CreateInventoryTables1791900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    await queryRunner.query(`
      CREATE TABLE ${t('stock_item')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "sku" character varying(64) NOT NULL,
        "quantity_on_hand" integer NOT NULL DEFAULT 0,
        "quantity_reserved" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_item_id" PRIMARY KEY ("id"),
        -- the last line of defence: whatever the code does, stock cannot go below
        -- zero and a hold cannot exceed what is on hand
        CONSTRAINT "CHK_stock_item_quantities"
          CHECK ("quantity_reserved" >= 0 AND "quantity_on_hand" >= "quantity_reserved")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_item_tenant_branch_sku" ON ${t('stock_item')} ("tenant_id", "branch_id", "sku")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${t('stock_reservation')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_reservation_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_reservation_tenant_order" ON ${t('stock_reservation')} ("tenant_id", "order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_reservation_due" ON ${t('stock_reservation')} ("expires_at") WHERE "status" = 'held'`,
    );

    await queryRunner.query(`
      CREATE TABLE ${t('stock_reservation_item')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "reservation_id" uuid NOT NULL,
        "sku" character varying(64) NOT NULL,
        "quantity" integer NOT NULL,
        CONSTRAINT "PK_stock_reservation_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_reservation_item_reservation" FOREIGN KEY ("reservation_id")
          REFERENCES ${t('stock_reservation')} ("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_reservation_item_reservation" ON ${t('stock_reservation_item')} ("reservation_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${t('inventory_ledger')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "sku" character varying(64) NOT NULL,
        "change_qty" integer NOT NULL,
        "balance_after" integer NOT NULL,
        "ref_type" character varying(20) NOT NULL,
        "ref_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_ledger_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_ledger_tenant_branch_sku" ON ${t('inventory_ledger')} ("tenant_id", "branch_id", "sku", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${t('branch_projection')} (
        "branch_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(150) NOT NULL,
        "is_warehouse" boolean NOT NULL,
        "status" character varying(20) NOT NULL,
        "source_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "synced_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branch_projection_branch_id" PRIMARY KEY ("branch_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_branch_projection_tenant" ON ${t('branch_projection')} ("tenant_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'branch_projection',
      'inventory_ledger',
      'stock_reservation_item',
      'stock_reservation',
      'stock_item',
    ]) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
