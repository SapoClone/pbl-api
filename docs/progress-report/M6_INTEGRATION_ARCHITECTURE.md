# M6 Integration Architecture — Hexagonal Omnichannel & Marketplace Core

## 1. Architectural Overview

The **Integration Microservice (`apps/integration`)** is the authoritative anti-corruption layer and omnichannel orchestrator between SapoClone's internal domain services (`Catalog`, `Inventory`, `Sales`, `Finance`, `Insight`) and external e-commerce marketplaces (**Shopee Open Platform v2** and **Lazada Open Platform**).

```mermaid
flowchart TB
  subgraph External["External Marketplaces"]
    SHP["Shopee Open Platform v2"]
    LAZ["Lazada Open Platform"]
  end

  subgraph Gateway["API Gateway (KrakenD)"]
    PUB["Public Webhook Ingress\n/integration/webhooks/v1/:provider/:connectionKey"]
    AUTH["Authenticated REST API\n/integration/api/v1/integrations/*"]
  end

  subgraph Integration["Integration Microservice (apps/integration)"]
    WH["WebhooksService\nRaw-Body HMAC + Replay Window + Durable Inbox"]
    CONN["ConnectionsService\nOAuth State + AES-256-GCM Credentials + Token Lease/CAS"]
    MAP["SkuMappingService\nExplicit & Exact-SKU Mapping + Version Snapshots"]
    ORD["OrderSyncService\nNormalization + Monotonic Rank + Idempotent Sales Intake"]
    INV["InventorySyncService\nSellable Math + Version Guard + Burst Coalescing"]
    JOBS["SyncJobsService\nFOR UPDATE SKIP LOCKED + Jittered Backoff + DLQ"]
    REC["ReconciliationService\nOrder/Stock/DLQ Drift Detection & Auto-Recovery"]
    ADAPT["Hexagonal Provider Adapters\n(ShopeeProviderAdapter / LazadaProviderAdapter)"]
    RL["ProviderRateLimiterService\nToken Bucket + Circuit Breaker + Request Audit Log"]
  end

  subgraph Internal["Internal SapoClone Microservices"]
    CAT["Catalog Service (M1)"]
    INVS["Inventory Service (M2)"]
    SAL["Sales Service (M3)"]
    INS["Insight Service (M7)"]
  end

  SHP -->|Signed Webhook| PUB --> WH
  LAZ -->|Signed Webhook| PUB --> WH
  AUTH --> CONN & MAP & JOBS & REC
  WH -->|Enqueue Durable Job| JOBS
  JOBS --> ORD & INV & CONN
  ORD --> ADAPT --> RL
  INV --> ADAPT --> RL
  ORD -->|Idempotent Order Intake| SAL
  CAT -->|catalog.variant.*| Integration
  INVS -->|inventory.stock.changed| Integration
  Integration -->|integration.* Outbox Events| INS
```

## 2. Strict Microservice Ownership Boundaries

| Boundary | Owned by Integration (`apps/integration`) | Never Owned / Mutated by Integration |
|---|---|---|
| **Marketplace Connections & Credentials** | `channel_connections`, `connection_credentials` (AES-256-GCM envelope encryption, token refresh leases, `credential_version` CAS) | Platform IAM accounts, employee roles, tenant subscriptions |
| **Webhook Ingress** | `webhook_inbox_events` (cryptographic verification, 5-minute replay window, idempotent deduplication) | Unverified direct mutations to Sales or Inventory |
| **SKU Mapping** | `sku_mappings`, `integration_catalog_variants` read projection | Master Catalog products/variants (`apps/catalog`) |
| **Omnichannel Order Sync** | `channel_order_refs` (external-to-internal order reference, monotonic status rank, immutable mapping snapshot) | Canonical `orders`, `order_lines`, or financial postings (`apps/sales`, `apps/finance`) |
| **Inventory Availability Publication** | `channel_inventory_publications`, `integration_stock_projections` read projection | Authoritative warehouse `stock_balances` or `stock_ledger` (`apps/inventory`) |
| **Background Jobs, Conflicts & Reconciliation** | `sync_jobs`, `sync_conflicts`, `integration_dead_letter_events`, `reconciliation_runs`, `reconciliation_issues` | Cross-service analytical data marts (`apps/insight`) |

## 3. Hexagonal Provider Abstraction

Provider-specific payloads, URLs, and cryptographic rules are strictly isolated behind [`MarketplaceProviderAdapter`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/contracts/provider.contracts.ts):
- [`ShopeeProviderAdapter`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/shopee/shopee.adapter.ts)
- [`LazadaProviderAdapter`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/lazada/lazada.adapter.ts)
- [`ProviderRegistryService`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/providers/provider-registry.service.ts)
- Architectural boundary enforcement is verified automatically in [`integration-architecture.spec.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/integration-architecture.spec.ts).
