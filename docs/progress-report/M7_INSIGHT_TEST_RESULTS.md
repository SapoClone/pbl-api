# M7 Insight & Analytics — Automated Test Results (`M7_INSIGHT_TEST_RESULTS.md`)

**Date:** 2026-10-30
**Test Suites:**
- Unit & Domain Suite: [`apps/insight/src/domain/insight-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.spec.ts), [`apps/insight/src/insight.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/insight.spec.ts)
- Architecture & Boundary Suite: [`apps/insight/src/insight-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/insight-architecture.spec.ts)
- E2E Controller Suite: [`apps/insight/src/app.e2e.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/app.e2e.spec.ts)
- Real-PostgreSQL Integration Suite (Scenarios A–T): [`apps/insight/test/insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)

---

## 1. Test Execution Summary

| Test Suite Command | Suites Passed | Tests Passed | Status |
|---|---|---|---|
| `npx jest apps/insight/src` | **4 / 4** | **103 / 103** | **PASSED (100%)** |
| `npx jest --config libs/events/test/jest-int.json apps/insight/test/insight.int-spec.ts` | **1 / 1** | **7 / 7** (covering M0 + Mandatory Scenarios A–T) | **PASSED (100%)** |

---

## 2. Mandatory Scenarios A through T Verification Matrix (`insight.int-spec.ts`)

All 20 mandatory scenarios from Master Prompt M7 were executed against a real PostgreSQL instance with Row-Level Security (`FORCE ROW LEVEL SECURITY`) enabled on all 18 Insight tables:

| Scenario | Description | Verified Assertions in `insight.int-spec.ts` | Status |
|---|---|---|---|
| **Scenario A** | Paid/completed order projection | `ORD-A` (`gross=320,000`, `discount=20,000`, `tax=24,000`, `shipping=15,000`, `net=300,000`, `cogs=160,000`, `grossProfit=140,000`) updates `daily_sales_summaries`, `product_sales_summaries`, `category_sales_summaries`, `branch_sales_summaries`, `channel_sales_summaries`, and `customer_sales_summaries`. | **PASS** |
| **Scenario B** | Duplicate event idempotency & multi-stage (`paid` + `completed`) | Re-sending the exact `sales.order.paid` event ID via `InboxConsumer` and subsequently sending `sales.order.completed` for `ORD-A` produces zero double-counting (`orderCount = 1`, `netSalesAmount = 300000.0000`). | **PASS** |
| **Scenario C** | Cancelled order reversal | `ORD-B` paid (`net=200,000`) then cancelled via `sales.order.cancelled`: `orderCount` decrements back to `1`, `cancelledOrderCount` increments to `1`, and `ORD-B` revenue/COGS/profit are completely reversed. | **PASS** |
| **Scenario D** | Partial return / refund adjustment | Returning 1 unit of `SKU-COFFEE-1` (`refundedAmount=150,000`, `returnedCogs=80,000`) on `ORD-A` reduces `netSalesAmount` from `300,000` to `150,000`, `cogsAmount` from `160,000` to `80,000`, and `grossProfitAmount` from `140,000` to `70,000`. | **PASS** |
| **Scenario E** | Multi-branch & multi-channel aggregation | Adding `ORD-C` on Branch 2 (`SHOPEE`, `net=340,000`, `cogs=200,000`, `profit=140,000`) aggregates tenant net sales to `490,000.0000` and calculates exact channel revenue share % (`SHOPEE = 69.3878%`, `POS = 30.6122%`). | **PASS** |
| **Scenario F** | Dashboard vs Report consistency | Dashboard Overview `netSalesAmount` (`490,000.0000`) equals $\sum \text{Revenue Trend}$, $\sum \text{Revenue Report}$, $\sum \text{Branch Report}$, and $\sum \text{Channel Report}$. | **PASS** |
| **Scenario G** | Inventory stock, low-stock & valuation | `SKU-COFFEE-1` (`onHand=7`, `reserved=2`, `available=5 <= reorderPoint 5`) is flagged `isLowStock = true` (`valuation = 560,000`); `SKU-MUG-2` (`onHand=8`, `unitCost=50,000`, `valuation = 400,000`). Total valuation $= 960,000.0000$. | **PASS** |
| **Scenario H** | Inventory movement & slow-moving SKUs | Verifies `INBOUND`, `OUTBOUND`, `ADJUSTMENT`, and `DAMAGE` quantities in `/reports/inventory/movements` and flags `SKU-DEAD-3` (90 days since last sale) in `/reports/inventory/slow-moving`. | **PASS** |
| **Scenario I** | Gross profit & `UNKNOWN` cost-basis disclosure | Selling `SKU-MYSTERY-99` without a known cost increments `unknownCostOrderCount = 1`, marks the SKU `costBasisStatus = 'UNKNOWN'`, and marks `/reports/gross-profit` `costBasisStatus = 'INCOMPLETE_COST_BASIS'`. | **PASS** |
| **Scenario J** | Out-of-order event convergence | Receiving `sales.order.completed` **before** `sales.order.created` for `ORD-OOO` converges to `orderStatus = 'COMPLETED'`, `isCountedInSales = true`, and counts the order exactly once. | **PASS** |
| **Scenario K** | Timezone midnight boundary bucketing | An event at `2026-10-18T17:30:00.000Z` (`2026-10-19T00:30:00+07:00` in `Asia/Ho_Chi_Minh`) is bucketed into `2026-10-19`, not `2026-10-18`. | **PASS** |
| **Scenario L** | Non-blocking shadow projection rebuild determinism | Running `POST /internal/v1/insight/projection-rebuilds` over clean projections yields `beforeChecksum === afterChecksum`. | **PASS** |
| **Scenario M** | Reconciliation discrepancy detection & self-healing | Injecting a `+100,000` drift into `daily_sales_summaries` causes `runReconciliation` to return `DISCREPANCY_FOUND` (`variance = 100000.0000`) and emit `insight.reconciliation.discrepancy_detected`. Running `runRebuild` heals the drift, and re-running reconciliation returns `PASSED` (`discrepancyCount = 0`). | **PASS** |
| **Scenario N** | Export generation (`CSV`, `XLSX`, `PDF`) & formula-injection defense | Malicious product name `=cmd|' /C calc'!A0` is sanitized with a leading `'` in exported CSV/XLSX buffers; SHA-256 checksums and non-empty buffers verified for all 3 formats. | **PASS** |
| **Scenario O & P** | Multi-tenant RLS isolation & Branch RBAC | Tenant B sees `0.0000` for Tenant A's dates. A manager restricted to `BRANCH_1` (`X-Branch-Ids: BRANCH_1`) sees only `BRANCH_1` revenue (`230,000.0000`) and receives `403 INSIGHT_BRANCH_ACCESS_DENIED` when querying `branchId=BRANCH_2`. | **PASS** |
| **Scenario Q, R, S, T** | Cashflow & receivables, prior-period growth (`null` when prior=0), zero-filled trend buckets, and checkpoint freshness | Verifies `cashInflow=650,000`, `cashOutflow=150,000`, `netCashflow=500,000`, `outstandingReceivable=80,000`, `codPending=250,000`; verifies zero-filled date buckets across `[2026-10-17..2026-10-20]`; verifies `projection_checkpoints` tracking. | **PASS** |
