# M7 Insight & Analytics — Entity-Relationship Diagram & Schema Design (`M7_INSIGHT_ERD.md`)

**Date:** 2026-10-30
**Migration:** [`1791900000300-create-m7-insight-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/migrations/1791900000300-create-m7-insight-core.ts)
**Entities:** [`insight.entities.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/infrastructure/persistence/insight.entities.ts)

---

## 1. Analytical Data Model Overview

`insight_db` contains **18 domain tables** (plus `inbox_messages` and `outbox_events` from `@pbl/events`), organized into four logical tiers:

1. **Dimensional Lookup Cache Tier (2 tables):** Local event-hydrated caches of SKU/category metadata and branch/channel metadata so Insight never joins across microservices.
2. **Retained Fact & Contribution State Tier (3 tables):** Immutable/idempotent event-fact ledgers (`order_analytics_facts`, `inventory_movement_facts`, `financial_cashflow_facts`) that enable out-of-order convergence, late cancellations/returns, non-blocking shadow rebuilds, and automated reconciliation.
3. **Pre-Aggregated Analytical Summary Projections Tier (9 tables):** Indexed read models optimized for $< 10\text{ ms}$ dashboard and reporting queries (`daily_sales_summaries`, `daily_sales_projections`, `product_sales_summaries`, `category_sales_summaries`, `branch_sales_summaries`, `channel_sales_summaries`, `customer_sales_summaries`, `inventory_stock_projections`, `inventory_movement_summaries`, `daily_cashflow_summaries`).
4. **Operational Governance Tier (6 tables):** Audit logs, projection checkpoints, shadow rebuild runs, reconciliation runs + discrepancy issues, and report export jobs.

---

## 2. Entity-Relationship Diagram (Mermaid)

```mermaid
erDiagram
    ANALYTICS_SKU_CATALOG_CACHE {
        uuid id PK
        uuid tenant_id
        uuid sku_id
        uuid product_id
        varchar sku_code
        varchar product_name
        uuid category_id
        varchar category_name
        numeric latest_unit_cost
    }

    ANALYTICS_BRANCH_CHANNEL_CACHE {
        uuid id PK
        uuid tenant_id
        varchar dimension_type
        varchar dimension_key
        varchar display_name
        varchar timezone
    }

    ORDER_ANALYTICS_FACTS {
        uuid id PK
        uuid tenant_id
        uuid order_id
        uuid branch_id
        varchar channel
        uuid customer_id
        date date_bucket
        varchar order_status
        boolean is_counted_in_sales
        boolean is_cancelled_counted
        numeric gross_sales_amount
        numeric discount_amount
        numeric tax_amount
        numeric shipping_fee_amount
        numeric refunded_amount
        numeric net_sales_amount
        numeric cogs_amount
        numeric gross_profit_amount
        varchar cost_basis_status
        jsonb line_items_json
        uuid last_event_id
    }

    DAILY_SALES_SUMMARIES {
        uuid id PK
        uuid tenant_id
        uuid branch_id
        varchar channel
        date date_bucket
        int order_count
        int cancelled_order_count
        int returned_order_count
        numeric units_sold
        numeric units_returned
        numeric gross_sales_amount
        numeric discount_amount
        numeric tax_amount
        numeric shipping_fee_amount
        numeric refunded_amount
        numeric net_sales_amount
        numeric cogs_amount
        numeric gross_profit_amount
        int unknown_cost_order_count
    }

    PRODUCT_SALES_SUMMARIES {
        uuid id PK
        uuid tenant_id
        uuid branch_id
        varchar channel
        uuid sku_id
        date date_bucket
        varchar sku_code
        varchar product_name
        uuid category_id
        varchar category_name
        numeric units_sold
        numeric units_returned
        numeric gross_sales_amount
        numeric discount_amount
        numeric refunded_amount
        numeric net_sales_amount
        numeric cogs_amount
        numeric gross_profit_amount
        varchar cost_basis_status
    }

    INVENTORY_STOCK_PROJECTIONS {
        uuid id PK
        uuid tenant_id
        uuid branch_id
        uuid warehouse_id
        uuid sku_id
        varchar sku_code
        varchar product_name
        numeric on_hand_qty
        numeric reserved_qty
        numeric available_qty
        numeric reorder_point_qty
        boolean is_low_stock
        numeric unit_cost
        numeric inventory_value_amount
        timestamptz last_sale_at
        timestamptz last_movement_at
    }

    DAILY_CASHFLOW_SUMMARIES {
        uuid id PK
        uuid tenant_id
        uuid branch_id
        date date_bucket
        numeric cash_inflow_amount
        numeric cash_outflow_amount
        numeric net_cashflow_amount
        numeric settled_payment_amount
        numeric refund_paid_amount
        numeric cod_settled_amount
        numeric cod_fee_amount
        numeric receivable_created_amount
        numeric receivable_collected_amount
        numeric outstanding_receivable_delta
        numeric cod_pending_delta
    }

    ANALYTICS_RECONCILIATION_RUNS ||--o{ ANALYTICS_RECONCILIATION_ISSUES : "records discrepancies"
    ANALYTICS_RECONCILIATION_RUNS {
        uuid id PK
        uuid tenant_id
        varchar scope
        date from_date
        date to_date
        varchar status
        int checked_buckets_count
        int discrepancy_count
    }

    ANALYTICS_RECONCILIATION_ISSUES {
        uuid id PK
        uuid tenant_id
        uuid reconciliation_run_id FK
        varchar projection_name
        varchar metric_name
        date date_bucket
        numeric expected_value
        numeric actual_value
        numeric variance_value
        varchar severity
    }
```

---

## 3. Composite Indexes & Query Optimization

All analytical summary tables use covering B-Tree composite indexes starting with `tenant_id` and `date_bucket` (or dimensional keys) so PostgreSQL executes `Index Scan` rather than sequential table scans:

- `UQ_daily_sales_summaries_key` on `(tenant_id, branch_id, channel, date_bucket)` + `IDX_daily_sales_summaries_tenant_date` on `(tenant_id, date_bucket)`.
- `UQ_product_sales_summaries_key` on `(tenant_id, branch_id, channel, sku_id, date_bucket)` + `IDX_product_sales_summaries_sku_date` on `(tenant_id, sku_id, date_bucket)`.
- `UQ_inventory_stock_projections_key` on `(tenant_id, warehouse_id, sku_id)` + `IDX_inventory_stock_projections_branch_sku` on `(tenant_id, branch_id, sku_id)` + `IDX_inventory_stock_projections_low_stock` on `(tenant_id, is_low_stock, branch_id)`.
- `UQ_daily_cashflow_summaries_key` on `(tenant_id, branch_id, date_bucket)` + `IDX_daily_cashflow_summaries_tenant_date` on `(tenant_id, date_bucket)`.
