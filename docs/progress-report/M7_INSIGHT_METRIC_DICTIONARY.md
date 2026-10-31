# Milestone M7 — Analytical Metric Dictionary Report (`M7_INSIGHT_METRIC_DICTIONARY.md`)

**Date:** 2026-10-30  
**Canonical Specification:** [`docs/analytics/METRIC_DICTIONARY.md`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/docs/analytics/METRIC_DICTIONARY.md)  
**Domain Engine Implementation:** [`apps/insight/src/domain/insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts)

---

## 1. Executive Summary

Milestone M7 establishes a single, unambiguous **Analytical Metric Dictionary** for SapoClone across all 22 mandatory retail KPIs:

1. **Sales & Revenue Metrics (10):** `gmv`, `gross_sales_revenue`, `net_sales_revenue`, `order_count`, `completed_order_count`, `cancelled_order_count`, `aov`, `units_sold`, `units_returned`, `discount_total`.
2. **Profitability Metrics (2):** `gross_profit`, `gross_margin_pct` (with `cost_status = 'PENDING' | 'VERIFIED'` and `is_profit_provisional` tracking).
3. **Inventory & Valuation Metrics (6):** `on_hand_qty`, `reserved_qty`, `available_qty`, `inventory_valuation` (including `in_transit_valuation` for multi-warehouse transfers), `low_stock_sku_count`, `slow_moving_stock`.
4. **Multi-Dimensional Breakdown Metrics (4):** `channel_revenue`, `branch_revenue`, `employee_sales`, `customer_group_sales`.

---

## 2. Key Accounting Invariants Enforced in Code

1. **Decimal-Safe Scaled Arithmetic (`SCALE = 10000n`):**
   All currency values (`NUMERIC(18, 4)`) and quantities (`NUMERIC(18, 4)`) are parsed into exact `bigint` fixed-point integers (`parseScaledDecimal`, `formatScaledDecimal`) inside [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts).
2. **Contribution-Delta Idempotency:**
   Every order fact stores its last applied contribution (`contributedGmv`, `contributedGrossRevenue`, `contributedDiscount`, `contributedNetRevenue`, `contributedCogs`, `contributedUnitsSold`, `contributedOrderCount`, `contributedCompletedCount`, `contributedCancelledCount`). Replaying an event or transitioning an order from `CONFIRMED -> CANCELLED` or `COMPLETED -> CANCELLED` applies the exact difference $\Delta = \mathbf{C}_{\text{new}} - \mathbf{C}_{\text{prev}}$.
3. **Revenue vs. Cash Collection Separation:**
   Credit sales (`COMPLETED` orders paid via customer credit/receivable) are recognized in `gross_sales_revenue` and `net_sales_revenue` upon order completion. Subsequent `finance.receivable.payment_applied` events increment `debt_collected_amount` and `cash_inflow_amount` without altering sales revenue.
4. **Historical COGS Immutability & Late Cost Resolution:**
   Each `sales_order_line_facts` row snapshots `unit_cost_snapshot` at sale time. Subsequent `inventory.stock.received` events that change a SKU's current moving-average cost update `inventory_stock_projections.avg_unit_cost` for future sales and current inventory valuation, but never overwrite historical `sales_order_line_facts`. If cost was missing at sale time (`cost_status = 'PENDING'`), a late cost event resolves only the pending lines once.
