# Lazada Sandbox Order Synchronization Vertical Slice — Architecture Audit & Integration Report

**Repository:** `pbl-api` (Branch: `feat/omnichannel-orders`)  
**Bounded Contexts Involved:** `Integration` (owner of marketplace connections, credentials, SKU mappings, sync jobs, cursors, order references, and conflicts) $\rightarrow$ `Sales` (owner of canonical omnichannel orders via `POST /internal/v1/orders/omnichannel`).

---

## 1. Pre-Implementation DDD & Repository Architecture Audit

Before modifying any code, the existing `Integration` and `Sales` microservices were audited against the SapoClone DDD Architecture Specification v2:

1. **Reused Aggregates & Entities (`apps/integration/src/infrastructure/persistence/integration.entities.ts`):**
   - `ChannelConnectionEntity` & `ConnectionCredentialEntity`: Stores tenant/branch/warehouse-scoped Lazada connection metadata (`provider = 'LAZADA'`, `externalShopId`, `branchId`, `warehouseId`) and AES-256-GCM envelope-encrypted seller tokens (`encryptedAccessToken`, `encryptedRefreshToken`, `encryptedWebhookSecret`, `partnerId`).
   - `SkuMappingEntity`: Maps `(tenant_id, connection_id, external_item_id, external_sku_id)` to internal Catalog `internal_variant_id` and `internal_sku_code`.
   - `SyncJobEntity` & `SyncCursorEntity`: Provides durable, PostgreSQL `FOR UPDATE SKIP LOCKED` lease-based job execution (`ORDER_POLL`, `ORDER_IMPORT`) and monotonic `ORDER_POLL` window cursor tracking.
   - `ChannelOrderRefEntity` & `SyncConflictEntity`: Tracks `(tenant_id, connection_id, external_order_id)` synchronization state (`RECEIVED`, `IMPORTING`, `IMPORTED`, `MAPPING_REQUIRED`, `SHORTAGE_HOLD`, `CONFLICT`) and recoverable operator conflicts (`SKU_UNMAPPED`, `SKU_INACTIVE`, `STOCK_INSUFFICIENT`).
2. **Reused Cross-Service Contract (`SalesOrderClient` $\rightarrow$ `Sales` `InternalOrdersController`):**
   - `SalesOrderClient` (`apps/integration/src/infrastructure/sales-client/sales-order.client.ts`) calls `POST /internal/v1/orders/omnichannel` on `Sales` (`apps/sales/src/internal/internal-orders.controller.ts`) using `x-internal-token`, `X-Tenant-Id`, and deterministic `Idempotency-Key: omni-ord:${tenantId}:${connectionId}:${externalOrderId}`.
   - `Integration` never queries or mutates `Sales` (`orders`, `order_items`) or `Inventory` (`warehouse_stock_balances`, `stock_reservations`) database tables directly.
3. **Identified Gaps Resolved in This Vertical Slice:**
   - **Gap 1 — Missing Lazada Open Platform REST v2 HTTP Client:** `LazadaProviderAdapter` (`apps/integration/src/providers/lazada/lazada.adapter.ts`) previously only read from the in-memory `ProviderRateLimiterService` simulator and lacked a real HTTP client for Lazada's `GetOrders` (`/orders/get`), `GetOrder` (`/order/get`), and `GetOrderItems` (`/order/items/get`) endpoints.
   - **Gap 2 — Lazada Per-Unit `order_items` & Timestamp/Price Normalization:** Lazada Open Platform `GetOrders` returns order headers only, and `GetOrderItems` returns one `order_item` row per physical unit (each with its own `order_item_id`), formatted string prices (`"420,000.00"`), and timezone-offset date strings (`"2026-11-08 10:05:00 +0700"`).
   - **Gap 3 — Historical Orders Stock Deduction Policy Bug:** `OrderSyncService.importNormalizedOrder` (`apps/integration/src/modules/order-sync/order-sync.service.ts`) previously set `autoConfirm: normalizedOrder.normalizedStatus !== 'UNPAID'`, which evaluated to `true` for historical orders (`DELIVERED`, `SHIPPED`, `CANCELLED`, `RETURN_REQUESTED`) and caused `Sales` to reserve/deduct current warehouse stock again for already-completed or cancelled historical orders.
   - **Gap 4 — Manual Order Sync Window Parameters:** `TriggerConnectionSyncDto` (`POST /api/v1/integrations/connections/:id/sync/orders`) did not accept optional `windowStart` and `windowEnd` ISO-8601 bounds for targeted manual polling windows.

---

## 2. Implemented Changes

### 2.1. Secure Lazada Open Platform HTTP Client (`LazadaHttpClient`)
- **File:** `apps/integration/src/providers/lazada/lazada-http.client.ts`
- Implements the official Lazada Open Platform REST v2 signing and request protocol:
  - Collects system parameters (`app_key`, `access_token`, `timestamp` in epoch ms, `sign_method: 'sha256'`) and business query parameters.
  - Sorts all parameter keys ASCII ascending, concatenates `apiPath + key1 + val1 + key2 + val2 ...`, and computes uppercase hex `HMAC-SHA256(appSecret, baseString)` via `computeLazadaApiSignature`.
  - Executes `GetOrders` (`GET /orders/get`), `GetOrder` (`GET /order/get`), and `GetOrderItems` (`GET /order/items/get`), automatically enriching polled order headers with their line items.
  - Redacts `access_token`, `refresh_token`, and `sign` via `redactLazadaQueryUrl` so credentials never leak into error messages, logs, or dead-letter queue payloads.
  - Maps Lazada Open Platform error codes (`IllegalAccessToken`, `AccessTokenExpired`, `IncompleteSignature`, `ApiCallLimit`, HTTP 429/5xx, timeouts) to canonical `IntegrationDomainErrorCode` values (`CHANNEL_TOKEN_EXPIRED`, `CHANNEL_REAUTH_REQUIRED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT_UNKNOWN_OUTCOME`).

### 2.2. Lazada Adapter Normalization & Provider Integration (`LazadaProviderAdapter`)
- **Files:**
  - `apps/integration/src/providers/lazada/lazada.adapter.ts`
  - `apps/integration/src/domain/integration-domain.ts`
  - `apps/integration/src/modules/integration-core.module.ts`
- Enhances `LazadaProviderAdapter.normalizeOrderPayload`:
  - Consolidates multi-row Lazada `order_items` sharing `(externalItemId, externalSkuId, unitPrice)` into normalized order lines with summed `quantity` and `lineDiscount`.
  - Parses Lazada string prices (including comma-formatted strings such as `"420,000.00"`) into integer VND amounts via `roundVnd`.
  - Parses Lazada `updated_at` and `created_at` date strings in addition to `updated_at_sec`.
  - Combines `customer_first_name` and `customer_last_name` into `buyerName`.
  - Expands `LAZADA_STATUS_MAP` to cover Lazada Sandbox status aliases (`topack`, `toship`, `ready_to_ship_pending`, `shipping`, `failed`, `failed_delivery`, `lost_by_3pl`, `damaged_by_3pl`, `shipped_back`, `shipped_back_success`).

### 2.3. Manual Sync Endpoint & Historical Order Fulfillment Policy
- **Files:**
  - `apps/integration/src/modules/order-sync/order-sync.service.ts`
  - `apps/integration/src/modules/sync-jobs/sync-jobs.dto.ts`
  - `apps/integration/src/modules/sync-jobs/sync-jobs.controller.ts`
  - `apps/integration/src/modules/sync-jobs/sync-jobs.service.ts`
- **Historical Order Policy Enforcement:** `OrderSyncService.importNormalizedOrder` now sets `autoConfirm: normalizedOrder.normalizedStatus === 'READY_TO_SHIP'`. Historical orders (`DELIVERED`, `SHIPPED`, `CANCELLED`, `RETURN_REQUESTED`) and `UNPAID` orders are imported into `Sales` with `autoConfirm: false`, ensuring `Inventory` warehouse stock is never blindly deducted or reserved again.
- **Manual Synchronization Endpoint (`POST /api/v1/integrations/connections/:id/sync/orders`):** Accepts optional `windowStart`, `windowEnd`, `externalOrderId`, `idempotencyKey`, and `executeImmediately`, creating a durable `SyncJobEntity` and forwarding window bounds to `OrderSyncService.pollUpdatedOrdersForConnection`.

---

## 3. Exact Verification Commands & Evidence

Run the following commands from `/Users/mac/Desktop/SEM7/pbl6/pbl-api`:

```bash
# 1. Lazada HMAC-SHA256 signing, normalization & HTTP contract unit tests
npx jest apps/integration/src/providers/lazada/lazada.adapter.spec.ts --runInBand

# 2. All Integration microservice unit tests & DDD architecture guardrails
pnpm test:integration
pnpm test:arch

# 3. Real PostgreSQL Lazada Sandbox order sync vertical slice & M6 integration test suites
npx jest --config libs/events/test/jest-int.json \
  apps/integration/test/lazada-order-sync.int-spec.ts \
  apps/integration/test/integration.int-spec.ts \
  --runInBand --forceExit

# 4. Production TypeScript build verification for Integration microservice
pnpm build:integration
```

### Verified Test Results Summary
- **`apps/integration/src/providers/lazada/lazada.adapter.spec.ts`:** `PASS` (4/4 tests) — verifies official Lazada HMAC-SHA256 uppercase hex signature calculation over ASCII-sorted parameters, URL token/signature redaction, `GetOrders` + `GetOrderItems` HTTP contract & multi-row item consolidation, `GetOrder` + `GetOrderItems` single-order fetch, and Lazada error code mapping (`IllegalAccessToken`, `ApiCallLimit`).
- **`apps/integration/test/lazada-order-sync.int-spec.ts`:** `PASS` (3/3 end-to-end vertical slice tests against real PostgreSQL + signed Lazada HTTP server + Sales HTTP contract server):
  1. **Manual Sync + HMAC-SHA256 `GetOrders`/`GetOrderItems` + Duplicate Order Idempotency:** Verifies `POST /api/v1/integrations/connections/:id/sync/orders` creates a durable `SyncJob`, fetches and normalizes Lazada orders/items over signed HTTP, resolves `SkuMapping`, imports into `Sales` via `POST /internal/v1/orders/omnichannel`, and guarantees 100% idempotency (`replayed: true`, 1 `ChannelOrderRef`, 1 `Sales` order, 1 stock reservation) across repeated syncs and 10 concurrent imports.
  2. **Historical Orders Policy (`DELIVERED`, `SHIPPED`, `CANCELLED`):** Verifies historical Lazada orders are imported into `Sales` with `autoConfirm: false` and **zero** warehouse stock reservations/deductions.
  3. **Recoverable Missing SKU Mapping (`SKU_UNMAPPED`):** Verifies unmapped Lazada SKUs record `ChannelOrderRef.syncStatus = 'MAPPING_REQUIRED'` and an `OPEN` `SyncConflict` without fabricating products, payments, or reservations, and cleanly import into `Sales` once the operator maps the SKU and resolves the conflict.
- **`apps/integration/test/integration.int-spec.ts`:** `PASS` (11/11 tests).
- **`pnpm test:arch`:** `PASS` (9/9 architecture fitness suites, 85/85 tests).

---

## 4. Live Lazada API Verification Status (Honest Disclosure)

- **Local Signed HTTP Contract & Real PostgreSQL Integration:** **VERIFIED** (`lazada.adapter.spec.ts` and `lazada-order-sync.int-spec.ts`).
- **Live Lazada Cloud Sandbox / Production API Execution:** **PENDING AUTHORIZED SELLER TOKEN (`BLOCKED_NO_LIVE_SELLER_TOKEN`)**.
  - No live Lazada Open Platform `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, or authorized seller `access_token` was present in the local environment during this run, so live external calls to `https://api.lazada.vn/rest` were not claimed or executed.
  - To execute against a live Lazada Sandbox seller account once credentials are issued:
    1. Set `LAZADA_LIVE_ENABLED=true`, `LAZADA_API_BASE_URL=https://api.lazada.vn/rest`, `LAZADA_APP_KEY=<app_key>`, and `LAZADA_APP_SECRET=<app_secret>`.
    2. Create/update the Lazada `ChannelConnection` with the authorized seller `accessToken`, `refreshToken`, `partnerId` (`app_key`), and `webhookSecret` (`app_secret`).
    3. Trigger `POST /api/v1/integrations/connections/:id/sync/orders` with `{ "executeImmediately": true }`.
