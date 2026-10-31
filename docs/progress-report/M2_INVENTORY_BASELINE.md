# M2 Inventory Microservice — Baseline Audit Report

**Date:** 2026-10-29  
**Service:** `apps/inventory` (`@pbl/api`)  
**PostgreSQL Schema:** `inventory`  

---

## 1. Executive Summary

Before implementing the complete **Milestone M2 — Inventory Core**, we audited `apps/inventory`, shared libraries (`@pbl/common`, `@pbl/auth`, `@pbl/contracts`, `@pbl/events`), existing PostgreSQL migrations, and reference specifications (`SapoClone_v2_architecture_spec.md`, `SapoClone_v2_entity_ownership.csv`, `inventory_reference_corrected.sql`, `inventory-reservation.openapi.yaml`, and M1 Catalog reports).

### Key Baseline Findings

1. **Legacy P1 Branch Stock (`1791900000000-create-inventory-tables.ts`):**
   - Implements integer branch-scoped stock (`stock_item`, `stock_reservation`, `stock_reservation_item`, `inventory_ledger`, `branch_projection`).
   - Covered by existing P1 tests (`apps/inventory/src/app.e2e.spec.ts` and `apps/inventory/test/inventory.int-spec.ts`).
   - **Decision:** Must be preserved intact for backward compatibility while M2 warehouse-level authoritative tables become the primary v2 model.

2. **Initial Warehouse & Reservation Foundation (`1791900000100-add-warehouse-stock-balances.ts`):**
   - Implements initial `warehouse`, `stock_balance` (`NUMERIC(18,3)`), `warehouse_reservation`, `warehouse_reservation_line`, and `stock_balance_ledger` with PostgreSQL Row-Level Security (`ENABLE` + `FORCE ROW LEVEL SECURITY`).
   - Provides basic `POST /internal/v1/reservations`, `GET /internal/v1/reservations/:id`, `POST /internal/v1/reservations/:id/commit`, and `POST /internal/v1/reservations/:id/release`.

3. **Gaps Identified Against M2 Specification:**
   - **Warehouse Lifecycle & Preconditions:** Missing `kind` (`BRANCH`, `CENTRAL`, `QUARANTINE`), `address`, `GET /api/v1/warehouses/:id`, `PATCH /api/v1/warehouses/:id`, and deactivation guard (`WAREHOUSE_HAS_PENDING_OPERATIONS` when on-hand, reserved, in-transit stock, active holds, or pending documents exist).
   - **Inventory Valuation (Weighted-Average Cost):** `stock_balance` lacks `avg_unit_cost NUMERIC(18,2)` and `valuation_amount NUMERIC(18,2)`; `stock_balance_ledger` lacks `qty_before`, `unit_cost`, `avg_cost_after`, `actor_id`, `correlation_id`, `reason`, and `reversal_of_ledger_id`.
   - **Stock Receiving & Issuing Document Workflows:** Missing `stock_receipt` / `stock_receipt_item` (`DRAFT → POSTED | CANCELLED`) and `stock_issue` / `stock_issue_item` (`DRAFT → POSTED | CANCELLED`) with idempotent posting.
   - **Warehouse-to-Warehouse Transfers:** Missing `stock_transfer` / `stock_transfer_item` (`DRAFT → DISPATCHED → PARTIALLY_RECEIVED | RECEIVED | DISCREPANCY | CANCELLED`) with explicit `in_transit_qty` accounting and cost carry-over.
   - **Physical Stocktake & Snapshot Concurrency Control:** Missing `stock_take` / `stock_take_item` (`DRAFT → COUNTING → APPROVED | CANCELLED`) with `snapshot_version` / `snapshot_on_hand_qty` staleness detection (`409 STOCKTAKE_STALE_SNAPSHOT`).
   - **Stock Thresholds & Low-Stock Alerts:** Missing `stock_threshold` table and `GET/PUT /api/v1/stock-thresholds`.
   - **Procurement (Suppliers & Purchase Orders):** Missing `supplier`, `purchase_order`, and `purchase_order_item` (`DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED | CANCELLED`) with partial receiving and over-receipt protection.
   - **Catalog SKU Reference Projection:** Missing `catalog_sku_projection` consumer handler for `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated`, and `catalog.product.deactivated`.
   - **Warehouse Reservation Expiry & Reconciliation:** `ReservationExpiryJob` only expired legacy `stock_reservation` rows, not `warehouse_reservation` rows; missing operational reconciliation engine comparing `stock_balance` against `stock_balance_ledger`, active `warehouse_reservation_line` holds, and in-transit transfer lines.

---

## 2. Feature-by-Feature Baseline Status Matrix

| Capability / Module | Priority | Baseline Status | Notes & M2 Action |
|---|---|---|---|
| **Warehouse CRUD & Deactivation Guards** | P0 | Partially implemented | Basic create/list existed; adding `kind`, `address`, `GET/:id`, `PATCH/:id`, and `WAREHOUSE_HAS_PENDING_OPERATIONS` check |
| **Authoritative `StockBalance` (`NUMERIC(18,3)`)** | P0 | Implemented | Extending with `avg_unit_cost NUMERIC(18,2)` & `valuation_amount NUMERIC(18,2)` + `GET /api/v1/stocks`, `GET /api/v1/stocks/:skuId` |
| **Immutable `InventoryLedger` (`stock_balance_ledger`)** | P0 | Partially implemented | Adding `qty_before`, `unit_cost`, `avg_cost_after`, `actor_id`, `correlation_id`, `reason`, and `GET /api/v1/stock-movements` |
| **Stock Receiving Documents (`DRAFT → POSTED`)** | P0 | Missing (only direct receive existed) | Implementing `stock_receipt` & `stock_receipt_item` + idempotent `POST /api/v1/stock-receipts/:id/post` |
| **Stock Issue Documents (`DRAFT → POSTED`)** | P0 | Missing | Implementing `stock_issue` & `stock_issue_item` + atomic available-stock check on `POST /api/v1/stock-issues/:id/post` |
| **Multi-SKU Atomic Stock Reservation** | P0 | Implemented | Enhancing with OpenAPI snake_case/camelCase compatibility, warehouse status check, and outbox events for commit/release/expire |
| **Reservation Timeout Recovery & Expiry Worker** | P0 | Partially implemented | Adding lookup by idempotency key / order ID and `FOR UPDATE SKIP LOCKED` expiry for `warehouse_reservation` |
| **Operational Stock Reconciliation** | P0 | Missing | Implementing `ReconciliationService` & `POST /api/v1/stocks/reconcile` |
| **Multi-Warehouse Stock Transfer (`in_transit_qty`)** | P1 | Missing | Implementing `stock_transfer` & `stock_transfer_item` with dispatch, partial receive, and discrepancy handling |
| **Physical Stocktake (`STOCKTAKE_STALE_SNAPSHOT`)** | P1 | Missing | Implementing `stock_take` & `stock_take_item` with snapshot version check on approval |
| **Stock Thresholds (`min_qty` / `max_qty`)** | P1 | Missing | Implementing `stock_threshold` and `GET/PUT /api/v1/stock-thresholds` |
| **Procurement (`Supplier`, `PurchaseOrder`)** | P1 | Missing | Implementing suppliers, purchase orders, approval, and partial/full PO receiving |
| **Weighted-Average Cost Valuation** | P1 | Missing | Implementing decimal-safe `BigInt` weighted-average cost calculation on receipts, transfers, and stocktakes |
| **Catalog SKU Reference Projection** | P1 | Missing | Implementing `CatalogSkuProjectionHandler` consuming Catalog M1 variant/product events |
| **Lot / Batch / Expiry Date Tracking** | P2 | Deferred | Explicitly deferred to post-M2 per specification §2 |
