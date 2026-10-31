# M1 Catalog Microservice — Architecture & Domain Ownership Specification

## 1. Service Ownership & Domain Boundaries

In accordance with **ADR-0010 (Eight-Service Decomposition)** and **ADR-0013 (Catalog M1 Domain & Pricing Boundaries)**, the `catalog` microservice (`apps/catalog`) is the single authoritative owner of product master data and base pricing within SapoClone:

| Capability | Owned by Catalog (`apps/catalog`) | Explicitly Excluded from Catalog |
|---|---|---|
| **Categories** | Hierarchical category tree (up to 3 levels), slug normalization, reparenting with cycle/depth validation | — |
| **Brands** | Tenant-scoped brand master data, normalized uniqueness, safe deactivation | — |
| **Attributes** | Variant attribute axes (`Color`, `Size`, `Material`) and allowed values | — |
| **Products** | Product master record, lifecycle (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`), image metadata, soft deletion | Physical stock, reserved stock, moving-average cost |
| **Variants & SKUs** | Sellable SKU definitions, GS1/EAN-13 & Code128 barcodes, Cartesian combination generation, canonical `combination_signature` | `avg_cost_price`, `total_quantity_for_cost`, `quantity_on_hand`, `quantity_reserved` (owned by **Inventory**) |
| **Units** | Product base unit and packaging unit conversions (`NUMERIC(18,4)`) | Warehouse bin conversions |
| **Pricing** | Catalog price lists (`PriceList`, `PriceListItem`) and deterministic variant price resolution | Coupon redemption, cart-level promotions, order line discounts (owned by **Sales**) |

## 2. Internal Hexagonal / Clean Architecture

`apps/catalog` enforces strict inward dependency direction (`Presentation → Application → Domain`):

```text
apps/catalog/
  src/
    main.ts                                      # Service bootstrap + OpenAPI (/api/docs & /api-docs)
    app.module.ts                                # NestJS root module wiring DB, Auth, Events, Tenancy
    domain/
      catalog-domain.ts                          # Pure domain invariants (0 NestJS/TypeORM/infra imports)
      catalog-domain.spec.ts                     # Pure domain unit tests
    infrastructure/
      persistence/
        catalog.entities.ts                      # TypeORM entities for Catalog schema
    migrations/
      1791900000200-create-catalog-tables.ts     # All 13 Catalog tables, partial indexes, FKs & FORCE RLS
    presentation/
      catalog-http-error.ts                      # Domain & PostgreSQL constraint -> HTTP error mapper
    modules/
      categories/                                # Category CRUD, tree, recursive CTE reparenting
      brands/                                    # Brand CRUD & safe deactivation
      attributes/                                # Attribute & AttributeValue CRUD
      products/                                  # Product, Variant, Cartesian generator, UnitConversion
      pricing/                                   # PriceList, PriceListItem upsert, deterministic price resolver
    catalog-architecture.spec.ts                 # Automated boundary & ownership guardrails
    app.e2e.spec.ts                              # HTTP, OpenAPI, Auth, RBAC & DTO validation tests
  test/
    catalog.int-spec.ts                          # Real PostgreSQL, non-superuser RLS, concurrency & demo suite
    performance/
      catalog-benchmark.ts                       # Reproducible p50/p95/p99 benchmark & EXPLAIN ANALYZE
```

## 3. Multi-Tenant Isolation & Defense-in-Depth

Catalog enforces three independent layers of tenant isolation (per **ADR-0008** and **ADR-0011**):

1. **Application Context & Repository Layer:**
   - Every HTTP request passes through `JwtAccessGuard`, `RequireStoreGuard`, and `RolesGuard`, binding the verified JWT `tid` claim into `RequestContext` / `TenantContext`.
   - `TenantScopedRepository` automatically injects `tenant_id = :__pbl_tenant_id` into all queries and verifies tenant ownership before every write.
2. **Composite Tenant-Aware Foreign Keys:**
   - Every child table (`categories`, `attribute_values`, `products`, `product_variants`, `variant_attribute_values`, `unit_conversions`, `price_list_items`, `combo_items`, `price_list_channels`, `price_list_customer_groups`) declares composite foreign keys `(tenant_id, <fk_id>) REFERENCES <parent>(tenant_id, id)`, making cross-tenant entity linking impossible at the database constraint level.
3. **PostgreSQL `FORCE ROW LEVEL SECURITY`:**
   - Migration `1791900000200-create-catalog-tables.ts` calls `enableTenantRlsPolicy` (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) on all 13 Catalog tables using `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
   - Every service read and write executes inside `runInTenantTransaction` / `TenantScopedRepository.transaction`, which binds `SELECT set_config('app.tenant_id', $1, true)` transaction-locally (`is_local = true`).

## 4. Event-Driven Integration & Transactional Outbox

All state-changing operations on products, variants, and price lists write domain events to `outbox_event` (`EventOutbox`) within the **same PostgreSQL transaction** as the domain mutation:

- `catalog.product.created` (`v1`)
- `catalog.product.updated` (`v1`)
- `catalog.product.deactivated` (`v1`)
- `catalog.variant.created` (`v1`)
- `catalog.variant.updated` (`v1` — includes `previousSkuCode` when SKU is updated)
- `catalog.variant.deactivated` (`v1`)
- `catalog.price.changed` (`v1` — includes `previousPrice`, `price`, `currency`, `effectiveFrom`, `effectiveTo`)

## 5. Deferred M2/M3 Entities

In accordance with Section 4 of the specification and **ADR-0013**, the database tables for `combo_items`, `price_list_channels`, and `price_list_customer_groups` are provisioned with full composite tenant foreign keys and RLS policies in `1791900000200-create-catalog-tables.ts`, while their public HTTP orchestration endpoints are explicitly deferred to M2/M3 once `integration` (sales channels) and `customer` (customer groups) services are online.
