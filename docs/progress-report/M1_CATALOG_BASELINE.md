# M1 Catalog Microservice — Baseline Audit Report

- **Date:** 2026-10-29
- **Service:** `apps/catalog` (`@pbl/catalog`)
- **Milestone:** M1 — Catalog Core (Categories, Brands, Attributes, Products, Variants, Unit Conversions, Base Pricing)
- **Status:** Baseline Audit Complete (Pre-Implementation)

---

## 1. Executive Summary

Prior to M1 implementation, `apps/catalog` existed purely as a **15-line HTTP bootstrap stub** (`apps/catalog/src/main.ts` and `apps/catalog/src/app.module.ts`) created during the eight-service decomposition ([ADR-0010](../decisions/0010-eight-services.md)). It exposed only `/health`, `/health/live`, and `/health/ready`, had **zero database tables or migrations**, **zero domain entities**, **zero business endpoints**, and only one gateway route (`/catalog/health` in `krakend/krakend.json`).

At the same time, the repository already possessed a mature, production-tested shared microservice foundation (`@pbl/common`, `@pbl/auth`, `@pbl/contracts`, `@pbl/events`) verified across `platform`, `inventory`, `sales`, and `insight`.

---

## 2. Repository & Infrastructure Audit (14-Point Inspection)

| # | Area | Baseline Finding | Status |
|---|---|---|---|
| 1 | **Catalog implementation status** | Only `apps/catalog/src/main.ts`, `apps/catalog/src/app.module.ts`, and `apps/catalog/src/app.e2e.spec.ts` exist. No `migrations/`, no domain modules, no controllers. | **Missing (Stub Only)** |
| 2 | **NestJS application boundaries** | Monorepo (`nest-cli.json`) with 8 independent apps: `platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`. Enforced by `libs/common/src/architecture-boundaries.spec.ts`. | **Implemented & Tested** |
| 3 | **ORM & SQL tooling** | TypeORM `0.3.20` + `pg 8.13.1`. `PblDatabaseModule.forRoot({ entities, migrations })` in `@pbl/events` with `synchronize: false` and explicit SQL migrations. | **Implemented & Tested** |
| 4 | **Migration system** | `initializeDatabase()` in `libs/events/src/database/pbl-database.module.ts` acquires a PostgreSQL advisory lock (`pg_advisory_lock(hashtext('pbl:migrate:catalog'))`), creates schema if missing, and runs TypeORM migrations atomically. | **Implemented & Tested** |
| 5 | **PostgreSQL schema & tenant isolation** | Schema-per-service (`DATABASE_SCHEMA=catalog`). Application-level scoping via `TenantScopedRepository` + transaction-local `SET LOCAL app.tenant_id` (`runInTenantTransaction`) + PostgreSQL `ENABLE/FORCE ROW LEVEL SECURITY` (`enableTenantRlsPolicy`) + non-superuser `NOBYPASSRLS` runtime role `catalog_app` (`provisionServiceRole`, [ADR-0011](../decisions/0011-rls-and-db-role-isolation.md)). | **Foundation Ready; Not Yet Wired in Catalog** |
| 6 | **JWT authentication** | Platform issues RS256 access tokens (`iss: platform`, `aud: pbl6`, claims `sub`, `sid`, `tid`, `roles`) and serves `/.well-known/jwks.json`. Downstream services use `PblAuthModule.forRemoteJwks()` ([ADR-0004](../decisions/0004-authentication-and-tokens.md)). | **Implemented & Tested** |
| 7 | **RBAC enforcement** | `AuthGuard` in `@pbl/auth` enforces valid JWT, active `tid` (tenant context), and `@RequireRoles(...)` against `ROLES` (`owner`, `manager`, `cashier`). | **Implemented & Tested** |
| 8 | **KrakenD Gateway routes** | `krakend/krakend.json` only declares `GET /catalog/health -> http://catalog:3000/health`. All `/catalog/api/v1/*` routes are missing. | **Missing** |
| 9 | **Shared technical packages** | `@pbl/common` (v1.1.0), `@pbl/auth` (v1.0.0), `@pbl/contracts`, `@pbl/events`. | **Implemented & Tested** |
| 10 | **OpenAPI conventions** | `bootstrapService()` mounts Swagger at `/api-docs` per service; Platform mounts unified system Swagger at `/api-docs` via `apps/platform/src/utils/microservices-openapi.ts`. | **Implemented; Catalog Endpoints Needed** |
| 11 | **Outbox / Event infrastructure** | `PblEventsModule.forRoot({ service: 'catalog' })` provides `EventOutbox` (transactional outbox table `outbox_events`), `OutboxRelayService` (SNS/SQS publisher with exponential backoff), and `ProcessedEventEntity` inbox. `TOPOLOGY` in `@pbl/contracts` does not yet list `catalog` producer events. | **Foundation Ready; Catalog Events Missing** |
| 12 | **Unit, Integration & E2E test setup** | Unit/E2E via `pnpm test:catalog` (`jest apps/catalog/src`); real PostgreSQL + ElasticMQ integration tests via `pnpm test:int` (`libs/events/test/jest-int.json`). | **Implemented; `apps/catalog/test` Not Yet in `jest-int.json`** |
| 13 | **Docker & CI/CD** | `docker-compose.yml` runs Postgres 16 (`:25432`), Redis 7 (`:6379`), ElasticMQ (`:9324`), KrakenD (`:8080`), and service containers. Multi-stage `Dockerfile` builds any service via `ARG SERVICE`. | **Implemented & Tested** |
| 14 | **Catalog API consumers** | `docs/specs/2026-10-10-catalog-commerce-roadmap.md` specifies mobile/web product screens (`name`, `sku`, `barcode`, `category`, `brand`, `salePrice`, `variants`, `attributes`, `status`) and downstream `inventory` / `sales` variant references. | **Documented** |

---

## 3. Reference Documents Reconciled

1. **`SapoClone_v2_architecture_spec.md`**:
   - Confirms Catalog owns 13 original entities across Product Master, Variants, Units, Product Pricing, and Combo Definition.
   - Explicitly mandates: **Remove `ProductVariant.avg_cost_price` and `total_quantity_for_cost` as authoritative data** (Inventory owns cost valuation and stock quantities).
   - Explicitly mandates: `PriceListChannel.channel_id` and `PriceListCustomerGroup.customer_group_id` are external logical references, never cross-service SQL foreign keys.
2. **`SapoClone_v2_entity_ownership.csv`**:
   - Lists all 13 Catalog entities (`Category`, `Brand`, `Attribute`, `AttributeValue`, `Product`, `ProductVariant`, `VariantAttributeValue`, `ComboItem`, `UnitConversion`, `PriceList`, `PriceListChannel`, `PriceListCustomerGroup`, `PriceListItem`) and their v2 architectural decisions.
3. **`Sapo Clone — ERD Viewer (1).html`**:
   - Inspected the `Catalog` Mermaid `erDiagram` definition containing the 13 baseline entities and their v1 columns.
4. **`docs/specs/2026-10-10-catalog-commerce-roadmap.md` & `docs/conventions/api-conventions.md`**:
   - Reconciled URL conventions (`/api/v1/<resource>` inside service, `/catalog/api/v1/<resource>` on KrakenD), error envelope (`statusCode`, `errorCode`, `message`, `details`, `timestamp`, `traceId`), and role-based access control.

---

## 4. Feature-by-Feature Baseline Status (13 Catalog Entities & Capabilities)

| Entity / Capability | ERD v1 Status | Target M1 Decision | Baseline Status |
|---|---|---|---|
| **1. `Category`** | `id`, `tenant_id`, `parent_id`, `name`, `slug` | Full M1 implementation: max depth 3, cycle prevention, recursive CTE subtree reparenting with `FOR UPDATE` locking, tenant-scoped root/sibling slug & name uniqueness, safe deactivation policy (`CATEGORY_IN_USE` guard). | **Missing** |
| **2. `Brand`** | `id`, `tenant_id`, `name` | Full M1 implementation: tenant-scoped normalized name uniqueness, CRUD + status deactivation preserving historical product references. | **Missing** |
| **3. `Attribute`** | `id`, `tenant_id`, `name` | Full M1 implementation: tenant-scoped normalized name uniqueness (e.g. `Color`, `Size`, `Material`), CRUD. | **Missing** |
| **4. `AttributeValue`** | `id`, `tenant_id`, `attribute_id`, `value` | Full M1 implementation: composite tenant FK to `Attribute`, unique normalized value per attribute. | **Missing** |
| **5. `Product`** | `id`, `tenant_id`, `category_id`, `brand_id`, `name`, `description`, `base_unit`, `is_combo`, `status`, `created_at` | Full M1 implementation: lifecycle (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`), optimistic locking (`version`), controlled image metadata (max 10 images), automatic default sellable variant when created without options, soft delete (`deleted_at`). | **Missing** |
| **6. `ProductVariant`** | Included `avg_cost_price` & `total_quantity_for_cost` in ERD v1 (violates v2 boundary) | Full M1 implementation **without** `avg_cost_price` / `total_quantity_for_cost` / stock fields. Tenant-scoped `UNIQUE(tenant_id, sku_code)` and `UNIQUE(tenant_id, barcode)`, EAN-13 checksum validation, canonical `combination_signature` uniqueness per product, controlled SKU update with `catalog.variant.updated` event. | **Missing** |
| **7. `VariantAttributeValue`** | `tenant_id`, `variant_id`, `attribute_value_id` | Full M1 implementation: includes `attribute_id` with `UNIQUE(tenant_id, variant_id, attribute_id)` at DB level to forbid two values of the same attribute on one variant. | **Missing** |
| **8. `UnitConversion`** | `id`, `tenant_id`, `product_id`, `unit_name`, `conversion_factor`, `is_base` | Full M1 implementation: positive `NUMERIC(18,4)` conversion factor (`> 0`), single canonical base unit per product, unique normalized unit name per product. | **Missing** |
| **9. `PriceList`** | `id`, `tenant_id`, `name`, `start_date`, `end_date`, `is_default` | Full M1 implementation: `currency` (`VND` default), `status` (`ACTIVE`/`INACTIVE`), partial unique index `UNIQUE(tenant_id) WHERE is_default = true AND status = 'ACTIVE'` preventing concurrent default price-list races, optimistic locking (`version`). | **Missing** |
| **10. `PriceListItem`** | `tenant_id`, `price_list_id`, `variant_id`, `price` | Full M1 implementation: `NUMERIC(18,2)` non-negative price, `UNIQUE(tenant_id, price_list_id, variant_id)`, deterministic price resolution (`GET /api/v1/variants/:id/price`), emits `catalog.price.changed`. | **Missing** |
| **11. `ComboItem`** | `tenant_id`, `combo_variant_id`, `child_variant_id`, `quantity` | **Explicitly Deferred to M2/M3** (P8 in roadmap) pending Inventory bundle component reservation semantics. Schema table created with composite tenant FKs and self-reference cycle check; no partial public API exposed. | **Deferred (Documented)** |
| **12. `PriceListChannel`** | `tenant_id`, `price_list_id`, `channel_id` | **Explicitly Deferred to M3/M4** pending SalesChannel & Integration precedence rules (`channel_id` is external logical UUID, no cross-schema FK). | **Deferred (Documented)** |
| **13. `PriceListCustomerGroup`** | `tenant_id`, `price_list_id`, `customer_group_id` | **Explicitly Deferred to M3/M4** pending CustomerGroup loyalty/tier resolution rules (`customer_group_id` is external logical UUID, no cross-schema FK). | **Deferred (Documented)** |
| **Transactional Outbox & Events** | Not wired in `apps/catalog` | Full M1 implementation: `catalog.product.created`, `catalog.product.updated`, `catalog.product.deactivated`, `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated`, `catalog.price.changed` (v1) registered in `@pbl/contracts` `TOPOLOGY`. | **Missing** |
| **PostgreSQL RLS & `catalog_app` Role** | Not wired in `apps/catalog` | Full M1 implementation: `ENABLE/FORCE ROW LEVEL SECURITY` on all tenant-owned Catalog tables + `catalog_app` role verification. | **Missing** |
