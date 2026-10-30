# M6 Integration & Omnichannel Microservice — Final Engineering Report

## 1. Executive Summary

Milestone **M6 — Integration & Omnichannel Core (`apps/integration`)** has been implemented end-to-end in `/Users/mac/Desktop/SEM7/pbl6/pbl-api`, delivering:
- **Hexagonal Marketplace Provider Adapters:** Concrete adapters for **Shopee Open Platform v2** ([`shopee.adapter.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/shopee/shopee.adapter.ts)) and **Lazada Open Platform** ([`lazada.adapter.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/lazada/lazada.adapter.ts)) with real HMAC-SHA256 request signing and raw-body webhook signature verification.
- **Explicit Live-Provider Honesty:** Live external partner API calls are explicitly reported as `BLOCKED_NO_CREDENTIALS` when official Shopee/Lazada partner sandbox credentials (`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`) are not provisioned in the environment.
- **15 RLS-Protected PostgreSQL Tables:** Implemented in [`1791900000200-create-m6-integration-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/migrations/1791900000200-create-m6-integration-core.ts) with composite tenant foreign keys, AES-256-GCM credential encryption at rest, durable webhook inbox, SKU mappings, order refs, inventory publications, sync jobs, conflicts, DLQ, and reconciliation tables.
- **Complete Verification:**
  - `apps/integration/src/*.spec.ts`: **3 suites, 22 / 22 tests passed**.
  - `apps/integration/test/integration.int-spec.ts`: **10 / 10 real-PostgreSQL integration tests passed** covering all **20 Mandatory Scenarios A–T**.
  - `apps/integration/test/performance/integration-benchmark.ts`: Webhook ingestion `p95 = 21.56 ms`, batch SKU lookup `p95 = 4.85 ms`, order import `p95 = 17.72 ms`, and `FOR UPDATE SKIP LOCKED` job claiming `p95 = 18.00 ms`.
