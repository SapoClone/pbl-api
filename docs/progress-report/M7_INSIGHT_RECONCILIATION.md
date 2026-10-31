# M7 Insight & Analytics — Automated Analytical Reconciliation Engine (`M7_INSIGHT_RECONCILIATION.md`)

**Date:** 2026-10-30
**Implementation:** [`insight-reconciliation.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reconciliation/insight-reconciliation.service.ts)
**Controller:** [`insight-internal.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/insight-internal.controller.ts)

---

## 1. Reconciliation Architecture & Scope

To guarantee that pre-aggregated summary tables never silently drift from retained operational facts, [`InsightReconciliationService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reconciliation/insight-reconciliation.service.ts) provides an automated audit engine accessible via:
- `POST /internal/v1/insight/reconciliation-runs`
- `GET /internal/v1/insight/reconciliation-runs`
- `GET /internal/v1/insight/reconciliation-runs/:id`

### Supported Audit Scopes (`ALL`, `SALES`, `INVENTORY`, `FINANCE`, `GROSS_PROFIT`)

| Scope | Baseline Source (Truth) | Target Summary Projection | Audited Metrics |
|---|---|---|---|
| `SALES` | `order_analytics_facts` (`is_counted_in_sales = true`) | `daily_sales_summaries` | `net_sales_amount`, `gross_sales_amount`, `order_count` per `(branch_id, channel, date_bucket)` |
| `GROSS_PROFIT` | `order_analytics_facts` (`is_counted_in_sales = true`) | `daily_sales_summaries` | `cogs_amount`, `gross_profit_amount` per `(branch_id, channel, date_bucket)` |
| `INVENTORY` | `inventory_stock_projections` (`on_hand_qty * unit_cost`) | `inventory_stock_projections` (`inventory_value_amount`, `available_qty`) | `inventory_value_amount` vs `on_hand_qty * unit_cost` and `available_qty` vs `on_hand_qty - reserved_qty` per `(warehouse_id, sku_id)` |
| `FINANCE` | `financial_cashflow_facts` | `daily_cashflow_summaries` | `cash_inflow_amount`, `cash_outflow_amount`, `net_cashflow_amount` per `(branch_id, date_bucket)` |

---

## 2. Discrepancy Detection, Severity Classification & Self-Healing Workflow

1. **Exact Scaled Comparison:**
   For every bucket key, the engine compares `expected` (recomputed from retained facts) against `actual` (stored in summary tables) using scaled `bigint` arithmetic (`toScaledBigInt(actual) - toScaledBigInt(expected)`).
2. **Issue Persistence (`analytics_reconciliation_issues`):**
   Any non-zero variance is persisted as an immutable row in `analytics_reconciliation_issues` with:
   - `projection_name`, `metric_name`, `date_bucket`, `branch_id`, `dimension_key`
   - `expected_value`, `actual_value`, `variance_value`
   - `severity`: `CRITICAL` if $|\text{variance}| \ge 100.0000$, else `HIGH`.
3. **Run Status & Event Alerting:**
   - If `discrepancyCount === 0`, the run completes with `status = 'PASSED'`.
   - If `discrepancyCount > 0`, the run completes with `status = 'DISCREPANCY_FOUND'`, surfaces an alert on `GET /api/v1/insight/dashboard/alerts`, and publishes `insight.reconciliation.discrepancy_detected` (`INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED`) to the transactional outbox.
4. **Closed-Loop Recovery (Verified in Scenario M of [`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)):**
   When a discrepancy is detected (e.g., `net_sales_amount` drifted by `+140,000`), triggering `POST /internal/v1/insight/projection-rebuilds` heals the projection from `order_analytics_facts`, and the subsequent reconciliation run returns `status = 'PASSED'` with `discrepancyCount = 0`.
