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

export class CreateM7InsightCore1791900000300 implements MigrationInterface {
  name = 'CreateM7InsightCore1791900000300';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    const dimensionCaches = t('insight_dimension_caches');
    const orderFacts = t('sales_order_facts');
    const orderLineFacts = t('sales_order_line_facts');
    const returnFacts = t('sales_return_facts');
    const dailySummaries = t('daily_sales_summaries');
    const productSummaries = t('product_sales_summaries');
    const employeeSummaries = t('employee_sales_summaries');
    const channelSummaries = t('channel_sales_summaries');
    const customerGroupSummaries = t('customer_group_sales_summaries');
    const stockProjections = t('inventory_stock_projections');
    const valueSnapshots = t('inventory_value_snapshots');
    const movementProjections = t('inventory_movement_projections');
    const checkpoints = t('projection_checkpoints');
    const generations = t('projection_generations');
    const reconRuns = t('reconciliation_runs');
    const reconIssues = t('reconciliation_issues');
    const exportJobs = t('report_export_jobs');

    // Tenant RLS on the audit log (created by the earlier migration)
    await ownerRls(queryRunner, t('audit_log'));

    // 1. Insight Dimension Cache (Catalog, Customer, Branch metadata)
    await queryRunner.query(`
      CREATE TABLE ${dimensionCaches} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "dimension_type" character varying(32) NOT NULL,
        "entity_id" character varying(128) NOT NULL,
        "code" character varying(128) NOT NULL,
        "name" character varying(255) NOT NULL,
        "parent_id" character varying(128) NULL,
        "category_id" character varying(128) NULL,
        "brand_id" character varying(128) NULL,
        "customer_group_id" character varying(128) NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "aggregate_version" integer NOT NULL DEFAULT 1,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insight_dimension_caches_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insight_dimension_caches_tenant_type_entity" UNIQUE ("tenant_id", "dimension_type", "entity_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_insight_dim_cache_lookup" ON ${dimensionCaches} ("tenant_id", "dimension_type", "code")`,
    );
    await ownerRls(queryRunner, dimensionCaches);

    // 2. Sales Order Analytical Facts (with Contribution-Delta vector)
    await queryRunner.query(`
      CREATE TABLE ${orderFacts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "order_code" character varying(64) NOT NULL,
        "branch_id" uuid NOT NULL,
        "channel_type" character varying(32) NOT NULL DEFAULT 'POS',
        "customer_id" uuid NULL,
        "customer_group_id" character varying(64) NOT NULL DEFAULT 'WALK_IN',
        "seller_staff_id" character varying(128) NULL,
        "order_status" character varying(32) NOT NULL,
        "payment_status" character varying(32) NOT NULL DEFAULT 'UNPAID',
        "fulfillment_status" character varying(32) NOT NULL DEFAULT 'UNFULFILLED',
        "date_bucket" date NOT NULL,
        "subtotal" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "tax_total" bigint NOT NULL DEFAULT 0,
        "grand_total" bigint NOT NULL DEFAULT 0,
        "cogs_total" bigint NOT NULL DEFAULT 0,
        "units_total" numeric(18,4) NOT NULL DEFAULT 0,
        "cost_status" character varying(16) NOT NULL DEFAULT 'VERIFIED',
        "contributed_gmv" bigint NOT NULL DEFAULT 0,
        "contributed_gross_revenue" bigint NOT NULL DEFAULT 0,
        "contributed_discount" bigint NOT NULL DEFAULT 0,
        "contributed_net_revenue" bigint NOT NULL DEFAULT 0,
        "contributed_cogs" bigint NOT NULL DEFAULT 0,
        "contributed_units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "contributed_order_count" integer NOT NULL DEFAULT 0,
        "contributed_completed_count" integer NOT NULL DEFAULT 0,
        "contributed_cancelled_count" integer NOT NULL DEFAULT 0,
        "last_aggregate_version" integer NOT NULL DEFAULT 1,
        "last_event_id" uuid NULL,
        "raw_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_order_facts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_order_facts_tenant_order" UNIQUE ("tenant_id", "order_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_order_facts_tenant_date_branch" ON ${orderFacts} ("tenant_id", "date_bucket", "branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_order_facts_tenant_status_date" ON ${orderFacts} ("tenant_id", "order_status", "date_bucket")`,
    );
    await ownerRls(queryRunner, orderFacts);

    // 3. Sales Order Line Analytical Facts (Immutable Transaction-Time Cost Snapshots)
    await queryRunner.query(`
      CREATE TABLE ${orderLineFacts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "line_key" character varying(128) NOT NULL,
        "branch_id" uuid NOT NULL,
        "channel_type" character varying(32) NOT NULL DEFAULT 'POS',
        "customer_group_id" character varying(64) NOT NULL DEFAULT 'WALK_IN',
        "seller_staff_id" character varying(128) NULL,
        "date_bucket" date NOT NULL,
        "variant_id" character varying(128) NOT NULL,
        "product_id" character varying(128) NULL,
        "sku_code" character varying(128) NOT NULL,
        "product_name" character varying(255) NOT NULL,
        "category_id" character varying(128) NULL,
        "brand_id" character varying(128) NULL,
        "quantity" numeric(18,4) NOT NULL DEFAULT 0,
        "unit_price" bigint NOT NULL DEFAULT 0,
        "line_subtotal" bigint NOT NULL DEFAULT 0,
        "line_discount" bigint NOT NULL DEFAULT 0,
        "line_net_revenue" bigint NOT NULL DEFAULT 0,
        "unit_cost_snapshot" bigint NOT NULL DEFAULT 0,
        "cogs_amount" bigint NOT NULL DEFAULT 0,
        "gross_profit_amount" bigint NOT NULL DEFAULT 0,
        "cost_status" character varying(16) NOT NULL DEFAULT 'VERIFIED',
        "contributed_gross_revenue" bigint NOT NULL DEFAULT 0,
        "contributed_discount" bigint NOT NULL DEFAULT 0,
        "contributed_net_revenue" bigint NOT NULL DEFAULT 0,
        "contributed_cogs" bigint NOT NULL DEFAULT 0,
        "contributed_units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_order_line_facts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_order_line_facts_tenant_order_line" UNIQUE ("tenant_id", "order_id", "line_key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_order_line_facts_pending_cost" ON ${orderLineFacts} ("tenant_id", "cost_status", "sku_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_order_line_facts_date_sku" ON ${orderLineFacts} ("tenant_id", "date_bucket", "sku_code")`,
    );
    await ownerRls(queryRunner, orderLineFacts);

    // 4. Sales Return Analytical Facts
    await queryRunner.query(`
      CREATE TABLE ${returnFacts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "return_id" uuid NOT NULL,
        "return_code" character varying(64) NOT NULL,
        "order_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "channel_type" character varying(32) NOT NULL DEFAULT 'POS',
        "customer_id" uuid NULL,
        "customer_group_id" character varying(64) NOT NULL DEFAULT 'WALK_IN',
        "seller_staff_id" character varying(128) NULL,
        "date_bucket" date NOT NULL,
        "refund_amount" bigint NOT NULL DEFAULT 0,
        "returned_units" numeric(18,4) NOT NULL DEFAULT 0,
        "returned_cogs_amount" bigint NOT NULL DEFAULT 0,
        "restocked" boolean NOT NULL DEFAULT true,
        "return_lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_event_id" uuid NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_return_facts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_return_facts_tenant_return" UNIQUE ("tenant_id", "return_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_return_facts_date_branch" ON ${returnFacts} ("tenant_id", "date_bucket", "branch_id")`,
    );
    await ownerRls(queryRunner, returnFacts);

    // 5. Daily Sales Summaries (Generation-Scoped Analytical Rollup)
    await queryRunner.query(`
      CREATE TABLE ${dailySummaries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "date_bucket" date NOT NULL,
        "branch_id" uuid NOT NULL,
        "gmv" bigint NOT NULL DEFAULT 0,
        "gross_sales_revenue" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "returns_amount" bigint NOT NULL DEFAULT 0,
        "net_sales_revenue" bigint NOT NULL DEFAULT 0,
        "tax_total" bigint NOT NULL DEFAULT 0,
        "cogs_amount" bigint NOT NULL DEFAULT 0,
        "returned_cogs_amount" bigint NOT NULL DEFAULT 0,
        "net_cogs_amount" bigint NOT NULL DEFAULT 0,
        "gross_profit" bigint NOT NULL DEFAULT 0,
        "order_count" integer NOT NULL DEFAULT 0,
        "completed_order_count" integer NOT NULL DEFAULT 0,
        "cancelled_order_count" integer NOT NULL DEFAULT 0,
        "return_count" integer NOT NULL DEFAULT 0,
        "units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "units_returned" numeric(18,4) NOT NULL DEFAULT 0,
        "pending_cost_lines_count" integer NOT NULL DEFAULT 0,
        "cash_inflow_amount" bigint NOT NULL DEFAULT 0,
        "cash_outflow_amount" bigint NOT NULL DEFAULT 0,
        "debt_collected_amount" bigint NOT NULL DEFAULT 0,
        "projection_version" bigint NOT NULL DEFAULT 1,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_sales_summaries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_sales_summaries_key" UNIQUE ("tenant_id", "generation_id", "date_bucket", "branch_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_daily_sales_summaries_branch_date" ON ${dailySummaries} ("tenant_id", "generation_id", "branch_id", "date_bucket")`,
    );
    await ownerRls(queryRunner, dailySummaries);

    // 6. Product Sales Summaries (Generation-Scoped SKU Rollup)
    await queryRunner.query(`
      CREATE TABLE ${productSummaries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "date_bucket" date NOT NULL,
        "branch_id" uuid NOT NULL,
        "variant_id" character varying(128) NOT NULL,
        "product_id" character varying(128) NULL,
        "sku_code" character varying(128) NOT NULL,
        "product_name" character varying(255) NOT NULL,
        "category_id" character varying(128) NULL,
        "brand_id" character varying(128) NULL,
        "units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "units_returned" numeric(18,4) NOT NULL DEFAULT 0,
        "gross_sales_revenue" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "returns_amount" bigint NOT NULL DEFAULT 0,
        "net_sales_revenue" bigint NOT NULL DEFAULT 0,
        "cogs_amount" bigint NOT NULL DEFAULT 0,
        "returned_cogs_amount" bigint NOT NULL DEFAULT 0,
        "net_cogs_amount" bigint NOT NULL DEFAULT 0,
        "gross_profit" bigint NOT NULL DEFAULT 0,
        "order_count" integer NOT NULL DEFAULT 0,
        "pending_cost_lines_count" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_sales_summaries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_sales_summaries_key" UNIQUE ("tenant_id", "generation_id", "date_bucket", "branch_id", "sku_code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_product_sales_summaries_sku_date" ON ${productSummaries} ("tenant_id", "generation_id", "sku_code", "date_bucket")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_sales_summaries_cat_date" ON ${productSummaries} ("tenant_id", "generation_id", "category_id", "date_bucket")`,
    );
    await ownerRls(queryRunner, productSummaries);

    // 7. Employee Sales Summaries
    await queryRunner.query(`
      CREATE TABLE ${employeeSummaries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "date_bucket" date NOT NULL,
        "branch_id" uuid NOT NULL,
        "employee_id" character varying(128) NOT NULL,
        "gross_sales_revenue" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "returns_amount" bigint NOT NULL DEFAULT 0,
        "net_sales_revenue" bigint NOT NULL DEFAULT 0,
        "gross_profit" bigint NOT NULL DEFAULT 0,
        "completed_order_count" integer NOT NULL DEFAULT 0,
        "return_count" integer NOT NULL DEFAULT 0,
        "units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_sales_summaries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_employee_sales_summaries_key" UNIQUE ("tenant_id", "generation_id", "date_bucket", "branch_id", "employee_id")
      )
    `);
    await ownerRls(queryRunner, employeeSummaries);

    // 8. Channel Sales Summaries
    await queryRunner.query(`
      CREATE TABLE ${channelSummaries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "date_bucket" date NOT NULL,
        "branch_id" uuid NOT NULL,
        "channel_type" character varying(32) NOT NULL,
        "gmv" bigint NOT NULL DEFAULT 0,
        "gross_sales_revenue" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "returns_amount" bigint NOT NULL DEFAULT 0,
        "net_sales_revenue" bigint NOT NULL DEFAULT 0,
        "gross_profit" bigint NOT NULL DEFAULT 0,
        "order_count" integer NOT NULL DEFAULT 0,
        "completed_order_count" integer NOT NULL DEFAULT 0,
        "cancelled_order_count" integer NOT NULL DEFAULT 0,
        "units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_channel_sales_summaries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_channel_sales_summaries_key" UNIQUE ("tenant_id", "generation_id", "date_bucket", "branch_id", "channel_type")
      )
    `);
    await ownerRls(queryRunner, channelSummaries);

    // 9. Customer Group Sales Summaries
    await queryRunner.query(`
      CREATE TABLE ${customerGroupSummaries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "date_bucket" date NOT NULL,
        "branch_id" uuid NOT NULL,
        "customer_group_id" character varying(64) NOT NULL,
        "gross_sales_revenue" bigint NOT NULL DEFAULT 0,
        "discount_total" bigint NOT NULL DEFAULT 0,
        "returns_amount" bigint NOT NULL DEFAULT 0,
        "net_sales_revenue" bigint NOT NULL DEFAULT 0,
        "gross_profit" bigint NOT NULL DEFAULT 0,
        "completed_order_count" integer NOT NULL DEFAULT 0,
        "units_sold" numeric(18,4) NOT NULL DEFAULT 0,
        "loyalty_points_earned" bigint NOT NULL DEFAULT 0,
        "loyalty_points_redeemed" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_group_sales_summaries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_group_sales_summaries_key" UNIQUE ("tenant_id", "generation_id", "date_bucket", "branch_id", "customer_group_id")
      )
    `);
    await ownerRls(queryRunner, customerGroupSummaries);

    // 10. Inventory Stock Projections
    await queryRunner.query(`
      CREATE TABLE ${stockProjections} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "sku_code" character varying(128) NOT NULL,
        "variant_id" character varying(128) NULL,
        "product_name" character varying(255) NOT NULL DEFAULT '',
        "category_id" character varying(128) NULL,
        "on_hand_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "reserved_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "available_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "in_transit_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "avg_unit_cost" bigint NOT NULL DEFAULT 0,
        "inventory_valuation" bigint NOT NULL DEFAULT 0,
        "in_transit_valuation" bigint NOT NULL DEFAULT 0,
        "low_stock_threshold" numeric(18,4) NOT NULL DEFAULT 5,
        "is_low_stock" boolean NOT NULL DEFAULT false,
        "last_movement_at" TIMESTAMPTZ NULL,
        "last_sale_at" TIMESTAMPTZ NULL,
        "projection_version" bigint NOT NULL DEFAULT 1,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_stock_projections_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inventory_stock_projections_key" UNIQUE ("tenant_id", "warehouse_id", "sku_code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_stock_projections_low_stock" ON ${stockProjections} ("tenant_id", "is_low_stock", "warehouse_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_stock_projections_branch_sku" ON ${stockProjections} ("tenant_id", "branch_id", "sku_code")`,
    );
    await ownerRls(queryRunner, stockProjections);

    // 11. Inventory Value Snapshots
    await queryRunner.query(`
      CREATE TABLE ${valueSnapshots} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "snapshot_date" date NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "sku_count" integer NOT NULL DEFAULT 0,
        "total_on_hand_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "total_reserved_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "total_available_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "total_in_transit_qty" numeric(18,4) NOT NULL DEFAULT 0,
        "on_hand_valuation" bigint NOT NULL DEFAULT 0,
        "in_transit_valuation" bigint NOT NULL DEFAULT 0,
        "total_valuation" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_value_snapshots_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inventory_value_snapshots_key" UNIQUE ("tenant_id", "snapshot_date", "warehouse_id")
      )
    `);
    await ownerRls(queryRunner, valueSnapshots);

    // 12. Inventory Movement Projections
    await queryRunner.query(`
      CREATE TABLE ${movementProjections} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "date_bucket" date NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "sku_code" character varying(128) NOT NULL,
        "movement_type" character varying(64) NOT NULL,
        "qty_delta" numeric(18,4) NOT NULL DEFAULT 0,
        "unit_cost" bigint NOT NULL DEFAULT 0,
        "value_delta" bigint NOT NULL DEFAULT 0,
        "on_hand_after" numeric(18,4) NOT NULL DEFAULT 0,
        "reserved_after" numeric(18,4) NOT NULL DEFAULT 0,
        "reference_type" character varying(64) NOT NULL,
        "reference_id" character varying(128) NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_movement_projections_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inventory_movement_projections_key" UNIQUE ("tenant_id", "event_id", "warehouse_id", "sku_code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_movement_projections_date_wh" ON ${movementProjections} ("tenant_id", "date_bucket", "warehouse_id", "movement_type")`,
    );
    await ownerRls(queryRunner, movementProjections);

    // 13. Projection Checkpoints
    await queryRunner.query(`
      CREATE TABLE ${checkpoints} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "projection_name" character varying(64) NOT NULL,
        "active_generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "last_event_id" uuid NULL,
        "last_event_type" character varying(128) NULL,
        "last_event_occurred_at" TIMESTAMPTZ NULL,
        "last_processed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "projection_version" bigint NOT NULL DEFAULT 1,
        "events_processed_count" bigint NOT NULL DEFAULT 0,
        "status" character varying(32) NOT NULL DEFAULT 'HEALTHY',
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projection_checkpoints_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_projection_checkpoints_key" UNIQUE ("tenant_id", "projection_name")
      )
    `);
    await ownerRls(queryRunner, checkpoints);

    // 14. Projection Generations (Rebuild & Cutover Tracking)
    await queryRunner.query(`
      CREATE TABLE ${generations} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "projection_name" character varying(64) NOT NULL,
        "generation_id" character varying(64) NOT NULL,
        "previous_generation_id" character varying(64) NULL,
        "status" character varying(32) NOT NULL DEFAULT 'BUILDING',
        "from_date" date NULL,
        "to_date" date NULL,
        "orders_replayed" integer NOT NULL DEFAULT 0,
        "returns_replayed" integer NOT NULL DEFAULT 0,
        "triggered_by" character varying(128) NOT NULL,
        "reason" character varying(255) NULL,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        "error_message" text NULL,
        CONSTRAINT "PK_projection_generations_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_projection_generations_tenant_name" ON ${generations} ("tenant_id", "projection_name", "started_at")`,
    );
    await ownerRls(queryRunner, generations);

    // 15. Reconciliation Runs & Issues
    await queryRunner.query(`
      CREATE TABLE ${reconRuns} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "scope" character varying(64) NOT NULL,
        "from_date" date NOT NULL,
        "to_date" date NOT NULL,
        "branch_id" uuid NULL,
        "status" character varying(32) NOT NULL DEFAULT 'RUNNING',
        "metrics_checked" integer NOT NULL DEFAULT 0,
        "discrepancies_found" integer NOT NULL DEFAULT 0,
        "summary_report" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "triggered_by" character varying(128) NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_insight_reconciliation_runs_id" PRIMARY KEY ("id")
      )
    `);
    await ownerRls(queryRunner, reconRuns);

    await queryRunner.query(`
      CREATE TABLE ${reconIssues} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "scope" character varying(64) NOT NULL,
        "metric_name" character varying(64) NOT NULL,
        "dimension_key" character varying(255) NOT NULL,
        "expected_value" numeric(18,4) NOT NULL DEFAULT 0,
        "actual_value" numeric(18,4) NOT NULL DEFAULT 0,
        "delta_value" numeric(18,4) NOT NULL DEFAULT 0,
        "severity" character varying(16) NOT NULL DEFAULT 'HIGH',
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "detected_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insight_reconciliation_issues_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_insight_recon_issues_run" ON ${reconIssues} ("tenant_id", "run_id")`,
    );
    await ownerRls(queryRunner, reconIssues);

    // 16. Report Export Jobs
    await queryRunner.query(`
      CREATE TABLE ${exportJobs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "report_type" character varying(64) NOT NULL,
        "format" character varying(16) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "allowed_branch_ids" jsonb NULL,
        "snapshot_generation_id" character varying(64) NOT NULL DEFAULT 'gen-active',
        "snapshot_version" bigint NOT NULL DEFAULT 1,
        "snapshot_as_of" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "row_count" integer NOT NULL DEFAULT 0,
        "byte_size" integer NOT NULL DEFAULT 0,
        "content_type" character varying(128) NOT NULL DEFAULT 'text/csv',
        "file_name" character varying(255) NOT NULL DEFAULT 'export.csv',
        "file_content_base64" text NULL,
        "checksum_sha256" character varying(64) NULL,
        "requested_by" character varying(128) NOT NULL,
        "error_message" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        "expires_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_report_export_jobs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_report_export_jobs_tenant_created" ON ${exportJobs} ("tenant_id", "created_at" DESC)`,
    );
    await ownerRls(queryRunner, exportJobs);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    for (const table of [
      'report_export_jobs',
      'reconciliation_issues',
      'reconciliation_runs',
      'projection_generations',
      'projection_checkpoints',
      'inventory_movement_projections',
      'inventory_value_snapshots',
      'inventory_stock_projections',
      'customer_group_sales_summaries',
      'channel_sales_summaries',
      'employee_sales_summaries',
      'product_sales_summaries',
      'daily_sales_summaries',
      'sales_return_facts',
      'sales_order_line_facts',
      'sales_order_facts',
      'insight_dimension_caches',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t(table)} CASCADE`);
    }
  }
}
