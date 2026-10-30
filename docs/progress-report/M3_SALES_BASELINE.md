# M3 Sales & POS Microservice — Phase 0 Repository Audit & Baseline Report

## 1. Executive Summary

Before implementing **Milestone M3 — Production-Grade Sales & POS Microservice (`apps/sales`)**, we audited `apps/sales`, `apps/catalog` (M1), `apps/inventory` (M2), `apps/platform`, `libs/contracts`, `libs/common`, `libs/auth`, `libs/events`, and `krakend/krakend.json`.

---

## 2. Prerequisite Verification (M1 Catalog, M2 Inventory, Platform)

| Dependency | Capability | Verification Status | Evidence |
|---|---|---|---|
| **M1 Catalog (`apps/catalog`)** | Stable `variantId`, `productId`, `skuCode`, `barcode`, lifecycle status (`ACTIVE \| INACTIVE \| ARCHIVED`), unit conversions (`conversionFactor`), and deterministic price resolution (`GET /api/v1/variants/:id/price`, `GET /api/v1/products/lookup`) + outbox events (`catalog.variant.*`, `catalog.product.deactivated`, `catalog.price.changed`) | **VERIFIED READY** | `pnpm test:catalog` & `apps/catalog/test/catalog.int-spec.ts` passing |
| **M2 Inventory (`apps/inventory`)** | Multi-warehouse stock balances (`stock_balance`), atomic multi-SKU reservation (`POST /internal/v1/reservations`), timeout recovery (`GET /internal/v1/reservations/by-key/:idempotencyKey`, `GET /internal/v1/reservations?orderId=...`), commit (`POST /internal/v1/reservations/:id/commit`), release (`POST /internal/v1/reservations/:id/release`), and return receiving (`POST /api/v1/stock-receipts` with `sourceType: 'RETURN'`) | **VERIFIED READY** | `pnpm test:inventory` (63/63) & `apps/inventory/test/inventory.int-spec.ts` (43/43) passing |
| **Platform (`apps/platform`)** | RS256 JWT authentication, `tenant_id` & `roles` / `permissions` claims, branch lifecycle events (`platform.branch.created`, `platform.branch.updated`) | **VERIFIED READY** | `BranchProjectionHandler` in `apps/sales/src/branches/` active |
| **Finance (`apps/finance`)** | Authoritative cashbook settlement & external payment gateway settlement | **NOT YET IMPLEMENTED (M4/M5)** | Per Section 9.3 & 12.5 of M3 spec: Sales records POS cash/mixed tender evidence and persists `refund_requests` / electronic payment states as `PENDING` without fabricating external settlement |

---

## 3. Baseline Audit of Existing `apps/sales`

### 3.1. Existing Files Inspected
- `apps/sales/src/migrations/1791800000000-create-sales-tables.ts`: Created `orders`, `order_items`, and `branch_projection`.
  - **Defect 1:** `orders`, `order_items`, and `branch_projection` did **not** enable PostgreSQL Row-Level Security (`enableTenantRlsPolicy`).
  - **Defect 2:** `orders` only had a single `status` column (`'completed'`) instead of the required 3-dimensional state model (`order_status`, `payment_status`, `fulfillment_status`) and lacked financial breakdown columns (`subtotal`, `item_discount_total`, `order_discount_total`, `shipping_fee`, `tax_total`, `grand_total`, `paid_amount`, `refunded_amount`, `version`).
  - **Defect 3:** `OrdersService.newCode()` used `Date.now().toString(36) + randomUUID().slice(0, 3)` instead of a sequential, tenant-scoped, concurrency-safe business code (`HD-YYYYMMDD-000001`).
- `apps/sales/src/migrations/1791800000300-create-checkout-workflow.ts`: Created `checkout_workflow` with basic states (`PENDING_STOCK`, `RESERVING`, `STOCK_RESERVED`, `CONFIRMED`, `RECOVERY_PENDING`, `REJECTED`, `CANCELLED`).
  - **Gap:** `confirmReservedOrder()` created the order *before* committing the Inventory reservation and swallowed commit failures (`try { await this.inventory.commitWarehouseReservation(...) } catch {}`), leaving no explicit `COMMITTING_STOCK` / `FINALIZING` / `REQUIRES_RECONCILIATION` tracking or recovery when Inventory commit times out or Sales crashes after Inventory commit.
- **Missing M3 Modules in `apps/sales`:**
  1. Pure domain pricing, discount waterfall, pro-rated allocation, RBAC discount limits, and 3D state machine (`apps/sales/src/domain/`).
  2. Catalog integration client & event projection (`apps/sales/src/infrastructure/catalog-client/`) — previously `OrdersService` trusted client-submitted `unitPrice` and `name`!
  3. POS Shift lifecycle (`apps/sales/src/modules/shifts/` — open shift, active shift lookup, close shift with expected vs actual cash variance, pending checkout guard).
  4. POS Draft Invoices & Quote API (`apps/sales/src/modules/pos/` — max 5 active drafts per cashier/branch, server-side quote calculation).
  5. Full POS & Omnichannel Checkout Saga (`apps/sales/src/modules/checkout/` — `/api/v1/pos/checkout`, `/api/v1/pos/checkouts/:id`, `/api/v1/pos/checkouts/:id/retry`, `/api/v1/pos/checkouts/:id/confirm-payment`, and reconciliation worker).
  6. Full Order lifecycle & Omnichannel intake (`apps/sales/src/modules/orders/` — `DRAFT/PENDING -> CONFIRMED -> COMPLETED | CANCELLED`, order status history, external marketplace order idempotency `(tenant_id, source_connection_id, external_order_id)`).
  7. Partial & Full Returns + Refund Requests (`apps/sales/src/modules/returns/` — return eligibility, concurrent quantity guard, pro-rated discount-aware refund calculation, stock disposition `RESTOCK | DAMAGED | QUARANTINE | NO_PHYSICAL_RETURN` integrated with Inventory).
  8. Order Fulfillments (`apps/sales/src/modules/fulfillment/` — `/api/v1/orders/:id/fulfillments`, `/api/v1/fulfillments/:id/confirm`).
  9. Promotions & Coupons (`apps/sales/src/modules/promotions/` — basic promotions & atomic coupon usage limit enforcement).

---

## 4. Backward Compatibility Strategy

To preserve all existing working tests in `apps/sales/src/orders/orders.service.spec.ts`, `apps/sales/src/inventory/inventory.client.spec.ts`, `apps/sales/src/app.e2e.spec.ts`, and `apps/sales/test/sales.int-spec.ts`:
1. We preserve existing `OrdersService` and `OrdersController` endpoints (`POST /api/v1/orders`, `POST /api/v1/orders/checkouts`, etc.) and extend `orders`, `order_items`, and `checkout_workflow` via an additive forward migration (`1791900000200-create-m3-sales-core.ts`) with sensible defaults so all legacy M0/ADR-0012 callers continue to pass 100%.
2. We add all new M3 modules (`shifts`, `pos`, `checkout`, `orders` extensions, `returns`, `fulfillment`, `promotions`, `reconciliation`) as focused, single-responsibility modules under `apps/sales/src/modules/`.
