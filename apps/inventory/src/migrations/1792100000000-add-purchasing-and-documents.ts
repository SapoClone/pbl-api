import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First-wave additions: per-tenant code counters, stock thresholds, suppliers,
 * purchase orders and their payments, stock transfers, stock takes and stock issues.
 */
export class AddPurchasingAndDocuments1792100000000
  implements MigrationInterface
{
  name = 'AddPurchasingAndDocuments1792100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const q = (sql: string) => queryRunner.query(sql);
    const stamps = `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`;

    await q(`
      CREATE TABLE ${t('code_sequence')} (
        "tenant_id" uuid NOT NULL,
        "key" character varying(30) NOT NULL,
        "value" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_code_sequence" PRIMARY KEY ("tenant_id", "key")
      )`);

    await q(`
      CREATE TABLE ${t('stock_threshold')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "sku" character varying(64) NOT NULL,
        "variant_id" uuid,
        "min_quantity" integer,
        "max_quantity" integer,
        ${stamps},
        CONSTRAINT "PK_stock_threshold_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_threshold_range" CHECK (
          ("min_quantity" IS NULL OR "min_quantity" >= 0)
          AND ("max_quantity" IS NULL OR "max_quantity" >= 0)
          AND ("min_quantity" IS NULL OR "max_quantity" IS NULL OR "max_quantity" >= "min_quantity"))
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_threshold_tenant_branch_sku" ON ${t('stock_threshold')} ("tenant_id", "branch_id", "sku")`,
    );

    await q(`
      CREATE TABLE ${t('supplier')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(200) NOT NULL,
        "phone" character varying(30),
        "email" character varying(200),
        "address" character varying(500),
        "tax_code" character varying(30),
        "note" text,
        "debt_balance" bigint NOT NULL DEFAULT 0,
        "total_paid" bigint NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        ${stamps},
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_supplier_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_debt" CHECK ("debt_balance" >= 0)
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_supplier_tenant_code" ON ${t('supplier')} ("tenant_id", "code") WHERE "deleted_at" IS NULL`,
    );
    await q(
      `CREATE UNIQUE INDEX "UQ_supplier_tenant_phone" ON ${t('supplier')} ("tenant_id", "phone") WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL`,
    );

    await q(`
      CREATE TABLE ${t('purchase_order')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(30) NOT NULL,
        "expected_date" date,
        "note_to_supplier" text,
        "payment_term_days" integer,
        "deposit_amount" bigint NOT NULL DEFAULT 0,
        "subtotal" bigint NOT NULL DEFAULT 0,
        "vat_amount" bigint NOT NULL DEFAULT 0,
        "total_amount" bigint NOT NULL DEFAULT 0,
        "paid_amount" bigint NOT NULL DEFAULT 0,
        "cancel_reason" text,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        ${stamps},
        CONSTRAINT "PK_purchase_order_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_order_supplier" FOREIGN KEY ("supplier_id") REFERENCES ${t('supplier')} ("id"),
        CONSTRAINT "CHK_purchase_order_status" CHECK ("status" IN ('draft','pending_approval','approved','partially_received','received','cancelled')),
        CONSTRAINT "CHK_purchase_order_paid" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount")
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_purchase_order_tenant_code" ON ${t('purchase_order')} ("tenant_id", "code")`,
    );
    await q(
      `CREATE INDEX "IDX_purchase_order_tenant_status" ON ${t('purchase_order')} ("tenant_id", "status", "created_at")`,
    );
    await q(
      `CREATE INDEX "IDX_purchase_order_supplier" ON ${t('purchase_order')} ("supplier_id")`,
    );

    await q(`
      CREATE TABLE ${t('purchase_order_line')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "purchase_order_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "variant_id" uuid,
        "sku" character varying(64) NOT NULL,
        "name" character varying(200) NOT NULL,
        "unit_name" character varying(30),
        "quantity_ordered" integer NOT NULL,
        "quantity_received" integer NOT NULL DEFAULT 0,
        "unit_cost" bigint NOT NULL,
        "vat_rate" integer NOT NULL DEFAULT 0,
        "line_subtotal" bigint NOT NULL,
        "vat_amount" bigint NOT NULL,
        CONSTRAINT "PK_purchase_order_line_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_order_line_order" FOREIGN KEY ("purchase_order_id") REFERENCES ${t('purchase_order')} ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_purchase_order_line_quantity" CHECK ("quantity_ordered" > 0 AND "quantity_received" >= 0)
      )`);
    await q(
      `CREATE INDEX "IDX_purchase_order_line_order" ON ${t('purchase_order_line')} ("purchase_order_id")`,
    );

    await q(`
      CREATE TABLE ${t('supplier_payment')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "purchase_order_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "method" character varying(20) NOT NULL,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_payment_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplier_payment_order" FOREIGN KEY ("purchase_order_id") REFERENCES ${t('purchase_order')} ("id"),
        CONSTRAINT "CHK_supplier_payment_amount" CHECK ("amount" > 0)
      )`);
    await q(
      `CREATE INDEX "IDX_supplier_payment_order" ON ${t('supplier_payment')} ("purchase_order_id")`,
    );

    // stock documents share one shape: a header and lines keyed by SKU
    await q(`
      CREATE TABLE ${t('stock_transfer')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "from_branch_id" uuid NOT NULL,
        "to_branch_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL,
        "note" text,
        "shipped_at" TIMESTAMP WITH TIME ZONE,
        "received_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        ${stamps},
        CONSTRAINT "PK_stock_transfer_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_transfer_status" CHECK ("status" IN ('draft','in_transit','received','cancelled')),
        CONSTRAINT "CHK_stock_transfer_branches" CHECK ("from_branch_id" <> "to_branch_id")
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_transfer_tenant_code" ON ${t('stock_transfer')} ("tenant_id", "code")`,
    );
    await q(`
      CREATE TABLE ${t('stock_transfer_line')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "stock_transfer_id" uuid NOT NULL,
        "variant_id" uuid,
        "sku" character varying(64) NOT NULL,
        "quantity" integer NOT NULL,
        "received_quantity" integer,
        CONSTRAINT "PK_stock_transfer_line_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_transfer_line_transfer" FOREIGN KEY ("stock_transfer_id") REFERENCES ${t('stock_transfer')} ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_stock_transfer_line_quantity" CHECK ("quantity" > 0)
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_transfer_line_sku" ON ${t('stock_transfer_line')} ("stock_transfer_id", "sku")`,
    );

    await q(`
      CREATE TABLE ${t('stock_take')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "branch_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL,
        "note" text,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        ${stamps},
        CONSTRAINT "PK_stock_take_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_take_status" CHECK ("status" IN ('in_progress','completed','cancelled'))
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_take_tenant_code" ON ${t('stock_take')} ("tenant_id", "code")`,
    );
    await q(`
      CREATE TABLE ${t('stock_take_line')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "stock_take_id" uuid NOT NULL,
        "variant_id" uuid,
        "sku" character varying(64) NOT NULL,
        "system_quantity" integer NOT NULL,
        "counted_quantity" integer,
        "reason" text,
        CONSTRAINT "PK_stock_take_line_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_take_line_take" FOREIGN KEY ("stock_take_id") REFERENCES ${t('stock_take')} ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_stock_take_line_counted" CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0)
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_take_line_sku" ON ${t('stock_take_line')} ("stock_take_id", "sku")`,
    );

    await q(`
      CREATE TABLE ${t('stock_issue')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "branch_id" uuid NOT NULL,
        "reason" character varying(30) NOT NULL,
        "supplier_id" uuid,
        "note" text,
        "status" character varying(20) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        ${stamps},
        CONSTRAINT "PK_stock_issue_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_issue_status" CHECK ("status" IN ('draft','approved','cancelled')),
        CONSTRAINT "CHK_stock_issue_reason" CHECK ("reason" IN ('damaged','internal_use','return_to_supplier','other'))
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_issue_tenant_code" ON ${t('stock_issue')} ("tenant_id", "code")`,
    );
    await q(`
      CREATE TABLE ${t('stock_issue_line')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "stock_issue_id" uuid NOT NULL,
        "variant_id" uuid,
        "sku" character varying(64) NOT NULL,
        "quantity" integer NOT NULL,
        CONSTRAINT "PK_stock_issue_line_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stock_issue_line_issue" FOREIGN KEY ("stock_issue_id") REFERENCES ${t('stock_issue')} ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_stock_issue_line_quantity" CHECK ("quantity" > 0)
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_stock_issue_line_sku" ON ${t('stock_issue_line')} ("stock_issue_id", "sku")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'stock_issue_line',
      'stock_issue',
      'stock_take_line',
      'stock_take',
      'stock_transfer_line',
      'stock_transfer',
      'supplier_payment',
      'purchase_order_line',
      'purchase_order',
      'supplier',
      'stock_threshold',
      'code_sequence',
    ]) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
