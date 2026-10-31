# M6 Integration ERD & PostgreSQL Schema Design

## 1. Entity-Relationship Diagram

Implemented in [`1791900000200-create-m6-integration-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/migrations/1791900000200-create-m6-integration-core.ts) and [`integration.entities.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/infrastructure/persistence/integration.entities.ts).

```mermaid
erDiagram
  channel_connections ||--o| connection_credentials : "has encrypted credentials"
  channel_connections ||--o{ webhook_inbox_events : "receives webhooks"
  channel_connections ||--o{ sku_mappings : "maps variations"
  channel_connections ||--o{ channel_order_refs : "tracks imported orders"
  channel_connections ||--o{ channel_inventory_publications : "publishes stock"
  channel_connections ||--o{ sync_jobs : "schedules jobs"
  channel_connections ||--o{ sync_conflicts : "records conflicts"
  channel_connections ||--o{ reconciliation_runs : "audits drift"
  sku_mappings ||--o{ channel_inventory_publications : "governs stock push"
  reconciliation_runs ||--o{ reconciliation_issues : "detects discrepancies"

  channel_connections {
    uuid id PK
    uuid tenant_id
    varchar code
    varchar provider "SHOPEE | LAZADA"
    varchar connection_key UK
    varchar external_shop_id
    uuid branch_id
    uuid warehouse_id
    varchar status
    int safety_stock_buffer
    int stock_allocation_percent
    int version
  }

  connection_credentials {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    int credential_version
    text encrypted_access_token
    text encrypted_refresh_token
    text encrypted_webhook_secret
    varchar refresh_lease_owner
    timestamptz refresh_lease_expires_at
  }

  webhook_inbox_events {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    varchar provider
    varchar deduplication_key
    varchar event_type
    varchar external_order_id
    varchar payload_hash
    text encrypted_payload
    varchar processing_status
  }

  sku_mappings {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    varchar external_item_id
    varchar external_sku_id
    varchar external_sku_code
    uuid internal_variant_id
    varchar internal_sku_code
    int mapping_version
    varchar status
  }

  channel_order_refs {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    varchar external_order_id
    uuid internal_order_id
    varchar sync_status
    varchar normalized_status
    int status_rank
    jsonb mapping_snapshot
  }

  channel_inventory_publications {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    uuid mapping_id FK
    uuid internal_variant_id
    int target_published_qty
    int last_confirmed_qty
    bigint stock_version
    bigint last_published_stock_version
    varchar status
  }

  sync_jobs {
    uuid id PK
    uuid tenant_id
    uuid connection_id FK
    varchar job_type
    varchar idempotency_key
    varchar status
    int priority
    int attempt_count
    int max_attempts
    timestamptz next_retry_at
    varchar lease_owner
    timestamptz lease_expires_at
  }
```

## 2. Row-Level Security (RLS) & Composite Uniqueness

All 15 domain and projection tables in [`1791900000200-create-m6-integration-core.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/migrations/1791900000200-create-m6-integration-core.ts) enforce PostgreSQL Row-Level Security (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) via `enableTenantRlsPolicy`:
- Composite tenant foreign keys `FOREIGN KEY ("tenant_id", "connection_id") REFERENCES channel_connections ("tenant_id", "id")` make cross-tenant reference injection structurally impossible at the database level.
- Public webhook routing uses a dedicated `FOR SELECT` RLS policy (`webhook_routing_select_policy`) on `channel_connections` scoped to `current_setting('app.webhook_connection_key', true)`, after which `WebhooksService` immediately binds `app.tenant_id` from the verified connection row.
