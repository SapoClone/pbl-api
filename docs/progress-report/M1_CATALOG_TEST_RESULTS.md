# M1 Catalog Microservice — Test Verification Results

## 1. Test Execution Summary

| Suite | Command | Test Files | Tests | Status |
|---|---|---|---|---|
| **Catalog Unit, Architecture & HTTP E2E** | `pnpm test:catalog` | `3 passed, 3 total` | `30 passed, 30 total` | **PASS** |
| **Catalog Real PostgreSQL Integration, RLS, Concurrency & Demo** | `npx jest --config libs/events/test/jest-int.json apps/catalog/test/catalog.int-spec.ts` | `1 passed, 1 total` | `13 passed, 13 total` | **PASS** |
| **Shared Libraries (`@pbl/common`, `@pbl/auth`, `@pbl/contracts`, `@pbl/events`)** | `pnpm test:libs` | `17 passed, 17 total` | `124 passed, 124 total` | **PASS** |
| **Platform Service (including Unified OpenAPI)** | `pnpm test:platform` | `46 passed, 46 total` | `155 passed, 155 total` | **PASS** |

---

## 2. Detailed Coverage by Verification Category

### 2.1. Pure Domain Invariant Tests (`apps/catalog/src/domain/catalog-domain.spec.ts`)
- Whitespace and case normalization (`normalizeName`) and Vietnamese diacritic-safe URL slug generation (`normalizeSlug`).
- SKU code normalization and validation (`normalizeSku`).
- GS1 / EAN-13 check-digit verification (`verifyGs1Checksum`, `isValidEan13`) and barcode normalization (`validateAndNormalizeBarcode`).
- Canonical sorted `combination_signature` construction (`buildCombinationSignature`) and rejection of multiple values for the same attribute on a single variant (`Color=Black` + `Color=White` -> `INVALID_VARIANT_COMBINATION`).
- Cartesian product variant generation (`generateCartesianVariantSpecs`) and upper-bound enforcement (`> 100` combinations -> `VARIANT_GENERATION_LIMIT_EXCEEDED`).
- Category hierarchy reparenting validation (`validateCategoryReparent`) rejecting self-parenting, cycles into descendants (`CATEGORY_CYCLE_DETECTED`), and subtree depth exceeding 3 (`CATEGORY_DEPTH_EXCEEDED`).
- Precision-safe decimal money parsing (`parseAndFormatMoney`) without binary floating-point drift, and unit conversion factor validation (`parseAndFormatConversionFactor`).
- Product & variant lifecycle state machine transitions (`validateProductLifecycleTransition`, `validateVariantWithProductLifecycle`).
- Deterministic sellable price resolution (`resolveVariantPrice`: `PRICE_LIST` -> `DEFAULT_PRICE_LIST` -> `VARIANT_BASE_PRICE`).

### 2.2. Architectural Boundary Tests (`apps/catalog/src/catalog-architecture.spec.ts`)
- Confirms `apps/catalog/src` never imports code from any other microservice (`apps/platform`, `apps/inventory`, `apps/sales`, `apps/customer`, `apps/finance`, `apps/integration`, `apps/insight`).
- Confirms `apps/catalog/src` never queries or writes another service's PostgreSQL schema.
- Confirms `ProductVariantEntity` and `1791900000200-create-catalog-tables.ts` exclude Inventory-owned cost and stock columns (`avg_cost_price`, `total_quantity_for_cost`, `quantity_on_hand`, `quantity_reserved`).
- Confirms `catalog-domain.ts` has zero imports from `@nestjs/*`, `typeorm`, `../infrastructure`, or `../presentation`.

### 2.3. HTTP, OpenAPI, Authentication & RBAC Tests (`apps/catalog/src/app.e2e.spec.ts`)
- Health (`/health`) and readiness (`/health/ready`) endpoints and `X-Request-Id` header propagation.
- OpenAPI 3.0 specification generation at `/api/docs-json` and `/api-docs-json`.
- Unauthenticated request rejection (`401 Unauthorized`) and missing store claim rejection (`403 Forbidden`).
- RBAC enforcement: `cashier` allowed on read/lookup/resolvePrice endpoints (`200`) and denied on mutations (`403`); `owner` and `manager` allowed on all mutations (`201`/`200`).
- DTO validation errors (`422 Unprocessable Entity`).

### 2.4. Real PostgreSQL, Non-Superuser RLS, Concurrency & Business Demo (`apps/catalog/test/catalog.int-spec.ts`)
- **Non-Superuser Runtime Role (`provisionServiceRole`):** Connects all Catalog services as a `NOSUPERUSER NOBYPASSRLS` PostgreSQL role and verifies all 13 Catalog tables have `relrowsecurity = true` and `relforcerowsecurity = true`.
- **End-to-End Business Demo (Section 15):** Executes the full Tenant A (`Fashion Store A`) and Tenant B (`Fashion Store B`) workflow including category hierarchy (`Clothing -> T-Shirts`), brand (`Local Basic`), product (`Áo thun cotton nam`), Cartesian 4-variant generation (`TSHIRT-BLK-M/L`, `TSHIRT-WHT-M/L`), EAN-13 barcode assignment (`8934563123451`), default price list, SKU/barcode lookup, product/price updates, variant deactivation, outbox event persistence, and Tenant B isolation + SKU reuse.
- **Concurrency & Transactional Rollback (Section 13.3):**
  1. Concurrent duplicate SKU creation -> 1 succeeds, 1 fails with `409 SKU_ALREADY_EXISTS`.
  2. Concurrent active default price list creation -> 1 succeeds, 1 fails with `409 PRICE_LIST_CONFLICT`.
  3. Concurrent duplicate variant attribute combination -> 1 succeeds, 1 fails with `409 VARIANT_COMBINATION_EXISTS`.
  4. Stale optimistic `version` update -> fails with `409 RESOURCE_VERSION_CONFLICT`.
  5. Mid-batch collision during `generateVariants` -> complete transaction rollback (0 partial variants and 0 outbox events persisted).
