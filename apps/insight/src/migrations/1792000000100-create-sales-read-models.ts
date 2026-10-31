import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Hourly, per-product and per-customer counters fed by `sales.order.completed` */
export class CreateSalesReadModels1792000000100 implements MigrationInterface {
  name = 'CreateSalesReadModels1792000000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const hourly = qualifiedTable(queryRunner, 'hourly_sales');
    const product = qualifiedTable(queryRunner, 'product_sales_daily');
    const customer = qualifiedTable(queryRunner, 'customer_sales_daily');

    await queryRunner.query(`
      CREATE TABLE ${hourly} (
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "channel" character varying(30) NOT NULL,
        "sales_date" date NOT NULL,
        "hour" smallint NOT NULL,
        "order_count" integer NOT NULL DEFAULT 0,
        "revenue" bigint NOT NULL DEFAULT 0,
        "cost" bigint,
        "costed_revenue" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_hourly_sales" PRIMARY KEY ("tenant_id", "branch_id", "channel", "sales_date", "hour"),
        CONSTRAINT "CHK_hourly_sales_hour" CHECK ("hour" BETWEEN 0 AND 23)
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_hourly_sales_tenant_date" ON ${hourly} ("tenant_id", "sales_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${product} (
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "sales_date" date NOT NULL,
        "sku" character varying(100) NOT NULL,
        "name" character varying(300) NOT NULL,
        "quantity" bigint NOT NULL DEFAULT 0,
        "revenue" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_product_sales_daily" PRIMARY KEY ("tenant_id", "branch_id", "sales_date", "sku")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_product_sales_daily_tenant_date" ON ${product} ("tenant_id", "sales_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${customer} (
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "sales_date" date NOT NULL,
        "customer_id" uuid NOT NULL,
        "first_hour" smallint NOT NULL,
        CONSTRAINT "PK_customer_sales_daily" PRIMARY KEY ("tenant_id", "branch_id", "sales_date", "customer_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_customer_sales_daily_tenant_date" ON ${customer} ("tenant_id", "sales_date")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'customer_sales_daily',
      'product_sales_daily',
      'hourly_sales',
    ]) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
