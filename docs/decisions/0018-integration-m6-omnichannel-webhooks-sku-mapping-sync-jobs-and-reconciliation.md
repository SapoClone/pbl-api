# ADR-0018: M6 Integration & Omnichannel Architecture — Provider Adapters, Durable Webhooks, SKU Mapping, Sync Jobs & Reconciliation

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** SapoClone Architecture Team
- **Milestone:** M6 — Integration & Omnichannel Core (`apps/integration`)

---

## 1. Context and Problem Statement

Retail merchants using SapoClone sell across physical POS stores and external e-commerce marketplaces (Shopee, Lazada). Milestone M6 requires implementing `apps/integration` as the authoritative boundary for:
1. Managing multi-tenant marketplace channel connections and encrypted OAuth/partner credentials.
2. Ingesting external provider webhooks with cryptographic signature verification, replay protection, and durable persistence before HTTP acknowledgment.
3. Maintaining authoritative external-to-internal SKU mappings (`sku_mappings`) with versioned snapshots and conflict workflows (`SKU_UNMAPPED`, `SKU_INACTIVE`, `STOCK_INSUFFICIENT`).
4. Importing and normalizing marketplace orders into canonical `Sales` orders via idempotent commands (`ChannelOrderRef`) without directly mutating `Sales` or `Inventory` databases.
5. Publishing sellable inventory quantities to connected marketplaces with per-channel safety buffers, stale-version protection, coalescing, rate limiting, and circuit breakers.
6. Executing durable background `SyncJob` workflows with PostgreSQL lease locking (`FOR UPDATE SKIP LOCKED`), bounded exponential backoff with jitter, dead-letter queues (DLQ), and operational reconciliation runs.

---

## 2. Architectural Decisions

### 2.1 Hexagonal Provider Capability Abstraction
Instead of a monolithic `IntegrationService` with `if (provider === 'SHOPEE')` branches, provider-specific logic is isolated behind explicit capability contracts in `apps/integration/src/providers/contracts/provider.contracts.ts`:
- `ChannelAuthAdapter`: OAuth URL generation, code exchange, token refresh, shop verification.
- `WebhookVerificationAdapter`: Provider-specific raw-body cryptographic signature verification, timestamp replay window check, and envelope extraction.
- `OrderFetchAndNormalizationAdapter`: External order detail fetching, canonical order normalization, and external-to-internal status transition mapping.
- `InventoryPublicationAdapter`: External stock update payload formatting and execution.
- `ProductListingAdapter`: External catalog listing discovery and metadata synchronization.

Separate concrete adapter suites are implemented for **Shopee Open Platform v2** (`providers/shopee/*`) and **Lazada Open Platform** (`providers/lazada/*`), registered in `ProviderRegistryService`.

### 2.2 Envelope Encryption for Provider Credentials & Lease-Based Token Refresh
- Access tokens, refresh tokens, and webhook signing secrets are never stored in plaintext or returned in API responses.
- `CredentialCryptoService` encrypts secret payloads using **AES-256-GCM** with random 96-bit IVs, authenticated tags, and key version metadata (`key_version`), storing only ciphertext in `connection_credentials`.
- Concurrent token refreshes use a short-lived database lease (`refresh_lease_owner`, `refresh_lease_expires_at`) and optimistic `credential_version` compare-and-swap so that:
  1. No database transaction is held open across an external provider HTTP call.
  2. Two workers detecting an expired token simultaneously do not overwrite a newer token with a stale one or trigger duplicate provider refresh calls.

### 2.3 Two-Tier Inbox Architecture (`webhook_inbox_events` vs `inbox_event`)
- `inbox_event` (owned by `@pbl/events`) deduplicates internal domain events from SNS/SQS (`catalog.variant.*`, `inventory.stock.*`, `sales.order.*`).
- `webhook_inbox_events` (owned by `apps/integration`) durably stores verified external marketplace webhooks with `UQ(tenant_id, connection_id, deduplication_key)` before HTTP 200 is returned to the provider.
- If database persistence fails during webhook ingestion, the endpoint returns HTTP 500/503 so the marketplace provider retries delivery rather than losing the event.

### 2.4 Versioned SKU Mapping & Immutable Order Import Snapshots
- `sku_mappings` enforces `UQ(tenant_id, connection_id, external_item_id, external_sku_id)` and tracks `mapping_version`.
- When an order is imported, `channel_order_refs` records the resolved `mapping_snapshot` (including `mapping_version` and `internal_variant_id` per line). Subsequent edits to a `SkuMapping` increment `mapping_version` and never retroactively mutate historical imported orders.
- If an external order contains an unmapped or inactive SKU, `channel_order_refs` is persisted in `MAPPING_REQUIRED` status and a durable `sync_conflicts` record (`SKU_UNMAPPED` / `SKU_INACTIVE`) is created without creating phantom variants or false inventory reservations.

### 2.5 Idempotent Canonical Order Import & Lost-Response Recovery
- `OrderSyncService` imports orders into `Sales` using deterministic idempotency keys (`tenantId + connectionId + externalOrderId`).
- Before invoking `Sales`, `OrderSyncService` upserts `channel_order_refs` in `IMPORTING` state. If `Sales` succeeds but `Integration` crashes before saving `internal_order_id`, replay re-sends the exact same `(sourceConnectionId, externalOrderId)` to `Sales`, which returns the existing canonical order (`replayed: true`), allowing `Integration` to heal `channel_order_refs` to `IMPORTED` with zero duplicate orders.
- Out-of-order external status updates are guarded by monotonic status rank rules (`UNPAID -> READY_TO_SHIP -> SHIPPED -> DELIVERED / CANCELLED`), preventing stale webhooks from rolling an order backward.

### 2.6 Coalesced & Version-Guarded Inventory Publication
- `InventorySyncService` maintains `integration_stock_projections` from `inventory.stock.changed` events (tracking `source_version` / `source_occurred_at`).
- Sellable quantity for a channel connection is computed as:
  $$\text{Published Qty} = \max\left(0, \left\lfloor (\text{Available Qty} - \text{Safety Buffer}) \times \frac{\text{Allocation Percent}}{100} \right\rfloor\right)$$
- `channel_inventory_publications` tracks `last_published_stock_version`. If version 11 is processed before version 10, version 10 is rejected as stale (`STALE_SKIPPED`), and rapid bursts of stock updates coalesce into the latest intended quantity.

### 2.7 Lease-Locked Sync Jobs, Rate Limiter, Circuit Breaker & DLQ
- `sync_jobs` uses `FOR UPDATE SKIP LOCKED` with worker lease expiration (`lease_owner`, `lease_expires_at`) so crashed workers' jobs are safely reclaimed after lease expiry.
- `ProviderRateLimiterService` enforces per-provider and per-connection token-bucket quotas and sliding-window circuit breakers (`CLOSED -> OPEN -> HALF_OPEN`). HTTP 429 responses schedule jittered exponential backoff respecting `Retry-After`.
- Exhausted jobs transition to `DEAD_LETTERED` and insert an auditable record into `integration_dead_letter_events`, supporting authorized operator replay after root-cause resolution.

---

## 3. Consequences

- **Positive:** Complete tenant isolation via PostgreSQL RLS on all 16 M6 tables; zero cross-service database coupling; deterministic protection against duplicate webhooks, token refresh races, stale stock updates, and lost HTTP responses.
- **Operational Clarity:** Live Shopee/Lazada external network calls are explicitly separated from deterministic adapter/simulator verification and reported as `BLOCKED_NO_CREDENTIALS` when partner sandbox credentials are not provisioned in the environment.
