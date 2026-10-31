# M6 Integration Demo & Verification Guide

## 1. Automated Verification Commands

Run all M6 Integration verification suites from `/Users/mac/Desktop/SEM7/pbl6/pbl-api`:

```bash
# 1. Build Platform and Integration microservices
pnpm nest build platform && pnpm nest build integration

# 2. Run M6 Domain Unit, Hexagonal Architecture & HTTP/RBAC/Webhook E2E Tests
npx jest apps/integration/src

# 3. Run M6 Real-PostgreSQL Integration, Concurrency & Fault-Injection Suite (Mandatory Tests A-T)
npx jest --config libs/events/test/jest-int.json apps/integration/test/integration.int-spec.ts

# 4. Run M6 Real-PostgreSQL High-Volume Performance & EXPLAIN ANALYZE Benchmark
npx ts-node -r tsconfig-paths/register apps/integration/test/performance/integration-benchmark.ts
```

## 2. End-to-End Omnichannel Walkthrough

1. **Create Shopee Connection:** `POST /api/v1/integrations/connections` with `provider: "SHOPEE"`, `externalShopId`, `branchId`, `warehouseId`, and partner secrets. Returns a sanitized connection view with `connectionKey` (`ck_shopee_...`) and AES-256-GCM encrypted credentials at rest.
2. **Map External Variation to Internal Catalog Variant:** `POST /api/v1/integrations/sku-mappings` linking `(externalItemId, externalSkuId)` to an active internal `variantId`.
3. **Send Signed Marketplace Webhook:** `POST /webhooks/v1/shopee/:connectionKey` with `Authorization: HMAC-SHA256(webhookSecret, webhookUrl + "|" + rawBody)`. Persists to `webhook_inbox_events` and enqueues an `ORDER_IMPORT` sync job.
4. **Inspect Conflict & Resolution Flow:** Send an order with an unmapped SKU, inspect `GET /api/v1/integrations/conflicts`, resolve via `POST /api/v1/integrations/conflicts/:id/resolve` (providing `internalVariantId` and `retryOrderImport: true`), and verify the order transitions from `MAPPING_REQUIRED` to `IMPORTED`.
5. **Trigger Omnichannel Reconciliation:** `POST /api/v1/integrations/reconciliation-runs` to audit missed webhooks, stuck `IMPORTING` orders, and `UNKNOWN_OUTCOME` stock publications.
