# M7 Insight & Analytics — Sales, Channel, Branch, Customer & Cashflow Reports (`M7_INSIGHT_SALES_REPORTS.md`)

**Date:** 2026-10-30
**Service:** [`insight-reporting.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reporting/insight-reporting.service.ts)

---

## 1. Implemented Sales & Financial Report Endpoints

All sales and financial report endpoints require `insight.reports.read` and enforce both PostgreSQL Row-Level Security (`tenant_id`) and branch-scope authorization (`X-Branch-Ids`).

| Endpoint | Source Projection Table | Key Features & Dimensions |
|---|---|---|
| `GET /api/v1/insight/reports/revenue` | `daily_sales_summaries` | Supports `groupBy=day\|week\|month` (`resolvePeriodGroupKey`), branch/channel filtering, totals summary, and AOV/Gross Margin % per period. |
| `GET /api/v1/insight/reports/products` | `product_sales_summaries` | Aggregates SKU performance across `[fromDate, toDate]`, computing `netUnitsSold`, `grossSalesAmount`, `discountAmount`, `refundedAmount`, `netSalesAmount`, `cogsAmount`, `grossProfitAmount`, `grossMarginPct`, and `costBasisStatus` (`KNOWN` / `PARTIAL` / `UNKNOWN`). |
| `GET /api/v1/insight/reports/categories` | `category_sales_summaries` | Aggregates revenue, units sold, returns, COGS, gross profit, and gross margin % by product category. |
| `GET /api/v1/insight/reports/branches` | `branch_sales_summaries` | Ranks store branches by net revenue with `orderCount`, `cancelledOrderCount`, `returnedOrderCount`, `averageOrderValue`, and `grossMarginPct`. |
| `GET /api/v1/insight/reports/channels` | `channel_sales_summaries` | Compares sales channels (`POS`, `SHOPEE`, `LAZADA`, `WEB`, etc.) and computes each channel's exact `revenueSharePct` of total tenant net sales. |
| `GET /api/v1/insight/reports/customers` | `customer_sales_summaries` | Ranks customers by net spend, tracking `orderCount`, `returnedOrderCount`, `grossProfitAmount`, `outstandingReceivableAmount`, and `lastOrderAt`. |
| `GET /api/v1/insight/reports/returns-cancellations` | `daily_sales_summaries` | Tracks daily `orderCount`, `cancelledOrderCount`, `returnedOrderCount`, `unitsReturned`, `refundedAmount`, and `returnRatePct`. |
| `GET /api/v1/insight/reports/cashflow` | `daily_cashflow_summaries` | Reports daily and total `cashInflowAmount`, `cashOutflowAmount`, `netCashflowAmount`, `settledPaymentAmount`, `refundPaidAmount`, `codSettledAmount`, `codFeeAmount`, `receivableCreatedAmount`, and `receivableCollectedAmount`. |

---

## 2. Period Grouping & Mathematical Consistency

1. **Flexible Period Grouping (`day`, `week`, `month`):**
   - `day`: `YYYY-MM-DD`
   - `week`: ISO week start date (`Monday YYYY-MM-DD`) computed via [`resolvePeriodGroupKey`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts)
   - `month`: `YYYY-MM`
2. **Cross-Report Reconciliation Invariant:**
   For any tenant, branch filter, and date range `[fromDate, toDate]`:
   $$\sum \text{Revenue Report (`netSalesAmount`)} = \text{Dashboard Overview (`netSalesAmount`)} = \sum \text{Branch Report (`netSalesAmount`)} = \sum \text{Channel Report (`netSalesAmount`)}$$
   This invariant is verified automatically in Mandatory Integration Test Scenarios D, E, and F ([`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)).
