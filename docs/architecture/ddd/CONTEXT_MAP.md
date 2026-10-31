# Context Map — SapoClone Bounded Context Relationships

## 1. Context Map Diagram

```mermaid
flowchart TB
  subgraph Generic["Generic Subdomain"]
    PLATFORM["Platform Context<br/>(Identity, Tenants, Branches, RBAC)"]
  end

  subgraph Core["Core Subdomains"]
    SALES["Sales Context<br/>(Orders, POS Shifts, Fulfillment, Returns)"]
    INVENTORY["Inventory Context<br/>(Warehouses, StockBalance, Reservations, WAC)"]
    INTEGRATION["Integration Context<br/>(Shopee/Lazada ACL, SKU Mapping, Stock Sync)"]
  end

  subgraph Supporting["Supporting Subdomains"]
    CATALOG["Catalog Context<br/>(Products, Variants, SKUs, Price Books)"]
    CUSTOMER["Customer Context<br/>(Profiles, Segments, Loyalty Ledger)"]
    FINANCE["Finance Context<br/>(Double-Entry Ledger, AR/AP, COD Settlement)"]
    INSIGHT["Insight Context<br/>(CQRS Analytical Read Models & Rollups)"]
  end

  EXT_MKT["External Marketplaces<br/>(Shopee Open Platform v2 / Lazada Open Platform)"]

  PLATFORM -->|"Published Language (JWT Claims / JWKS / Tenant & Branch Context)"| CATALOG
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| INVENTORY
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| SALES
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| CUSTOMER
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| FINANCE
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| INTEGRATION
  PLATFORM -->|"Published Language (JWT Claims / JWKS)"| INSIGHT

  CATALOG -->|"Published Language Events<br/>(catalog.product.*, catalog.variant.*)"| INVENTORY
  CATALOG -->|"Published Language Events<br/>(catalog.product.*, catalog.variant.*)"| SALES
  CATALOG -->|"Published Language Events"| INTEGRATION
  CATALOG -->|"Published Language Events"| INSIGHT

  SALES -->|"Customer-Supplier (Sync HTTP Reserve/Commit/Release + Events)"| INVENTORY
  INVENTORY -->|"Published Language Events<br/>(inventory.stock.changed, inventory.stock.received)"| INTEGRATION
  INVENTORY -->|"Published Language Events"| FINANCE
  INVENTORY -->|"Published Language Events"| INSIGHT

  SALES -->|"Published Language Events<br/>(sales.order.completed, sales.return.completed)"| CUSTOMER
  SALES -->|"Published Language Events<br/>(sales.order.completed, sales.return.completed)"| FINANCE
  SALES -->|"Published Language Events"| INTEGRATION
  SALES -->|"Published Language Events"| INSIGHT

  CUSTOMER -->|"Published Language Events<br/>(customer.profile.*, customer.loyalty.*)"| INSIGHT
  FINANCE -->|"Published Language Events<br/>(finance.posting.*, finance.settlement.*)"| INSIGHT
  INTEGRATION -->|"Published Language Events<br/>(integration.order.imported, integration.sync.failed)"| INSIGHT

  EXT_MKT <-->|"Anti-Corruption Layer (ACL)<br/>(ShopeeAdapter / LazadaAdapter + translateExternalOrderToCanonicalSalesImport)"| INTEGRATION
  INTEGRATION -->|"Customer-Supplier<br/>(Canonical Order Import Command / Event)"| SALES
```

---

## 2. Context Relationship Matrix

| Upstream Context | Downstream Context | DDD Relationship Pattern | Integration Mechanism | Protection / Anti-Corruption Strategy |
|---|---|---|---|---|
| `platform` | All 7 Business Services | **Open Host Service (OHS) + Published Language (PL)** | RS256 JWT + JWKS endpoint + `@pbl/auth` guard | Downstream services validate JWT signatures locally without calling Platform DB. |
| `catalog` | `inventory`, `sales`, `integration`, `insight` | **Published Language (PL)** | Outbox events (`catalog.product.created`, `catalog.variant.updated`) | `inventory` maintains local `catalog_sku_reference`; `sales` maintains `catalog_variant_snapshot`. |
| `inventory` | `sales` | **Customer–Supplier** | Sync HTTP (`ReserveStockDto`, `CommitReservationDto`) + Async Events | `Sales` uses `InventoryReservationPort` with timeout/circuit-breaker protection and idempotency keys. |
| `sales` | `customer`, `finance`, `insight` | **Published Language (PL)** | Outbox events (`sales.order.completed`, `sales.return.completed`) | Downstream consumers use `processed_events` inbox deduplication and pure domain calculators. |
| `inventory` | `integration`, `finance`, `insight` | **Published Language (PL)** | Outbox events (`inventory.stock.changed`, `inventory.stock.received`) | `integration` applies `shouldApplyInventoryStockVersion(currentVersion, incomingVersion)` to drop out-of-order stock updates. |
| External Shopee / Lazada APIs | `integration` | **Anti-Corruption Layer (ACL)** | `ShopeeAdapter`, `LazadaAdapter`, `translateExternalOrderToCanonicalSalesImport` | External provider payloads and status codes (`READY_TO_SHIP`, `packed`, `UNPAID`) never leak into `Sales` or `Inventory`. |
