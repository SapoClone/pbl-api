# M7 Insight & Analytics — Inventory Stock, Movement, Valuation & Slow-Moving Reports (`M7_INSIGHT_INVENTORY_REPORTS.md`)

**Date:** 2026-10-30
**Service:** [`insight-reporting.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/modules/reporting/insight-reporting.service.ts)

---

## 1. Implemented Inventory Report Endpoints

| Endpoint | Source Projection Table | Purpose & Key Metrics |
|---|---|---|
| `GET /api/v1/insight/reports/inventory/stock` | `inventory_stock_projections` | Real-time stock projection by warehouse, branch, and SKU: `onHandQty`, `reservedQty`, `availableQty`, `reorderPointQty`, `isLowStock`, `unitCost`, `inventoryValueAmount`. |
| `GET /api/v1/insight/reports/inventory/low-stock` | `inventory_stock_projections` | Filtered alert report of SKUs where `available_qty <= reorder_point_qty`, sorted by `available_qty ASC` so the most urgent stockouts appear first. |
| `GET /api/v1/insight/reports/inventory/movements` | `inventory_movement_summaries` | Date-range summary of stock movements by SKU and branch: `inboundQty`, `outboundQty`, `returnInQty`, `adjustmentQty`, `damageQty`, `netMovementQty`, and `inboundValueAmount`. |
| `GET /api/v1/insight/reports/inventory/valuation` | `inventory_stock_projections` | Financial inventory valuation report computing per-SKU and total `inventoryValueAmount = onHandQty * unitCost` (`DECIMAL(18,4)`) plus branch/category breakdown. |
| `GET /api/v1/insight/reports/inventory/slow-moving` | `inventory_stock_projections` | Dead-stock and slow-moving SKU detector identifying stocked items (`on_hand_qty > 0`) whose `daysSinceLastSale >= thresholdDays` (default `30` days) or that have never been sold (`last_sale_at IS NULL`). |

---

## 2. Weighted-Average Cost & Stock Projection Invariants

1. **Weighted-Average Unit Cost (`computeWeightedAverageUnitCost`):**
   When `inventory.stock.received` arrives with `receivedQty > 0` and `unitCost > 0`:
   $$\text{New Unit Cost} = \frac{\max(0, \text{Old On-Hand Qty}) \times \text{Old Unit Cost} + \text{Received Qty} \times \text{Inbound Unit Cost}}{\max(0, \text{Old On-Hand Qty}) + \text{Received Qty}}$$
   Simultaneously, `analytics_sku_catalog_cache.latest_unit_cost` is updated so subsequent sales orders that do not carry an explicit line-item `unitCost` still resolve an accurate COGS cost basis.
2. **Available Quantity & Low-Stock Invariant:**
   $$\text{Available Qty} = \text{On-Hand Qty} - \text{Reserved Qty}$$
   $$\text{Is Low Stock} \iff \text{Available Qty} \le \text{Reorder Point Qty}$$
   Verified in Mandatory Scenario G ([`insight.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/test/insight.int-spec.ts)).
