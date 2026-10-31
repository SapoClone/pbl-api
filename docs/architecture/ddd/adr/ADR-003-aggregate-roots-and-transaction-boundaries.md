# ADR-003: Fine-Grained Aggregate Roots & Deadlock-Free Transaction Boundaries

- **Status:** Accepted (Refined in M7.5)
- **Date:** 2026-10-31

## Context
High-throughput retail operations (concurrent POS checkouts, multi-item stock reservations, stock receipts, and omnichannel order imports) experience severe lock contention or deadlocks if aggregates are too large (e.g., locking a `Warehouse` root for every SKU movement) or if multi-row locks are acquired in arbitrary request order.

## Decision
1. Model `StockBalanceAggregate` at the `(tenantId, warehouseId, skuId)` granularity rather than the `Warehouse` level.
2. Enforce `normalizeAndSortWarehouseLines()` before acquiring `SELECT ... FOR UPDATE` locks so every multi-SKU transaction locks rows in deterministic `(warehouseId ASC, skuId ASC)` order.
3. Encapsulate `OrderAggregate` state transitions (`assertEditable`, `confirmWithReservation`, `cancel`, `assertCanCreateFulfillment`, `markFulfilled`) in `sales-domain.ts` so invalid 3D state combinations are impossible.

## Consequences
- **Positive:** Eliminates AB-BA deadlocks under concurrent POS/marketplace load while guaranteeing `available_qty >= 0`.
- **Negative / Trade-off:** Multi-line stock operations must sort line items prior to database locking.
