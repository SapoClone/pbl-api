# M7 Insight & Analytics — COGS, Gross Profit & Cost-Basis Governance (`M7_INSIGHT_GROSS_PROFIT.md`)

**Date:** 2026-10-30
**Endpoints:** `GET /api/v1/insight/reports/gross-profit`, `GET /api/v1/insight/reports/gross-profit/products`
**Domain Logic:** [`insight-domain.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/domain/insight-domain.ts), [`projections.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/projections/projections.service.ts)

---

## 1. Gross Profit & Gross Margin Formulas

All monetary computations use exact scaled `bigint` arithmetic (`SCALE = 10,000` for `DECIMAL(18,4)`):

1. **Net Sales (`netSalesAmount`):**
   $$\text{Net Sales} = \text{Gross Sales} - \text{Discount Amount} - \text{Refunded Amount}$$
   *(Tax and shipping fees are tracked in dedicated columns `taxAmount` and `shippingFeeAmount` and never inflate merchandise net sales or gross profit).*
2. **Recognized COGS (`cogsAmount`):**
   $$\text{Line Initial COGS} = \text{Quantity Sold} \times \text{Unit Cost at Sale}$$
   $$\text{Recognized COGS} = \max(0, \text{Initial COGS} - \text{Returned COGS})$$
3. **Gross Profit (`grossProfitAmount`):**
   $$\text{Gross Profit} = \text{Net Sales} - \text{Recognized COGS}$$
4. **Gross Margin Percentage (`grossMarginPct`):**
   $$\text{Gross Margin \%} = \begin{cases} \text{round\_half\_up}\left(\frac{\text{Gross Profit}}{\text{Net Sales}} \times 100, 4\right) & \text{if } \text{Net Sales} > 0 \\ \text{null} & \text{if } \text{Net Sales} \le 0 \end{cases}$$

---

## 2. Two-Tier Cost-Basis Resolution & Explicit `UNKNOWN` Cost Governance

A common failure in retail analytics systems is silently assuming `unit_cost = 0` when a product is sold before its purchase cost is recorded, which fabricates an artificial `100%` gross margin. Insight prevents this via a strict two-tier cost resolution protocol:

1. **Tier 1 — Event Line Snapshot (`item.unitCost`):**
   If the `sales.order.paid` / `sales.order.completed` event includes a positive `unitCost` (or `costPrice`) on the line item, Insight uses that exact historical cost snapshot.
2. **Tier 2 — Local Catalog/Inventory Cost Cache (`analytics_sku_catalog_cache.latest_unit_cost`):**
   If the order event omits `unitCost`, Insight looks up `latest_unit_cost` in `analytics_sku_catalog_cache` (populated from `inventory.stock.received` and `catalog.variant.*` events).
3. **Explicit Cost-Basis Status (`KNOWN` / `PARTIAL` / `UNKNOWN`):**
   - If all line items resolve a valid cost, the order and SKU projection are marked `cost_basis_status = 'KNOWN'`.
   - If any line item lacks a known cost (`unitCost === null`), Insight **does not** hide the missing cost: it marks the SKU projection `UNKNOWN` (or `PARTIAL` if mixed across orders) and increments `unknown_cost_order_count` on `daily_sales_summaries`.
   - Both `/api/v1/insight/reports/gross-profit` and `/api/v1/insight/reports/gross-profit/products` return `unknownCostOrderCount` and `costBasisStatus` (`COMPLETE` vs `INCOMPLETE_COST_BASIS` / `KNOWN` vs `UNKNOWN`) so financial analysts have complete visibility into cost coverage.
