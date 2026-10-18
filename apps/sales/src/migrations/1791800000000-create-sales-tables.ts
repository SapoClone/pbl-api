import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesTables1791800000000 implements MigrationInterface {
  name = 'CreateSalesTables1791800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const orders = qualifiedTable(queryRunner, 'orders');
    const items = qualifiedTable(queryRunner, 'order_items');
    const branches = qualifiedTable(queryRunner, 'branch_projection');

    await queryRunner.query(`
      CREATE TABLE ${orders} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(30) NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'completed',
        "payment_method" character varying(20) NOT NULL,
        "customer_name" character varying(150),
        "total_amount" bigint NOT NULL,
        "item_count" integer NOT NULL,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_orders_tenant_code" ON ${orders} ("tenant_id", "code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_tenant_created" ON ${orders} ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${items} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "sku" character varying(64) NOT NULL,
        "name" character varying(200) NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price" bigint NOT NULL,
        "line_total" bigint NOT NULL,
        CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES ${orders} ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_items_tenant_order" ON ${items} ("tenant_id", "order_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${branches} (
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
      `CREATE INDEX "IDX_branch_projection_tenant" ON ${branches} ("tenant_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'branch_projection')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'order_items')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'orders')}`,
    );
  }
}
