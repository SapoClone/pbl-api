# M7 Insight & Analytics — Non-Blocking Shadow Projection Rebuild Strategy (`M7_INSIGHT_REBUILD_STRATEGY.md`)

**Date:** 2026-10-30
**Implementation:** [`insight-rebuild.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/rebuild/insight-rebuild.service.ts)
**Controller:** [`insight-internal.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/insight-internal.controller.ts)

---

## 1. Why Analytical Projections Must Be Rebuildable Without Downtime

Even with idempotent inbox processing, an analytical read model may need to be rebuilt when:
1. A projection bug or rounding rule is updated in a new release.
2. Backfilled historical events or manual database repairs require recomputing summary buckets.
3. An operator wants to heal a discrepancy flagged by the reconciliation engine.

Truncating live summary tables outside a transaction or running slow row-by-row deletes while dashboard queries are reading would cause **blank dashboards or partial-read anomalies** for merchants.

---

## 2. Shadow Aggregation & Atomic Transactional Swap Architecture

[`InsightRebuildService.runRebuild`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/rebuild/insight-rebuild.service.ts) implements a **Shadow Aggregation + Atomic Transactional Swap** pipeline:

1. **Audit Trail Initialization (`projection_rebuild_runs`):**
   Records a `RUNNING` rebuild job (`scope`: `ALL`, `SALES`, or `CASHFLOW`, optional `fromDate`, `toDate`, `branchId`, `reason`, `triggeredBy`).
2. **Pre-Rebuild Baseline Checksum (`beforeChecksum`):**
   Computes a deterministic SHA-256 hash over the target summary rows in `daily_sales_summaries` before any modification.
3. **In-Memory Shadow Aggregation from Retained Facts:**
   Reads the authoritative retained fact tables (`order_analytics_facts` and/or `financial_cashflow_facts`) for the target date range and branch filter, and aggregates complete replacement buckets in memory for:
   - `daily_sales_summaries`
   - `daily_sales_projections` (M0 compatibility)
   - `product_sales_summaries`
   - `category_sales_summaries`
   - `branch_sales_summaries`
   - `channel_sales_summaries`
   - `customer_sales_summaries`
   - `daily_cashflow_summaries`
4. **Single-Transaction Atomic Swap (`MVCC` Safe):**
   Inside a single PostgreSQL transaction (`DataSource.transaction`):
   - Deletes the scoped summary rows (`DELETE FROM ... WHERE tenant_id = $1 AND date_bucket BETWEEN $2 AND $3`).
   - Bulk-inserts the freshly computed shadow rows.
   - Because PostgreSQL MVCC keeps the old rows visible to concurrent `SELECT` queries until `COMMIT`, **concurrent dashboard and report queries never observe an empty or half-rebuilt projection**.
5. **Post-Rebuild Checksum & Outbox Event (`afterChecksum`):**
   Computes `afterChecksum` (SHA-256), marks the run `COMPLETED` in `projection_rebuild_runs`, and emits `insight.projection.rebuilt` (`INSIGHT_PROJECTION_REBUILT`) via the transactional outbox.

---

## 3. Determinism & Performance Proof

- **Determinism (Scenario L in [`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)):** Running a full rebuild over clean projections produces `beforeChecksum === afterChecksum` (identical SHA-256 digest down to `0.0001`). Corrupted summary rows are healed to the exact baseline checksum.
- **Measured Performance ([`insight-benchmark.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/performance/insight-benchmark.ts)):** Rebuilding 30 days of multi-branch, multi-SKU projections (120 orders across 12 SKUs and 3 channels) completes in **`p50 = 420.81 ms`, `p95 = 458.13 ms`**.
