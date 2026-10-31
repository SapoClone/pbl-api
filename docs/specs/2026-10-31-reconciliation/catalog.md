# Reconciliation: catalog service

THEIRS = `WT/apps/catalog` (WT = scratchpad `wt17`, M1). MINE = `apps/catalog`. Counts are by grep unless noted; "not verified" = I did not run it.

## 1. Scope and size

| | Theirs | Mine |
|---|---|---|
| Source lines (src, incl. specs) | about 6,300 (`wc -l` of `src/*/*.ts`, `src/*/*/*.ts`) | about 3,200 |
| HTTP routes (decorators) | 39 (products 15, categories 8, pricing 6, brands 5, attributes 5) | 23 (products 9, variants 3, categories 4, brands 4, attributes 3) |
| Tables | 13 (`categories, brands, attributes, attribute_values, products, product_variants, variant_attribute_values, unit_conversions, price_lists, price_list_items, combo_items, price_list_channels, price_list_customer_groups`) | 8 (`category, brand, attribute, attribute_value, product, product_variant, product_image, product_channel_listing`) |
| Migrations | 1 (`1791900000200-create-catalog-tables`) | 1 (`1792000000000-create-catalog-tables`, reversible) |
| Unit and HTTP spec files | 3: `app.e2e.spec.ts` (9 `it`), `catalog-architecture.spec.ts` (4), `domain/catalog-domain.spec.ts` (17) = 30 | 2: `app.e2e.spec.ts` (12 `it`, plus table-driven cases), `products/variant-generation.spec.ts` (6); my report says 82 tests run |
| Integration | 1 file, 13 `it` (`test/catalog.int-spec.ts`) | 1 file, 12 `it` |
| E2E against real stack | none in either | none |
| Other | `test/performance/catalog-benchmark.ts`, 9 docs `M1_*.md`, ADR-0013 | none |

Only theirs: price lists with deterministic resolver (`GET /variants/:id/price`, `PUT /price-lists/:id/items`), unit conversions, category tree and reparent (recursive CTE), product lifecycle DRAFT/ACTIVE/INACTIVE/ARCHIVED, optimistic `version` column, keyset cursor, GS1/EAN-13 checksum validation, `combination_signature` unique per product, composite tenant FKs, FORCE RLS, transactional outbox with 7 `catalog.*` events, architecture-boundary spec, benchmark, OpenAPI.
Only mine: contract list shape (one row per variant, `{data, pagination}`), `/products/summary`, `/products/export` (CSV, BOM, formula-injection guard), `GET /variants` picker (`q`, exact `barcode|sku`, `ids`), channel listings per variant (`channels` strings), product images table with cover/sort, status cascade, soft delete freeing SKU/barcode, `PERMISSION`-based auth (ADR-0020), contract error codes C001..C015 with 409.

## 2. Contract coverage (catalog part of `02-catalog-inventory.md`, 20 endpoints/groups)

| Contract endpoint | Theirs | Mine |
|---|---|---|
| GET /products (variant rows, `{data,pagination}`, `stock`, `channel`, `branchId`, `sort`) | Different: `GET /products` returns product rows `{items,page,limit,total,nextCursor}` (`products.service.ts:61`), filters `q,status,categoryId,brandId,sort=createdAt|name|updatedAt`; no channel/stock/price sort/`variantLabel`/`available` | Same path, variant rows, `{data,pagination}`; no `available/stockLevel` (deferred) |
| GET /products/summary | Missing | Covered |
| POST /products (variants, attributes, imageIds, channels, initialStock) | Different: body `images[{url}]`, `basePrice` string, `skuPrefix` generation via separate `POST /products/:id/variants/generate`; no `channels`, `initialStock`, `lowStockThreshold`, `imageIds` | Covered except `imageIds`/`initialStock`/`lowStockThreshold`/C005 |
| GET /products/{id} | Different shape: includes `unitConversions`, `images` as jsonb meta; no `channels`, `avgCostPrice` | Covered (attributes derived from variants, no ids) |
| PATCH /products/{id} | Covered by path; body has `version` locking; status via separate `PATCH /products/:id/status` | Covered |
| DELETE /products/{id} | Covered path (soft); C006 stock check not done (my check: not verified in theirs) | Covered (no C006) |
| POST /products/{id}/variants | Covered path; body `basePrice` string, `attributes` | Covered |
| PATCH /variants/{id} | Covered path; plus `PATCH /variants/:id/status` | Covered |
| DELETE /variants/{id} | Missing (only status to ARCHIVED/INACTIVE) | Covered |
| GET /variants (picker) | Different: `GET /products/lookup` (exact sku/barcode, one result) and `GET /products/:id/variants`; no list/search `q`/`ids` | Covered |
| POST /uploads/images | Missing | Missing |
| GET/POST /categories | Covered path; response shape not verified against contract; plus `/tree` | Covered |
| PATCH/DELETE /categories/{id} | Covered path (plus `/status`, `/reparent`) | Covered |
| GET/POST /brands | Covered path | Covered |
| GET/POST /attributes, POST /attributes/{id}/values | Covered path (plus PATCH, GET values) | Covered |
| GET /products/export | Missing | Covered |
| POST /product-imports, GET /product-imports/{id} | Missing | Missing |

Counts (20 rows above, my reading): theirs same path and shape 0 verified; same path with different shape 4 (list, create, detail, variant create); same path, shape not checked 8; different path 1 (picker); missing 7 (summary, variant DELETE, export, uploads, imports x2, plus picker has no equivalent list). Mine: 17 covered, 3 missing (uploads, product-imports x2); also no `available/stockLevel`, events, C005, C006.
Theirs, not needed by the contract (26): all `price-lists*` (5) and `variants/:id/price`, `products/lookup`, `products/:id/status`, `products/:id/variants/generate`, `products/:id/variants` GET, `variants/:id` GET, `variants/:id/status`, `products/:id/units` (2), `categories/tree`, `categories/:id` GET, `categories/:id/status`, `categories/:id/reparent`, `brands/:id` GET, `attributes` PATCH, `attributes/:id/values` GET. (Price lists and unit conversion are roadmap items not in this contract; useful for sales pricing.)

## 3. Data model and compatibility

| Aspect | Theirs | Mine |
|---|---|---|
| Table names | plural (`products`, `product_variants`) | singular (`product`, `product_variant`) |
| Variant attributes | `variant_attribute_values` rows + `combination_signature` | jsonb `attributes [{name,value}]` on variant |
| SKU unique | `UQ_product_variants_tenant_sku (tenant_id, sku_code)`, NOT partial: a soft-deleted variant keeps its SKU | partial unique `WHERE deleted_at IS NULL`; same for barcode |
| Barcode unique | partial on non-null only, includes deleted rows | partial, live rows only |
| Barcode validation | GS1/EAN-13 checksum in domain | none I saw (not verified) |
| Money | `numeric(18,2)`, DTO `basePrice` string | `bigint` integer VND (`price`), `weight` grams; matches CLAUDE.md |
| Avg cost | deliberately absent from catalog (ADR-0013) | `avg_cost_price bigint` nullable (contract: inventory emits cost, catalog stores) |
| Soft delete | `deleted_at` on products and variants | `deleted_at` on product, variant |
| Readable codes | none besides SKU | none |
| Images | jsonb array on product (max 10 CHECK), `image_url` on variant | table `product_image` (cover, sort, optional `variant_id`) |
| Channel listings | `price_list_channels` (route deferred) | `product_channel_listing (variant_id, channel, is_listed)` |
| Status | DRAFT/ACTIVE/INACTIVE/ARCHIVED upper-case | active/inactive style per contract (lower case in API; not verified in DB) |
| Version | `version int` on product/variant | none |
| Category | depth <= 3 CHECK, slug, `normalized_name` unique per parent | name unique per parent (expression index), cycle check C014 |

Conflict if both in schema `catalog`: same migration timestamp prefix not an issue, but both create tables named `category`/`categories` etc. only if names equal; names differ (singular vs plural) so they would coexist as two sets of tables, with duplicated data, not a clash. TypeORM `migrations` table: two different migration classes both named `CreateCatalogTables…` (different timestamps) would both run on one DB. Real conflicts are semantic: the money type, the SKU uniqueness and the API shape, so only one set can be live.

## 4. Tenancy and authorization

| | Theirs | Mine |
|---|---|---|
| Tenant filter | `TenantScopedRepository` + `runInTenantTransaction` sets `app.tenant_id` local (`app.module.ts` `TenancyModule.forFeature`) | `TenantScopedRepository` (`@InjectTenantScopedRepository`, `products.service.ts:150`) |
| RLS | ENABLE + FORCE on all 13 tables via `enableTenantRlsPolicy` (`@pbl/events`, migration) | None (no `enableTenantRlsPolicy` anywhere in my libs or apps) |
| DB role | per-service `catalog_app` NOSUPERUSER NOBYPASSRLS, provisioned in `libs/events/src/database/pbl-database.module.ts:109-130`; ADR-0019 (theirs) | single role as configured by env; not RLS-enforced |
| Cross-tenant | tenant-scoped repo and RLS; int test as non-superuser (their doc, not run by me) | repo-scoped; int test: 404 on get/update/delete, SKU reusable in tenant B |
| Authorization | `@RequireRoles(ROLES.OWNER, ROLES.MANAGER[, ROLES.CASHIER])` on every route, role names in the token | `@RequirePermission('products.view|create|update|delete')`; `GET /variants` any-of `products.view, pos.create, orders.create, inventory.view` |
| Move theirs to mine | Mechanical: replace each `@RequireRoles` (39 sites): reads -> `products.view`, POST -> `products.create`, PATCH/PUT -> `products.update`, DELETE -> `products.delete`. Their `libs/auth` has no `@RequirePermission`, no `permissions.ts`; the whole lib differs from mine (`libs/auth/src/*`, `libs/contracts/src/permissions.ts` only in mine), so the lib must be mine. Price lists need new codes (e.g. `products.update`) |
| Branch scope | not applicable (catalog is store-wide); same on both | same |

## 5. Cross-service

| | Theirs | Mine |
|---|---|---|
| Publishes | `catalog.product.created/updated/deactivated`, `catalog.variant.created/updated/deactivated`, `catalog.price.changed` via `EventOutbox.add` in the same transaction (`products.service.ts:292,329,606,668,689`; `pricing.service.ts:364,389`). Variant payload: `{variantId, productId, skuCode, barcode, name, basePrice, status, isDefault, aggregateVersion, updatedAt}`: lacks `variantLabel`, `imageUrl`, `price` (named `basePrice`) from the contract payload | none (deferred) |
| Consumes | none | none |
| Internal calls | none (architecture spec forbids) | none |
| Libs changed | `libs/contracts/src/events.ts` (CATALOG_* events, lines 421-452), `topology.ts`, `libs/events` (outbox, database module, RLS), `libs/common` (errors, tenancy, bootstrap, health), `libs/auth` (rewritten). A tree-wide diff of `libs` shows these all differ from mine; which of the differences come from catalog vs other services not verified | `libs/auth` and `libs/contracts` RBAC |

## 6. Quality signals

| Convention | Theirs | Mine |
|---|---|---|
| `qualifiedTable` for raw SQL | Violated in catalog: `categories.service.ts:244,359` build `schemaPrefix + "categories"` by hand from `dataSource.options.schema` (migration does use `qualifiedTable`) | Used in migration; service uses repositories |
| Error shape `{statusCode,error,errorCode,message}` | Domain errors carry `errorCode` (`catalog-http-error.ts:100`); codes are descriptive strings (`SKU_ALREADY_EXISTS`), not contract `C001..` | `errorCode` with contract codes (C001 etc.), 409 for duplicates |
| Pagination `{data, pagination}` | Violated: `{items,page,limit,total,nextCursor}` (`products.service.ts:61`) | Followed |
| camelCase, ISO dates | camelCase; ISO dates in events | followed |
| Integer VND | Violated: `numeric(18,2)`, `basePrice` as string (`products.dto.ts:323,489`) | Followed |
| 404 for foreign tenant | Not verified by me; RLS plus scoped repo make it likely | int-tested |
| Mixed approach | Raw `em.query` in 7+ places in `categories.service.ts` (`FOR UPDATE`, recursive CTE), parameterized | n/a |

Risks seen: (a) SKU and barcode unique constraints include soft-deleted rows (migration `1791900000200`, `UQ_product_variants_tenant_sku`, `UQ_product_variants_tenant_barcode`): a deleted SKU cannot be reused; (b) `q` filter on products uses `normalized_name LIKE` only (`products.service.ts:~370`): no SKU or barcode search in the list; (c) no `DELETE /variants`; (d) variant payload misses contract fields, so inventory's `variant_projection` would need rework. Not verified: their runtime behaviour, their test pass counts (taken from `M1_CATALOG_TEST_RESULTS.md`: 30 unit, 13 int).

## 7. Assessment

Adopting THEIRS costs me: re-do RBAC on 39 routes and bring my `libs/auth` over theirs or keep mine; re-do the screen contract: variant-row list with `{data,pagination}`, summary, export, `GET /variants` picker, variant DELETE, channels, images as rows, integer VND (a migration of money columns and DTOs), status mapping, 409/`C0xx` codes, partial unique indexes; port my 82 unit and 12 int tests; re-create the 22 gateway routes (theirs adds ~39 paths, `products/lookup` etc.). Estimate: about 2-3 days (unverified estimate).
Adopting MINE costs them: lose price lists, units, tree/reparent, lifecycle, optimistic locking, RLS and outbox events; their sales/inventory code that calls price resolution and consumes `catalog.*` events (not checked in this report) would need rework.
Unique value, theirs: RLS with NOBYPASSRLS role, outbox events, price lists and resolver, EAN-13 validation, composite tenant FKs, 13 tables for later sales pricing. Mine: exact contract shapes for the Figma screens, integer VND, partial uniques, CSV export, picker, RBAC permissions.

Recommendation: keep MINE as the API surface (contract shapes, integer VND, permissions) and port from THEIRS three things: `enableTenantRlsPolicy` on my 8 tables, the outbox events (with the contract payload plus `variantLabel`, `imageUrl`, `price`), and later the price-list module with its tables. Reason: the contract gaps in theirs are in the response shapes and money type, which change every client call, while the things I lack (RLS, events) are additive and isolated in the migration and service write paths. Open point: table names (singular vs plural) must be decided once, since inventory/sales migrations from theirs may reference catalog tables only through events, not FKs (not verified).
