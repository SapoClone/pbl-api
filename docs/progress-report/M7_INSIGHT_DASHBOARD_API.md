# M7 Insight & Analytics — Executive Dashboard API (`M7_INSIGHT_DASHBOARD_API.md`)

**Date:** 2026-10-30
**Controller:** [`insight-analytics.controller.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/insight-analytics.controller.ts)
**Service:** [`insight-reporting.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reporting/insight-reporting.service.ts)

---

## 1. Dashboard Endpoints Summary

All Executive Dashboard endpoints require `insight.dashboard.read` (granted to `owner`, `manager`, and `accountant`; denied `403` to `cashier`) and automatically enforce tenant RLS and branch-scope (`X-Branch-Ids`) filtering.

| Method & Route | Handler | Primary Projections Queried | Measured Latency (`p50` / `p95`) |
|---|---|---|---|
| `GET /api/v1/insight/dashboard/overview` | `getDashboardOverview` | `daily_sales_summaries`, `inventory_stock_projections`, `daily_cashflow_summaries`, `projection_checkpoints` | `1.62 ms` / `5.70 ms` |
| `GET /api/v1/insight/dashboard/revenue-trend` | `getDashboardRevenueTrend` | `daily_sales_summaries`, `projection_checkpoints` | `1.27 ms` / `2.35 ms` |
| `GET /api/v1/insight/dashboard/top-products` | `getDashboardTopProducts` | `product_sales_summaries` | `1.32 ms` / `2.35 ms` |
| `GET /api/v1/insight/dashboard/alerts` | `getDashboardAlerts` | `inventory_stock_projections`, `projection_checkpoints`, `analytics_reconciliation_runs` | `1.54 ms` / `2.80 ms` |

---

## 2. Endpoint Contracts & Behavioral Invariants

### 2.1. `GET /api/v1/insight/dashboard/overview`
- **Query Parameters:** `fromDate` (`YYYY-MM-DD`), `toDate` (`YYYY-MM-DD`), `branchId` (optional UUID), `channel` (optional string).
- **Returned KPIs:**
  - `kpis.grossSalesAmount`, `kpis.discountAmount`, `kpis.taxAmount`, `kpis.shippingFeeAmount`, `kpis.refundedAmount`, `kpis.netSalesAmount`, `kpis.cogsAmount`, `kpis.grossProfitAmount` (all `DECIMAL(18,4)` strings).
  - `kpis.grossMarginPct`, `kpis.averageOrderValue` (`DECIMAL(18,4)` string or `null` when denominator $= 0$).
  - `kpis.orderCount`, `kpis.cancelledOrderCount`, `kpis.returnedOrderCount`, `kpis.unitsSold`, `kpis.unitsReturned`.
  - `kpis.lowStockSkuCount`, `kpis.inventoryValueAmount`, `kpis.outstandingReceivableAmount`, `kpis.codPendingAmount`, `kpis.netCashflowAmount`.
- **Prior-Period Comparison (`priorPeriod` & `growth`):**
  Automatically computes the equal-length calendar window immediately preceding `[fromDate, toDate]` and returns `growth.netSalesGrowthPct`, `growth.grossProfitGrowthPct`, and `growth.orderCountGrowthPct` (returning `null` when prior-period baseline is `0` to prevent division-by-zero).
- **Data Freshness Disclosure (`freshness`):**
  Returns `lastEventOccurredAt`, `lastProjectedAt`, `lagSeconds`, and `isStale` (`true` if lag $> 300\text{ s}$).

### 2.2. `GET /api/v1/insight/dashboard/revenue-trend`
- **Zero-Filled Calendar Buckets:** Uses [`enumerateDateRange`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts) to emit a continuous array of `series` points for every calendar day in `[fromDate, toDate]`, filling days with no sales activity with `"0.0000"` so frontend charts never render broken time axes.

### 2.3. `GET /api/v1/insight/dashboard/top-products`
- **Deterministic Ranking:** Ranks SKUs by `sortBy=net_sales` (default) or `sortBy=units_sold`, with deterministic tie-breakers (`net_sales DESC, units_sold DESC, sku_code ASC`).

### 2.4. `GET /api/v1/insight/dashboard/alerts`
- Aggregates actionable operational alerts:
  - `LOW_STOCK`: SKUs where `available_qty <= reorder_point_qty`.
  - `STALE_PROJECTION`: Checkpoints where projection lag exceeds threshold.
  - `RECONCILIATION_DISCREPANCY`: Open variance runs from `analytics_reconciliation_runs`.
