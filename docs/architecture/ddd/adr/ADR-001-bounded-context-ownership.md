# ADR-001: Eight Bounded Contexts & Strict PostgreSQL Schema Ownership

- **Status:** Accepted (Verified in M7.5)
- **Date:** 2026-10-31

## Context
SapoClone covers multi-tenant retail identity, product catalog, multi-warehouse inventory, omnichannel/POS sales, customer CRM/loyalty, double-entry finance, marketplace integrations (Shopee/Lazada), and analytical reporting. Sharing tables or joining across domains creates tight schema coupling, deployment lockstep, and ambiguous invariant ownership.

## Decision
1. Partition the backend into 8 autonomous Bounded Contexts (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`), each mapped to an independent NestJS application under `apps/<service>` and its own dedicated PostgreSQL schema.
2. Prohibit cross-service source imports (`Rule A`) and cross-schema SQL queries/joins (`Rule E`).
3. Enforce PostgreSQL Row-Level Security (`enableTenantRlsPolicy`) on all tenant-owned tables (`Rule I`).

## Consequences
- **Positive:** Any microservice can evolve its internal schema or scale independently without breaking other services.
- **Negative / Trade-off:** Cross-context reference data (`catalog_sku_projection` in Inventory, `catalog_variant_snapshot` in Sales) must be synchronized via domain events.
