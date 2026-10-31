# Catalog service: first-wave report

**Date:** 2026-10-29. **Contract:** [02-catalog-inventory.md](../2026-10-28-api-contracts/02-catalog-inventory.md) (catalog part).
Code: `apps/catalog/src` (entities, one migration, `taxonomy/`, `products/`), tests in `apps/catalog/src/*.spec.ts` and `apps/catalog/test/catalog.int-spec.ts`.

## Built

| Endpoint (under `/catalog/api/v1`) | Roles |
|---|---|
| `GET/POST /categories`, `PATCH/DELETE /categories/{id}` | read: all roles; write: owner, manager |
| `GET/POST /brands`, `PATCH/DELETE /brands/{id}` | same |
| `GET/POST /attributes`, `POST /attributes/{id}/values` | same |
| `GET /products` (one row per variant), `GET /products/summary`, `GET /products/export` (CSV) | all roles |
| `POST /products`, `PATCH /products/{id}`, `DELETE /products/{id}` (soft), `GET /products/{id}` | read: all; write: owner, manager |
| `POST /products/{id}/variants`, `PATCH /variants/{id}`, `DELETE /variants/{id}` | owner, manager |
| `GET /variants` (`q`, exact `barcode` or `sku`, `ids`, `status`, `categoryId`) | all roles |

Tables (schema `catalog`): `category`, `brand`, `attribute`, `attribute_value`, `product`, `product_variant`, `product_image`, `product_channel_listing`.
Migration `1792000000000-create-catalog-tables` is reversible. SKU is unique per tenant among non-deleted variants, barcode likewise when set (partial unique indexes), so deleting frees them.

## Deferred (not in scope)

Image upload/presign (`/uploads/images`), `product-imports`, `available` and `stockLevel` and the `stock` filter, `catalog.*` events and the quota check (C005), initial stock and `lowStockThreshold` on create, price lists, combos, unit conversions, any call to another service.
`DELETE` does not check stock or open orders (C006): that needs inventory and sales.

## Decisions to review

1. **Permission codes as roles.** `products.view` is owner, manager and cashier; `products.create|update|delete` are owner and manager (comment on the controllers).
2. **Error status codes.** The contract says 400 for C001/C002/C007/C008/C009, this task says 409, so those are **409** with the contract's codes. Codes the contract does not have: `C011` duplicate brand name, `C012` duplicate attribute or value, `C013` invalid product input (no variants and no `baseSku`, `generateVariants` without axes, deleting the last variant), `C014` category cycle, `C015` brand in use. `C003`, `C004`, `C010` stay 400. There is no i18n in non-platform services, so no en/vi/jp keys.
3. **Variant attributes are a jsonb column** `attributes: [{name, value}]` on `product_variant`, not `VariantAttributeValue` rows (simplification). `attributeValueIds` in a body is resolved to name and value at write time; `attributes: [{name, value}]` is also accepted. The product's `attributes` in `GET /products/{id}` is derived from its variants (`[{name, values: [...]}]`, no ids). A renamed attribute does not rename the stored variants.
4. **The list has no `available` or `stockLevel`.** The client takes the SKUs of the page and composes stock from `GET /inventory/api/v1/stock`. `hasMemberPrice` is always `false` (no price lists). Rows also carry `brand`.
5. **Variant generation.** `generateVariants: true` with `baseSku` and `attributes: [{attributeId, valueIds}]` creates every combination, `<baseSku>-<code>-<code>` in axis order (value `code` defaults to the value in capitals, ASCII only). More than 100 gives 400 `C004`. Without it: the `variants` array, else one default variant from `baseSku`, `barcode`, `price`, `costPrice`, `weight`.
6. **`costPrice` is stored in `avg_cost_price`** (nullable). The contract names the body field `costPrice`; inventory will own the value later.
7. **Status cascade.** `PATCH /products/{id}` with `status` sets the status of every variant; a variant can still be edited alone afterwards.
8. **Channels.** `channels: ["pos","shopee"]` in a product or variant body means "listed on exactly these": rows are upserted, channels not named get `is_listed=false`; omitting the field changes nothing. On create a variant's own `channels` wins over the product's. A channel is a snake_case string (`^[a-z][a-z0-9_]{1,29}$`), not validated against sales channels.
9. **Images are `[{url}]`** (http/https), the first is the cover; `PATCH` replaces the whole list. `product_image.variant_id` exists (ERD) but no endpoint sets it. Money is integer VND (`bigint` with a number transformer); `weight` is grams.
10. **Category filter includes sub-categories.** Category deletion with products or children is 409 `C009` (products counted are non-deleted ones). Category names are unique per parent, case-insensitive (expression index). Brand delete with products is 409 `C015`.
11. **List queries.** `sort` whitelist `createdAt|price|name|skuCode` (else 422), `order` ASC or DESC, `limit` at most 100, `channel` comma list (any of). `q` uses `ILIKE` with `%`, `_` escaped. Export takes the same filters, writes UTF-8 with BOM, quotes cells and prefixes a quote to text starting with `= + - @ tab CR` (CSV injection); more than 10,000 rows gives 400 `C010`.
12. **Soft delete of a product** also soft-deletes its variants, and the variant listing joins only live products.
13. **Fixed paths `summary` and `export` are declared before `/:id`**, and `:id` is also a `ParseUUIDPipe`. Gateway: KrakenD must route `GET /products/summary` and `/products/{id}` as separate endpoints; I did not run `krakend check`.
14. `app.e2e.spec.ts` now tests the HTTP shell with stubbed services (like inventory), because `AppModule` needs Postgres.

## Verification

- `pnpm exec jest apps/catalog/src`: 2 suites, 82 tests pass (permissions per role for all 20 routes: 401, 403 without a store, exact roles; route order; 422 validation; 409 body with `errorCode`; variant generation; CSV cell escaping).
- `pnpm test:int` for `apps/catalog` (real Postgres 17 on a throwaway container, `EVENTS_IT_DB_PORT=25533`): 12 tests pass. They cover the migration, tree, generation of 4 SKUs, C001/C002/C007/C008/C009/C014/C015, no orphan product after a failed create, list filters and sort, channels, status cascade, exact lookups, export with BOM and the formula guard, summary, soft delete freeing the SKU, and tenant B seeing nothing of tenant A (404 on get/update/delete, the same SKU free in another store, A's category id unknown to B).
- `eslint apps/catalog` clean, `tsc` and `nest build catalog` pass.

## Gateway routes

22 entries (copied from the `POST /sales/api/v1/orders` shape, `auth/validator`, `catalog-cb`, no `Idempotency-Key`) are in the scratchpad `routes/catalog.json` for the parent to merge into `krakend/krakend.json`.

## Note

The rules file `FIRSTWAVE-RULES.md` was not at the given path, so I followed `CLAUDE.md`, the conventions and the brief only. I touched nothing outside `apps/catalog/**` and this report.
