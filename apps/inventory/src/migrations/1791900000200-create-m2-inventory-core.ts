import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateM2InventoryCore1791900000200 implements MigrationInterface {
  name = 'CreateM2InventoryCore1791900000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    const warehouse = t('warehouse');
    const balance = t('stock_balance');
    const reservation = t('warehouse_reservation');
    const ledger = t('stock_balance_ledger');
    const skuProjection = t('catalog_sku_projection');
    const threshold = t('stock_threshold');
    const supplier = t('supplier');
    const po = t('purchase_order');
    const poItem = t('purchase_order_item');
    const receipt = t('stock_receipt');
    const receiptItem = t('stock_receipt_item');
    const issue = t('stock_issue');
    const issueItem = t('stock_issue_item');
    const transfer = t('stock_transfer');
    const transferItem = t('stock_transfer_item');
    const stocktake = t('stock_take');
    const stocktakeItem = t('stock_take_item');

    // 1. Extend warehouse with kind, address, nullable branch_id, and composite tenant unique key
    await queryRunner.query(`
      ALTER TABLE ${warehouse}
        ALTER COLUMN "branch_id" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "kind" character varying(16) NOT NULL DEFAULT 'BRANCH',
        ADD COLUMN IF NOT EXISTS "address" text NULL,
        ADD CONSTRAINT "UQ_warehouse_tenant_id" UNIQUE ("tenant_id", "id"),
        ADD CONSTRAINT "CHK_warehouse_kind" CHECK ("kind" IN ('BRANCH', 'CENTRAL', 'QUARANTINE')),
        ADD CONSTRAINT "CHK_warehouse_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
    `);

    // 2. Extend stock_balance with weighted-average cost & valuation columns + composite FK to warehouse
    await queryRunner.query(`
      ALTER TABLE ${balance}
        ADD COLUMN IF NOT EXISTS "avg_unit_cost" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "valuation_amount" bigint NOT NULL DEFAULT 0,
        ADD CONSTRAINT "CHK_stock_balance_valuation_non_negative" CHECK (
          "avg_unit_cost" >= 0 AND "valuation_amount" >= 0
        ),
        ADD CONSTRAINT "FK_stock_balance_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
    `);

    // 3. Extend warehouse_reservation with optional reason & note + lookup index by source_ref
    await queryRunner.query(`
      ALTER TABLE ${reservation}
        ADD COLUMN IF NOT EXISTS "release_reason" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "fulfillment_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "note" character varying(300) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_warehouse_reservation_source_ref"
      ON ${reservation} ("tenant_id", "source_ref_type", "source_ref_id")
    `);

    // 4. Extend stock_balance_ledger with audit & valuation columns
    await queryRunner.query(`
      ALTER TABLE ${ledger}
        ADD COLUMN IF NOT EXISTS "qty_before" numeric(18,3) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "unit_cost" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "avg_cost_after" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "actor_id" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "correlation_id" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "reason" character varying(255) NULL,
        ADD COLUMN IF NOT EXISTS "reversal_of_ledger_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stock_balance_ledger_reference"
      ON ${ledger} ("tenant_id", "reference_type", "reference_id")
    `);

    // 5. Catalog SKU Projection table (populated from Catalog events)
    await queryRunner.query(`
      CREATE TABLE ${skuProjection} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "sku_code" character varying(64) NOT NULL,
        "name" character varying(255) NOT NULL,
        "base_unit" character varying(32) NOT NULL DEFAULT 'PCS',
        "barcode" character varying(64) NULL,
        "base_price" bigint NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "aggregate_version" integer NOT NULL DEFAULT 1,
        "source_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_sku_projection_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_sku_projection_tenant_sku" UNIQUE ("tenant_id", "sku_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalog_sku_projection_tenant_code"
      ON ${skuProjection} ("tenant_id", "sku_code")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalog_sku_projection_tenant_barcode"
      ON ${skuProjection} ("tenant_id", "barcode")
      WHERE "barcode" IS NOT NULL
    `);

    // 6. Stock Threshold table
    await queryRunner.query(`
      CREATE TABLE ${threshold} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "min_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "max_qty" numeric(18,3) NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_threshold_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_threshold_tenant_wh_sku" UNIQUE ("tenant_id", "warehouse_id", "sku_id"),
        CONSTRAINT "CHK_stock_threshold_quantities" CHECK (
          "min_qty" >= 0 AND ("max_qty" IS NULL OR "max_qty" >= "min_qty")
        ),
        CONSTRAINT "FK_stock_threshold_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 7. Supplier table
    await queryRunner.query(`
      CREATE TABLE ${supplier} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(160) NOT NULL,
        "phone" character varying(32) NULL,
        "email" character varying(160) NULL,
        "address" text NULL,
        "tax_code" character varying(32) NULL,
        "note" text NULL,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "deleted_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supplier_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_supplier_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_supplier_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
      )
    `);

    // 8. Purchase Order & Purchase Order Item tables
    await queryRunner.query(`
      CREATE TABLE ${po} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'DRAFT',
        "total_amount" bigint NOT NULL DEFAULT 0,
        "expected_date" date NULL,
        "note" text NULL,
        "approved_by" character varying(64) NULL,
        "approved_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_order_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_purchase_order_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_purchase_order_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_purchase_order_status" CHECK (
          "status" IN ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')
        ),
        CONSTRAINT "FK_purchase_order_supplier"
          FOREIGN KEY ("tenant_id", "supplier_id")
          REFERENCES ${supplier}("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_purchase_order_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_purchase_order_tenant_status"
      ON ${po} ("tenant_id", "status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE ${poItem} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "purchase_order_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "sku_id" uuid NOT NULL,
        "ordered_qty" numeric(18,3) NOT NULL,
        "received_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "unit_cost" bigint NOT NULL DEFAULT 0,
        "unit_name" character varying(32) NOT NULL DEFAULT 'PCS',
        "conversion_factor" numeric(18,4) NOT NULL DEFAULT 1,
        CONSTRAINT "PK_purchase_order_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_purchase_order_item_sku" UNIQUE ("tenant_id", "purchase_order_id", "sku_id"),
        CONSTRAINT "CHK_purchase_order_item_qty" CHECK (
          "ordered_qty" > 0 AND "received_qty" >= 0 AND "received_qty" <= "ordered_qty"
          AND "unit_cost" >= 0 AND "conversion_factor" > 0
        ),
        CONSTRAINT "FK_purchase_order_item_po"
          FOREIGN KEY ("tenant_id", "purchase_order_id")
          REFERENCES ${po}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 9. Stock Receipt & Stock Receipt Item tables
    await queryRunner.query(`
      CREATE TABLE ${receipt} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "source_type" character varying(24) NOT NULL DEFAULT 'MANUAL',
        "purchase_order_id" uuid NULL,
        "supplier_id" uuid NULL,
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "idempotency_key" character varying(128) NULL,
        "note" text NULL,
        "reject_reason" text NULL,
        "posted_by" character varying(64) NULL,
        "posted_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_receipt_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_receipt_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_stock_receipt_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_stock_receipt_status" CHECK (
          "status" IN ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED')
        ),
        CONSTRAINT "CHK_stock_receipt_source" CHECK (
          "source_type" IN ('MANUAL', 'PURCHASE_ORDER', 'RETURN', 'ADJUSTMENT')
        ),
        CONSTRAINT "FK_stock_receipt_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stock_receipt_idempotency"
      ON ${receipt} ("tenant_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE ${receiptItem} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "receipt_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "sku_id" uuid NOT NULL,
        "qty" numeric(18,3) NOT NULL,
        "unit_cost" bigint NOT NULL DEFAULT 0,
        "unit_name" character varying(32) NOT NULL DEFAULT 'PCS',
        "conversion_factor" numeric(18,4) NOT NULL DEFAULT 1,
        CONSTRAINT "PK_stock_receipt_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_receipt_item_line" UNIQUE ("tenant_id", "receipt_id", "line_no"),
        CONSTRAINT "CHK_stock_receipt_item_qty" CHECK (
          "qty" > 0 AND "unit_cost" >= 0 AND "conversion_factor" > 0
        ),
        CONSTRAINT "FK_stock_receipt_item_receipt"
          FOREIGN KEY ("tenant_id", "receipt_id")
          REFERENCES ${receipt}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 10. Stock Issue & Stock Issue Item tables
    await queryRunner.query(`
      CREATE TABLE ${issue} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "reason_code" character varying(32) NOT NULL DEFAULT 'MANUAL_WITHDRAWAL',
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "idempotency_key" character varying(128) NULL,
        "note" text NULL,
        "posted_by" character varying(64) NULL,
        "posted_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_issue_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_issue_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_stock_issue_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_stock_issue_status" CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
        CONSTRAINT "CHK_stock_issue_reason" CHECK (
          "reason_code" IN ('MANUAL_WITHDRAWAL', 'DAMAGED', 'DISPOSAL', 'SAMPLE', 'SUPPLIER_RETURN')
        ),
        CONSTRAINT "FK_stock_issue_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stock_issue_idempotency"
      ON ${issue} ("tenant_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE ${issueItem} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "issue_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "sku_id" uuid NOT NULL,
        "qty" numeric(18,3) NOT NULL,
        "unit_cost" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_stock_issue_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_issue_item_line" UNIQUE ("tenant_id", "issue_id", "line_no"),
        CONSTRAINT "CHK_stock_issue_item_qty" CHECK ("qty" > 0 AND "unit_cost" >= 0),
        CONSTRAINT "FK_stock_issue_item_issue"
          FOREIGN KEY ("tenant_id", "issue_id")
          REFERENCES ${issue}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 11. Stock Transfer & Stock Transfer Item tables
    await queryRunner.query(`
      CREATE TABLE ${transfer} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "from_warehouse_id" uuid NOT NULL,
        "to_warehouse_id" uuid NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'DRAFT',
        "note" text NULL,
        "dispatched_by" character varying(64) NULL,
        "dispatched_at" TIMESTAMPTZ NULL,
        "received_by" character varying(64) NULL,
        "received_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_transfer_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_transfer_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_stock_transfer_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_stock_transfer_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id"),
        CONSTRAINT "CHK_stock_transfer_status" CHECK (
          "status" IN ('DRAFT', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'DISCREPANCY', 'CANCELLED')
        ),
        CONSTRAINT "FK_stock_transfer_from_wh"
          FOREIGN KEY ("tenant_id", "from_warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_transfer_to_wh"
          FOREIGN KEY ("tenant_id", "to_warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_transfer_tenant_status"
      ON ${transfer} ("tenant_id", "status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE ${transferItem} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "transfer_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "sku_id" uuid NOT NULL,
        "transfer_qty" numeric(18,3) NOT NULL,
        "dispatched_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "received_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "discrepancy_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "unit_cost" bigint NOT NULL DEFAULT 0,
        "discrepancy_reason" text NULL,
        CONSTRAINT "PK_stock_transfer_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_transfer_item_sku" UNIQUE ("tenant_id", "transfer_id", "sku_id"),
        CONSTRAINT "CHK_stock_transfer_item_qty" CHECK (
          "transfer_qty" > 0
          AND "dispatched_qty" >= 0
          AND "received_qty" >= 0
          AND "discrepancy_qty" >= 0
          AND ("received_qty" + "discrepancy_qty") <= "dispatched_qty"
          AND "unit_cost" >= 0
        ),
        CONSTRAINT "FK_stock_transfer_item_transfer"
          FOREIGN KEY ("tenant_id", "transfer_id")
          REFERENCES ${transfer}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 12. Stock Take & Stock Take Item tables
    await queryRunner.query(`
      CREATE TABLE ${stocktake} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "freeze_movement" boolean NOT NULL DEFAULT false,
        "note" text NULL,
        "approved_by" character varying(64) NULL,
        "approved_at" TIMESTAMPTZ NULL,
        "created_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_take_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_take_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_stock_take_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_stock_take_status" CHECK (
          "status" IN ('DRAFT', 'COUNTING', 'APPROVED', 'CANCELLED')
        ),
        CONSTRAINT "FK_stock_take_warehouse"
          FOREIGN KEY ("tenant_id", "warehouse_id")
          REFERENCES ${warehouse}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${stocktakeItem} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "stock_take_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "sku_id" uuid NOT NULL,
        "snapshot_on_hand_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "snapshot_reserved_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "snapshot_version" bigint NOT NULL DEFAULT 0,
        "counted_qty" numeric(18,3) NULL,
        "variance_qty" numeric(18,3) NULL,
        "reason" text NULL,
        CONSTRAINT "PK_stock_take_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_take_item_sku" UNIQUE ("tenant_id", "stock_take_id", "sku_id"),
        CONSTRAINT "CHK_stock_take_item_counted" CHECK (
          "counted_qty" IS NULL OR "counted_qty" >= 0
        ),
        CONSTRAINT "FK_stock_take_item_stocktake"
          FOREIGN KEY ("tenant_id", "stock_take_id")
          REFERENCES ${stocktake}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 13. Enable & Force PostgreSQL Row-Level Security on all new M2 tables + legacy tables
    for (const table of [
      skuProjection,
      threshold,
      supplier,
      po,
      poItem,
      receipt,
      receiptItem,
      issue,
      issueItem,
      transfer,
      transferItem,
      stocktake,
      stocktakeItem,
    ]) {
      await enableTenantRlsPolicy(queryRunner, table);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    for (const name of [
      'stock_take_item',
      'stock_take',
      'stock_transfer_item',
      'stock_transfer',
      'stock_issue_item',
      'stock_issue',
      'stock_receipt_item',
      'stock_receipt',
      'purchase_order_item',
      'purchase_order',
      'supplier',
      'stock_threshold',
      'catalog_sku_projection',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t(name)} CASCADE`);
    }
  }
}
