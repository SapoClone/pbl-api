# Phase 4: catalog screen endpoints

Gap list: `docs/specs/2026-10-31-reconciliation/catalog.md`. Contract: `docs/specs/2026-10-28-api-contracts/02-catalog-inventory.md`.
Their routes and shapes are untouched; everything below is additive. Gateway path = `/catalog` + the service path.

## Route table

All are new routes. Gateway entries are needed for each (none exist yet); the gateway path is `/catalog/api/v1/...`.

| Method | Path (service) | Permission (any of) | Covers |
|---|---|---|---|
| GET | `/api/v1/products/summary` | `products.view` | summary row (13:325 counts) |
| GET | `/api/v1/products/export` | `products.view` | export row (CSV, UTF-8 BOM, max 10,000 rows) |
| GET | `/api/v1/variants` | `products.view`, `pos.create`, `orders.create`, `inventory.view`, `inventory.create`, `purchasing.create` | picker row; also the variant-row table for 13:325 |
| DELETE | `/api/v1/variants/{id}` | `products.delete` | variant DELETE row (204) |
| POST | `/api/v1/uploads/images` | `products.create`, `products.update` | uploads row (metadata, 201) |
| POST | `/api/v1/uploads/imports` | `products.create` | CSV upload registration for imports (extra, contract says "like images") |
| PUT | `/api/v1/uploads/{id}/content` | `products.create`, `products.update` | the `uploadUrl` target; raw body, `Content-Type` = declared type (extra) |
| POST | `/api/v1/product-imports` | `products.create` | imports row (202) |
| GET | `/api/v1/product-imports/{id}` | `products.create` | imports row |

Gateway notes: all carry the `auth/validator` block. `PUT .../content` forwards a binary body: keep `no-op` encoding, add `Content-Type` and `Content-Length` to `input_headers` if not whitelisted, and add `PUT` to CORS `allow_methods` if missing. Export needs `Content-Disposition` in the backend response headers passed through (no-op does this) and in CORS `expose_headers` for browser downloads.

## Shape additions

- `GET /variants` returns `{ data, pagination }` (`limit, currentPage, nextPage?, totalRecords, totalPages`). Row: `variantId, productId, name, label ("500ml / Xanh sage" from the attribute values, else null), skuCode, barcode, imageUrl (variant image, else product cover), category {id,name}|null, price (integer VND), avgCostPrice (always null, inventory owns cost, ADR-0013), status (lower case)`. Query: `q` (name, SKU, barcode, case-insensitive, LIKE wildcards escaped), `barcode` (exact), `ids` (comma list, max 100), `status` (case-insensitive), `categoryId`, `sort=createdAt|name|price|skuCode`, `order`, `page`, `limit` (default 10, max 100). Soft-deleted variants and variants of deleted products are excluded.
- Summary: `{productCount, variantCount, activeVariantCount, inactiveVariantCount}`. Inactive = every live variant that is not ACTIVE (INACTIVE and ARCHIVED).
- Export columns: `name, variant, skuCode, barcode, category, price, status`; takes the `GET /variants` filters. Cells starting with `= + - @ TAB CR` get a leading `'`. Above 10,000 rows: 400 `EXPORT_LIMIT_EXCEEDED`.
- `POST/PATCH /products` accept optional `imageIds` (uuid[], max 10, order kept, first = cover). It resolves the uploads into `products.images` (`{key, url, sortOrder}`) and marks them ATTACHED; it wins over `images` when both are sent. Unknown, still-pending or other-tenant ids: 400 `UPLOAD_INVALID`.
- Upload response: `{imageId, uploadUrl, uploadHeaders, publicUrl, expiresAt}`. `uploadUrl` is the relative gateway path `/catalog/api/v1/uploads/{id}/content` (15 min). `publicUrl` = `${CATALOG_ASSET_BASE_URL or /static}/t/<tenant>/p/<id>.<ext>`. Only png/jpeg, 1 byte to 5 MB (422 otherwise); PUT body must have the declared content type and at most the declared size (422), a second PUT is 409.
- Import: CSV columns `name, skuCode, price` required, `barcode, baseUnit, category` optional (category = existing category name). Per row: SKU found among live variants then `basePrice`/barcode updated, else a product with a default variant is created. Result `{id, status: processing|completed|failed, created, updated, errors:[{row,message}]}`; `row` is the spreadsheet row (header = 1). Row errors do not stop the import; a missing column, over 1,000 rows or a missing stored file set `failed` with a `row: 0` error. Price must be a whole number of VND.
- New error codes (descriptive style of the service): `UPLOAD_NOT_FOUND` 404, `UPLOAD_INVALID` 400/409/422, `IMPORT_NOT_FOUND` 404, `EXPORT_LIMIT_EXCEEDED` 400.
- New tables in the baseline migration (edited in place, RLS enabled+forced, `down` drops them): `uploads`, `product_imports` (composite FK to `uploads`). Entities added to `CATALOG_ENTITIES`.
- Storage: `FILE_STORAGE` interface (`put/get/delete`) with `LocalDiskFileStorage` (`CATALOG_UPLOAD_DIR`, default `<tmp>/pbl-catalog-uploads`) and `InMemoryFileStorage` (`CATALOG_STORAGE_DRIVER=memory`). No storage existed. Keys are built from uuids and path traversal is refused. No cloud SDK.

## Contract mismatches left

- `GET /products` keeps their product-row shape `{items,page,limit,total,nextCursor}`, `status` upper case, `q` on name only. The screen's variant-row table is served by `GET /variants` instead (the screen must call that, or the contract path `/products` be repointed by the gateway/web).
- Status values on their routes stay `DRAFT/ACTIVE/INACTIVE/ARCHIVED`; `GET /variants` and the summary use the contract's lower case.
- Error codes stay descriptive strings, not `C001..C015`.
- `POST /products` body (attributes with valueIds, `variants[]`, `channels`, `initialStock`, `lowStockThreshold`) is not reshaped; their `basePrice`/`defaultBasePrice`, `generate` route stay. Only `imageIds` was added.
- `GET /products/{id}` has no `channels`, `avgCostPrice`, `category`/`brand` objects.
- `DELETE /variants/{id}` keeps the SKU reserved: their `UQ_product_variants_tenant_sku` and `UQ_product_variants_product_combo_sig` are not partial on `deleted_at`, so a deleted SKU or attribute combination cannot be reused. Same for product delete. Making them partial is a migration decision for the owner.
- `GET /categories` response shape (`productCount`), `POST /categories` duplicate error `C008` vs their codes: not touched.

## Deferred

- C006 (variant or product delete refused when stock on hand or open orders exist): needs inventory/sales data; catalog does not call them. DELETE currently always succeeds (archives, emits deactivated).
- `available` / `stockLevel` / `stock=` filter / `branchId` on the variant rows: inventory-owned; web should merge `GET /inventory/api/v1/stock?variantIds=...`.
- `channel` filter, `channels` array and `hasMemberPrice` on rows: no channel listing table in their model (`price_list_channels` exists but is price-list based). Not invented.
- `avgCostPrice`: always null until inventory events carry cost (catalog stores none, ADR-0013).
- C005 plan quota (platform `TenantUsage`), `initialStock`/`lowStockThreshold` forwarding in `catalog.variant.created`.
- Real object storage: presigned S3 URLs, a static host/CDN serving `publicUrl`, expiry cleanup of unattached uploads (24 h). Today bytes are on local disk; nothing serves `publicUrl`.
- Imports run in-process in the request's process (no queue, a restart loses a running import and leaves it `processing`); update does not change name/category/base unit of an existing SKU.

## Events added

None. `DELETE /variants/{id}` emits the existing `catalog.variant.deactivated` (status `ARCHIVED`) through the outbox in the same transaction; the contract's `catalog.variant.deleted` was not added because inventory's projection already treats deactivated as removal and no subscriber needs the distinction. Imports emit the existing created/updated events per row via `createProduct`/`updateVariant`. `events.ts` and `topology.ts` untouched.

## Decisions to review

1. `GET /variants` doubles as the product table source (extra `sort`, `status`, `categoryId`) instead of changing `GET /products`.
2. Variant delete = soft delete + status ARCHIVED + `catalog.variant.deactivated` (no new event, no stock check).
3. Upload PUT goes through catalog itself (relative `uploadUrl`) because there is no object store; swap `FILE_STORAGE` plus the controller PUT for presigned URLs later.
4. `imageIds` override `images` when both are sent.
5. Inventory read-permissions in the picker: `inventory.view` added next to the contract's `inventory.create` to match the existing `/products/lookup`.
6. No new permission codes.

## How verified

- `tsc -p apps/catalog/tsconfig.app.json --noEmit`: clean. `eslint apps/catalog`: clean. `prettier --check apps/catalog`: clean.
- `jest apps/catalog/src`: 5 suites, 104 tests passed (new: permission matrix for all 9 routes incl. 403 and owner pass, 422 validation for picker/uploads/imports/imageIds, summary/export routed before `:id`, export headers and BOM, raw PUT body, `csv.spec.ts`, `file-storage.spec.ts`).
- Integration against own Postgres (container `cat-p4-pg` on 25611, removed; non-superuser role, FORCE RLS): `catalog.int-spec.ts` 13 passed (table list updated to 15 tables), new `catalog-screens.int-spec.ts` 12 passed: variant list filters/sort/pagination, summary, CSV export incl. formula guard, variant delete with outbox event, cross-tenant isolation (list, summary, delete, export, upload, import), upload flow and errors, `imageIds` attach/replace/refusals, imports (create, update, row errors, double-import refused, failed on missing column).
- `libs/contracts` jest: 10 passed (no contract edits).
