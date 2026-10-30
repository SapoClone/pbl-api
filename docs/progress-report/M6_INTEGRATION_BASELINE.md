# M6 Integration & Omnichannel Microservice — Baseline Repository Audit

**Date:** 2026-10-30  
**Service:** `apps/integration` (`:3007`)  
**Scope:** Phase 0 Baseline Inspection for Milestone M6

---

## 1. Existing State of `apps/integration`

Prior to Milestone M6, `apps/integration` contained only the M0 bootstrap skeleton:

- [`apps/integration/src/main.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/main.ts): Bootstraps NestJS with `@pbl/common` `bootstrapService(AppModule, { name: 'integration' })`.
- [`apps/integration/src/app.module.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/app.module.ts): Registers `PblLoggingModule`, `PblAuthModule.forRemoteJwks()`, and `PblHealthModule`.
- [`apps/integration/src/app.e2e.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/app.e2e.spec.ts): Verifies `/health` and `/health/ready`.
- **Missing before M6:** No PostgreSQL migrations, no entities, no provider adapters, no webhook ingestion, no SKU mappings, no order synchronization, no inventory publication, no sync job engine, no conflict management, and no reconciliation engine.

---

## 2. Upstream Microservice Contracts Verified

### 2.1 Sales (`apps/sales` — M3)
- **Omnichannel Order Intake API:** [`M3OrdersController.createOmnichannelOrder`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/orders/m3-orders.controller.ts#L35-L55) (`POST /api/v1/orders/omnichannel`) and [`M3OrdersService.createOmnichannelOrder`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/sales/src/modules/orders/m3-orders.service.ts#L60-L86):
  - Accepts `channelType: 'MARKETPLACE'`, `sourceConnectionId`, `externalOrderId`, `branchId`, `warehouseId`, `customerName`, `lines`, `shippingFee`, `paymentMethod`, `initialStatus`, `autoConfirm`.
  - Enforces database-backed idempotency on `(tenant_id, source_connection_id, external_order_id)` and returns `{ ...orderDetails, replayed: true }` with `Idempotency-Replayed: true` if already created.
  - Also supports `POST /api/v1/orders/:id/confirm` and `POST /api/v1/orders/:id/cancel`.
- **Events Published by Sales:** `sales.order.created`, `sales.order.confirmed`, `sales.order.cancelled`, `sales.order.completed`, `sales.fulfillment.completed`.

### 2.2 Inventory (`apps/inventory` — M2)
- **Events Published by Inventory:**
  - `inventory.stock.changed` (`StockChangedPayload`: `warehouseId`, `skuId`, `movementType`, `qtyDelta`, `onHandAfter`, `reservedAfter`, `occurredAt`)
  - `inventory.reservation.confirmed`, `inventory.reservation.committed`, `inventory.reservation.released`, `inventory.reservation.expired`
  - `inventory.transfer.received`, `inventory.stocktake.adjusted`
- **Ownership Boundary:** Physical stock and reservations are owned exclusively by `Inventory`. `Integration` consumes stock change events, maintains a local sellable-availability projection (`catalog_variant_stock_projection`), applies per-connection safety buffers/allocation percentages, and publishes external sellable stock to connected marketplaces.

### 2.3 Catalog (`apps/catalog` — M1)
- **Events Published by Catalog:**
  - `catalog.product.created`, `catalog.product.updated`, `catalog.product.deactivated`
  - `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated` (`CatalogVariantEventPayload`: `variantId`, `productId`, `skuCode`, `barcode`, `name`, `basePrice`, `status`, `aggregateVersion`, `updatedAt`)
  - `catalog.price.changed`
- **Ownership Boundary:** `Integration` subscribes to Catalog variant events to maintain a local read projection (`integration_catalog_variants`) for fast tenant-isolated validation of `internal_variant_id` during SKU mapping and order import, without ever querying Catalog's PostgreSQL schema directly.

### 2.4 Finance (`apps/finance` — M5)
- Owns COD settlement batches (`cod_settlement_batches`) and payment settlements (`payment_settlements`). `Integration` forwards normalized external payment/COD evidence via events and internal contracts without writing to Finance tables.

---

## 3. Shared Infrastructure Foundations Verified

- **Authentication & RBAC (`@pbl/auth`):** [`AuthGuard`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/auth/src/auth.guard.ts) verifies RS256 JWTs and enforces role/permission decorators (`@Permissions(...)`, `@RequireRoles(...)`, `@Public()`). Needs extension in `hasRoleOrPermission` to map `integration.*` permissions to store roles (`owner`, `manager`, `cashier`).
- **Transactional Outbox & Inbox (`@pbl/events`):** Provides `outbox_event` (`EventOutbox`) and `inbox_event` (`@OnEvent`), plus `enableTenantRlsPolicy(queryRunner, table)` enforcing `tenant_id = current_setting('app.tenant_id', true)::uuid`.
- **Raw Body Support (`@pbl/common`):** [`bootstrapService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/common/src/bootstrap/bootstrap-service.ts) creates the NestJS app; enabling `rawBody: true` in `NestFactory.create` preserves `req.rawBody` bytes for cryptographic webhook signature verification.
