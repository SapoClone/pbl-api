# ADR-009: Synchronous Reservation Port with Compensating Release in Sales

- **Status:** Accepted (Verified in M7.5)
- **Date:** 2026-10-31

## Context
Confirming a retail or POS order requires immediate verification that sellable stock is available in the selected warehouse; deferring stock reservation to an asynchronous queue would allow overselling during flash sales.

## Decision
1. `Sales` calls `Inventory` synchronously via `InventoryReservationClientService` (`reserveStock`, `commitReservation`, `releaseReservation`) using a deterministic `idempotencyKey` per order/fulfillment operation.
2. If `Inventory.reserveStock` succeeds but the local `Sales` transaction fails to commit, `M3OrdersService.confirmOrder` executes a compensating `releaseReservation` call and logs a structured reconciliation alert if the compensation fails.

## Consequences
- **Positive:** Prevents overselling at order confirmation while keeping authoritative stock state strictly inside `Inventory`.
- **Negative / Trade-off:** Order confirmation requires `Inventory` availability.
