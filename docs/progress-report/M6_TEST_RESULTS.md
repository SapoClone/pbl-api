# M6 Integration Automated Test Results

## 1. Test Execution Summary

| Suite | File | Runner | Result |
|---|---|---|---|
| **Domain Unit Suite** | [`integration-domain.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.spec.ts) | Jest | **11 / 11 Passed** |
| **Hexagonal Architecture Suite** | [`integration-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/integration-architecture.spec.ts) | Jest | **5 / 5 Passed** |
| **HTTP Controllers, RBAC & Raw-Body Webhook E2E** | [`app.e2e.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/app.e2e.spec.ts) | Jest + Supertest | **6 / 6 Passed** |
| **Real-PostgreSQL Integration, Concurrency & Fault-Injection (Tests A–T)** | [`integration.int-spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/test/integration.int-spec.ts) | Jest (`jest-int.json`) | **10 / 10 Passed (All 20 Mandatory Scenarios A–T)** |

## 2. Mandatory Test Coverage Matrix (Section 27)

| ID | Mandatory Scenario | Verified Outcome |
|---|---|---|
| **Test A** | Duplicate webhook storm (100 concurrent identical webhooks) | 1 `WebhookInboxEventEntity`, 99 `deduplicated: true`, 1 canonical Sales order, 1 `ChannelOrderRefEntity` |
| **Test B** | Webhook and polling race | Concurrent webhook + `pollUpdatedOrdersForConnection` converge on 1 canonical Sales order |
| **Test C** | Unknown SKU in external order | `MAPPING_REQUIRED` on `ChannelOrderRefEntity` + `SKU_UNMAPPED` conflict; zero fake variants or reservations |
| **Test D** | Insufficient stock | Canonical Sales order created in `PENDING` (`SHORTAGE_HOLD`) + `STOCK_INSUFFICIENT` conflict; stock never negative |
| **Test E** | Webhook signature failure | Rejected with `401 INVALID_WEBHOOK_SIGNATURE`; security audit logged (`WEBHOOK_VERIFICATION_REJECTED`) with zero secret leakage |
| **Test F** | Webhook persistence failure | Simulated DB failure returns `503 WEBHOOK_PERSISTENCE_FAILED`, never false `200 OK` |
| **Test G** | Out-of-order order statuses | `READY_TO_SHIP` after `SHIPPED` ignored (`IGNORE_STALE`); `CANCELLED` after `DELIVERED` flagged as `ORDER_STATE_CONFLICT` |
| **Test H** | Token refresh race (10 concurrent workers) | Advisory lock + `credentialVersion` CAS ensures exactly 1 refresh commits (`refreshedWinners = 1, skippedLosers = 9`) |
| **Test I** | Rate-limit storm (HTTP 429) | Job transitions to `RETRY_SCHEDULED` respecting `Retry-After` (`>= 4s`) |
| **Test J** | Provider timeout after stock write | Publication recorded as `UNKNOWN_OUTCOME` and auto-recovered by `executeReconciliationRun` |
| **Test K** | Stale stock publication | Version `15` (`qty = 30`) followed by stale version `12` (`qty = 90`) skips version `12` (`STALE_SKIPPED`) |
| **Test L** | Multi-tenant webhook load (20 concurrent tenants) | Zero cross-tenant leakage; each tenant sees only its own connection and inbox row |
| **Test M** | Worker crash after job lease claim | Expired `RUNNING` job lease (`lease_expires_at <= NOW()`) reclaimed by healthy worker B and completed once |
| **Test N** | DLQ replay | Unmapped order job moves to `DEAD_LETTERED`, SKU mapping created, `retrySyncJob` replays to `COMPLETED` and marks DLQ `REPLAYED` |
| **Test O** | Credential leakage check | `connection_credentials` stores `v1:...` AES-256-GCM ciphertext; API views & logs contain zero plaintext secrets |
| **Test P** | Cross-tenant mapping attack | Tenant B attempting to map Tenant A's `internalVariantId` rejected with `404 INTERNAL_VARIANT_NOT_FOUND` |
| **Test Q** | Lost webhook | Missed webhook order discovered and imported once by `pollUpdatedOrdersForConnection` |
| **Test R** | Mapping change during import | In-flight `IMPORTING` order preserves captured `mappingSnapshot` (`variantV1`) after mapping is updated to `variantV2` |
| **Test S** | Integration crash after Sales success | Reconciliation recovers existing canonical Sales order via deterministic idempotency key without duplicate creation |
| **Test T** | Simultaneous inventory updates burst | 20 rapid updates coalesced via `coalesceInventoryBurstAndPublish` so only latest version `20` (`qty = 80`) is published |
