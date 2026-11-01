# Integration Contracts & Synchronous / Asynchronous Boundaries

## 1. Synchronous vs. Asynchronous Contract Policy

SapoClone minimizes synchronous inter-service calls to prevent temporal coupling and cascading failures. Only two business workflows use synchronous internal HTTP contracts, and both are wrapped behind explicit Hexagonal Ports (`interface`s) with circuit-breaker/timeout protection and idempotency keys:

| Consumer Context | Provider Context | Port / Adapter | Endpoints | Justification & Fallback / Compensation |
|---|---|---|---|---|
| **Sales** (`apps/sales`) | **Inventory** (`apps/inventory`) | [`InventoryReservationClientService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/infrastructure/clients/inventory-reservation.client.ts) | `POST /internal/v1/inventory/reservations`, `POST .../commit`, `POST .../release` | Order confirmation (`confirmOrder`) and fulfillment (`confirmFulfillment`) require immediate authoritative stock availability confirmation (`INSUFFICIENT_STOCK` check). Protected by deterministic `idempotencyKey` and automatic compensating `releaseReservation` if local `Sales` DB commit fails. |
| **Sales** (`apps/sales`) | **Customer** (`apps/customer`) | [`CustomerLoyaltyClientService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/infrastructure/clients/customer-loyalty.client.ts) | `POST /internal/v1/loyalty/holds`, `POST .../commit`, `POST .../release` | Only invoked when a customer explicitly redeems loyalty points at checkout. If points are not redeemed, checkout has zero synchronous dependency on `Customer`. |

All other cross-service interactions (Catalog $\rightarrow$ Inventory/Sales/Integration/Insight, Sales $\rightarrow$ Finance/Customer/Insight, Inventory $\rightarrow$ Finance/Integration/Insight, Integration $\rightarrow$ Sales/Insight) are **100% asynchronous** via `@pbl/contracts` and `@pbl/events` (`EventOutbox` $\rightarrow$ SNS/SQS $\rightarrow$ `EventConsumer` inbox).

---

## 2. Contract Versioning & Backward Compatibility Rules

1. **Additive Evolution Only in `v1`:**
   - Existing fields in `@pbl/contracts` event payloads (`libs/contracts/src/events.ts`) and OpenAPI v1 DTOs may never be removed or have their types narrowed without bumping `version: 2`.
2. **Consumer-Side Defensive Defaults:**
   - Event consumers tolerate optional/newly added fields and ignore unrecognized fields.
3. **Out-of-Order & Duplicate Delivery Resilience:**
   - Every event consumer deduplicates by `event.id` in `<schema>.processed_events` inside the same database transaction as the projection/domain update.
   - Projection consumers (`CatalogSkuProjectionHandler` in `Inventory`, `CatalogSnapshotConsumer` in `Sales`, `InventoryStockChangedConsumer` in `Integration`) compare `aggregateVersion` / `stockVersion` to ignore stale out-of-order events.
