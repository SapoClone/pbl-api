# ADR-0012: Warehouse Stock Reservation Contract and Sales Checkout Timeout Recovery

- **Status:** Accepted
- **Date:** 2026-10-27
- **Scope:** `apps/inventory`, `apps/sales`, `libs/contracts`

## Context

[ADR-0010](0010-eight-services.md) introduced the initial branch-level stock reservation slice (`/internal/reservations` keyed by `orderId` against integer `stock_item` rows). The architecture specification (`SapoClone_v2_architecture_spec.md` and `inventory-reservation.openapi.yaml`) requires:
1. Warehouse-scoped decimal quantities (`NUMERIC(18,3)`) on `stock_balance` with database-enforced invariants (`on_hand_qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= on_hand_qty`).
2. A formal internal reservation contract (`/internal/v1/reservations`) supporting:
   - `Idempotency-Key` header + `request_sha256` payload hashing (`201` on creation, `200` on idempotent replay, `409 IDEMPOTENCY_CONFLICT` on payload mismatch).
   - Deterministic line normalization (merging duplicate `(warehouse_id, sku_id)` pairs and sorting by `(tenant_id, warehouse_id, sku_id)`) before locking rows to prevent deadlocks under concurrent multi-line checkouts.
   - Explicit lifecycle states (`HELD`, `COMMITTED`, `RELEASED`, `EXPIRED`) and append-only `stock_balance_ledger` entries on commit.
3. Explicit Sales checkout workflow state machine (`checkout_workflow`) in `OrdersService` that survives ambiguous HTTP timeouts when calling Inventory (`/internal/v1/reservations`) and recovers deterministically without double-reserving stock.
4. Full backward compatibility with existing routes (`/api/v1/stock-receipts`, `/api/v1/stock`, `/internal/reservations`, `/api/v1/orders`) and tests.

## Decision

1. **Preserve existing endpoints and tables untouched:**
   - Existing `stock_item`, `stock_reservation`, `stock_movement` tables and `/internal/reservations` + `/api/v1/orders` remain active and unchanged so all existing clients and tests continue to pass.
2. **Warehouse stock balance tables and `/internal/v1/reservations` contract in `apps/inventory/src/stock`:**
   - Add warehouse stock tables in schema `inventory`: `warehouse`, `stock_balance`, `warehouse_reservation`, `warehouse_reservation_line`, `stock_balance_ledger`, and `outbox_event` (`@pbl/events` producer).
   - Implement in `ReservationsService` / `WarehouseReservationsController` (`apps/inventory/src/stock/reservations.service.ts`, `apps/inventory/src/stock/reservations.controller.ts`):
     - `POST /internal/v1/reservations` (requires `Idempotency-Key`, normalizes & sorts lines, executes atomic `UPDATE stock_balance` inside a tenant-scoped transaction, emits `inventory.reservation.confirmed` to outbox).
     - `GET /internal/v1/reservations/:reservationId` (authoritative status lookup for recovery).
     - `POST /internal/v1/reservations/:reservationId/commit` (idempotent transition `HELD -> COMMITTED`, decrements `on_hand_qty` and `reserved_qty`, inserts `stock_balance_ledger` rows, emits `inventory.stock.changed` to outbox).
     - `POST /internal/v1/reservations/:reservationId/release` (idempotent transition `HELD -> RELEASED`, decrements `reserved_qty` once).
   - Implement warehouse and balance endpoints in `StockService` / `StockController` (`/api/v1/stock/warehouses`, `/api/v1/stock/balances`).
3. **Sales checkout workflow (`checkout_workflow`) and timeout recovery in `apps/sales/src/orders`:**
   - Add `checkout_workflow` table in schema `sales` (`CheckoutWorkflowEntity` in `apps/sales/src/orders/entities/order.entity.ts`) with states: `PENDING_STOCK`, `RESERVING`, `STOCK_RESERVED`, `CONFIRMED`, `RECOVERY_PENDING`, `REJECTED`, `CANCELLED`.
   - Before calling Inventory, `OrdersService.checkout` persists the workflow in `RESERVING` with a deterministic reservation idempotency key derived from `(tenantId, checkoutIdempotencyKey)`.
   - If the HTTP call to Inventory times out or fails with an ambiguous transport error, `OrdersService` transitions the workflow to `RECOVERY_PENDING` instead of assuming failure or blindly creating a new key.
   - `POST /api/v1/orders/checkouts/:id/recover` (or replaying `POST /api/v1/orders/checkouts` with the same `Idempotency-Key`) replays the exact same reservation idempotency key to Inventory, reconciles the authoritative reservation state (`HELD` -> completes order confirmation and commits reservation; `INSUFFICIENT_STOCK` -> marks workflow `REJECTED`), and guarantees zero duplicate stock reservations.

## Consequences

- Concurrent checkouts for the last unit of stock are serialized safely at PostgreSQL row level without deadlocks or negative available balances.
- Ambiguous network timeouts between `sales` and `inventory` leave an explicit, auditable `RECOVERY_PENDING` state that converges cleanly on retry/recovery.
- Outbox events (`inventory.reservation.confirmed`, `inventory.stock.changed`) are persisted in the same database transaction as the stock mutation.

## Alternatives considered

- **Replacing existing `stock_item` tables in-place with destructive migrations:** Rejected because existing tests, scripts (`demo-events.sh`), and KrakenD routes depend on the existing contract.
- **Blind retry with a new `Idempotency-Key` on timeout:** Rejected because if the first request succeeded in Inventory before the socket timed out, a new key would double-reserve stock.
