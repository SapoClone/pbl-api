# 02 · Catalog and inventory contracts

This section covers the tenant web screens for the product catalog, stock, and purchasing:
- **Products:** 13:325 Products, 51:2 Create product, and the missing product detail/edit screen.
- **Stock:** 13:647 Inventory, 51:139 Stock receipt, plus the missing screens for the receipt list/detail/approve, transfers, stock takes, stock issues, and movement history.
- **Purchasing:** 13:2351 Purchasing and 51:596 Create PO, plus the missing PO detail and supplier screens.

POS (13:1536), manual orders (51:250), and mobile (06, 07) reuse the lookups and stock endpoints defined here.

Service ownership:
- **`catalog`** owns products, variants, images, categories, brands, and attributes.
- **`inventory`** owns stock, thresholds, the ledger, receipts, issues, transfers, stock takes, suppliers, and purchase orders.

Cross-cutting decisions D1–D6 are in the [index](../2026-10-28-screen-api-contracts.md) and apply here. Specifically:
- Money is integer VND.
- Every list returns `{ data, pagination }`.
- The branch scope follows D2: a `branchId` outside the caller's branches returns 404.

## From free-text SKU to catalog variants (migration)

Today, `stock_item`, `inventory_ledger`, reservations, and order lines are keyed by a free-text `sku`. The steps below move them onto catalog variants:

1. **Catalog** publishes `catalog.variant.created|updated|deleted` with the payload `{variantId, productId, skuCode, barcode, name, variantLabel, price, imageUrl, status}`.
2. **Inventory keeps a `variant_projection`.** It stores a copy of each variant, following roadmap rule 2. On `variant.created`, it backfills `stock_item.variant_id` and `inventory_ledger.variant_id` wherever the stored `sku` equals `skuCode`.
3. **Stock lines accept either key.** A line in a request takes `variantId`, or `sku` during the transition (`sku` is deprecated). If both are sent, they must match, otherwise 400 `I010`. Once every tenant is backfilled, `sku` input is removed (`v2` is not needed: the field just stays optional, then becomes rejected).
4. **Responses always carry both** `variantId` and `sku`, plus the product name and variant label from the projection.
5. **Order lines** in `sales` keep their snapshot of SKU, name, and price at sale time (roadmap rule 2). They gain `variantId`.

**Average cost** (shown as GIÁ VỐN BQ, average cost) is maintained by inventory: approving a receipt recomputes a weighted average per variant. Inventory then emits `inventory.variant_cost.updated`, and catalog stores the value in `ProductVariant.avgCostPrice` for display.

**Available stock in the product list.** The Products list shows a KHẢ DỤNG (available) column and has an in-stock filter (Còn hàng), so catalog keeps a `variant_stock_projection` of available quantity per branch. It is fed by `inventory.stock.changed`. This lets catalog filter and sort on availability without a cross-service call.

## Screen → endpoints

| Screen | Endpoints |
|---|---|
| 13:325 Products | `GET /catalog/api/v1/products`, `GET /catalog/api/v1/products/summary`, `GET /catalog/api/v1/categories`, `GET /catalog/api/v1/products/export`, `POST /catalog/api/v1/product-imports`, `GET /catalog/api/v1/product-imports/{id}` |
| 51:2 Create product | `POST /catalog/api/v1/products`, `POST /catalog/api/v1/uploads/images`, `GET/POST /catalog/api/v1/categories`, `GET/POST /catalog/api/v1/brands`, `GET/POST /catalog/api/v1/attributes`, `POST /catalog/api/v1/attributes/{id}/values`, `POST /inventory/api/v1/stock-thresholds` |
| Product detail / edit (missing screen) | `GET/PATCH/DELETE /catalog/api/v1/products/{id}`, `POST /catalog/api/v1/products/{id}/variants`, `PATCH/DELETE /catalog/api/v1/variants/{id}`, `PATCH/DELETE /catalog/api/v1/categories/{id}` |
| Search pickers (POS, manual order, receipt, PO) | `GET /catalog/api/v1/variants`, `GET /inventory/api/v1/stock/lookup` |
| 13:647 Inventory: Stock balances tab (Số dư tồn kho) | `GET /inventory/api/v1/stock`, `GET /inventory/api/v1/stock/summary`, `GET /inventory/api/v1/stock/export`, `GET /inventory/api/v1/ledger-entries` |
| 13:647 Inventory: Stock documents tab (Phiếu kho) | `GET /inventory/api/v1/stock-receipts`, `GET /inventory/api/v1/stock-issues` |
| 13:647 Inventory: Transfers tab (Điều chuyển) | `GET /inventory/api/v1/stock-transfers` (transfer tracker card included) |
| 13:647 Inventory: Stock takes tab (Kiểm kê) | `GET /inventory/api/v1/stock-takes` |
| 51:139 Stock receipt | `POST /inventory/api/v1/stock-receipts`, `GET /inventory/api/v1/suppliers`, `GET /inventory/api/v1/purchase-orders/{id}` (button "Chọn từ đơn mua", pick from purchase order) |
| Receipt list / detail / approve (missing screen) | `GET /inventory/api/v1/stock-receipts/{id}`, `PATCH /inventory/api/v1/stock-receipts/{id}`, `POST /inventory/api/v1/stock-receipts/{id}/submit`, `POST /inventory/api/v1/stock-receipts/{id}/approve`, `POST /inventory/api/v1/stock-receipts/{id}/reject`, `POST /inventory/api/v1/stock-receipts/{id}/cancel` |
| Stock issue (missing screen) | `POST /inventory/api/v1/stock-issues`, `GET /inventory/api/v1/stock-issues/{id}`, `POST /inventory/api/v1/stock-issues/{id}/approve`, `POST /inventory/api/v1/stock-issues/{id}/cancel` |
| Transfer (missing screen) | `POST /inventory/api/v1/stock-transfers`, `GET /inventory/api/v1/stock-transfers/{id}`, `POST /inventory/api/v1/stock-transfers/{id}/ship`, `POST /inventory/api/v1/stock-transfers/{id}/receive`, `POST /inventory/api/v1/stock-transfers/{id}/cancel` |
| Stock take (missing screen on web; mobile 07) | `POST /inventory/api/v1/stock-takes`, `GET /inventory/api/v1/stock-takes/{id}`, `PATCH /inventory/api/v1/stock-takes/{id}/items`, `POST /inventory/api/v1/stock-takes/{id}/complete`, `POST /inventory/api/v1/stock-takes/{id}/cancel` |
| 13:2351 Purchasing | `GET /inventory/api/v1/purchase-orders`, `GET /inventory/api/v1/purchase-orders/summary`, `GET /inventory/api/v1/purchase-orders/export`, `GET /inventory/api/v1/suppliers` |
| 51:596 Create PO | `POST /inventory/api/v1/purchase-orders`, `GET /inventory/api/v1/stock?level=below_min` (link "Thêm SKU sắp hết hàng", add low-stock SKUs) |
| PO detail (missing screen) | `GET/PATCH /inventory/api/v1/purchase-orders/{id}`, `POST /inventory/api/v1/purchase-orders/{id}/submit`, `POST /inventory/api/v1/purchase-orders/{id}/approve`, `POST /inventory/api/v1/purchase-orders/{id}/cancel`, `POST /inventory/api/v1/purchase-orders/{id}/payments` |
| Suppliers (missing screen) | `GET/POST /inventory/api/v1/suppliers`, `GET/PATCH/DELETE /inventory/api/v1/suppliers/{id}` |

---

## Catalog

### GET /catalog/api/v1/products
- **Status:** new.
- **Screens:** 13:325; mobile 05.
- **Auth:** `products.view`.
- **Query:** `page`, `limit`, `q` (searches name, `skuCode`, `barcode`), `status=active|inactive`, `categoryId`, `stock=in_stock|low|out_of_stock`, `branchId` (default: the caller's branch; used for `available`), `channel=pos,shopee` (mobile filter chips), `sort=createdAt|price|available|name`, `order`.
- **Rows:** one row per **variant**, matching the Figma table (SẢN PHẨM / BIẾN THỂ, product / variant).
- **Response 200:**
```json
{ "data": [{
  "productId": "…", "variantId": "…", "name": "Bình giữ nhiệt Mộc",
  "variantLabel": "500ml / Xanh sage", "skuCode": "MC-BGN-500-X", "barcode": "8936000000011",
  "imageUrl": "https://static.…/p/…/cover.jpg",
  "category": { "id": "…", "name": "Bình & cốc" },
  "price": 290000, "avgCostPrice": 180000,
  "available": 36, "stockLevel": "ok",
  "status": "active", "channels": ["pos", "shopee"], "hasMemberPrice": false
}], "pagination": { "limit": 8, "currentPage": 1, "nextPage": 2, "totalRecords": 72, "totalPages": 9 } }
```
- **Events:** none.

### GET /catalog/api/v1/products/summary
- **Status:** new.
- **Screens:** 13:325, the counts line and tab counts.
- **Auth:** `products.view`.
- **Response 200:** `{ "productCount": 48, "variantCount": 72, "activeVariantCount": 68, "inactiveVariantCount": 4 }`

### POST /catalog/api/v1/products
- **Status:** new.
- **Screens:** 51:2.
- **Auth:** `products.create`.
- **Body:**
```json
{
  "name": "Bình giữ nhiệt Mộc", "baseSku": "MC-BGN", "barcode": null,
  "categoryId": "…", "brandId": "…", "baseUnit": "Cái", "description": "…",
  "status": "active", "isCombo": false,
  "attributes": [ { "attributeId": "…", "valueIds": ["…xanh", "…trang"] }, { "attributeId": "…", "valueIds": ["…500ml"] } ],
  "variants": [ { "attributeValueIds": ["…xanh", "…500ml"], "skuCode": "MC-BGN-500-X", "barcode": "8936000000011", "price": 290000, "costPrice": 180000 } ],
  "imageIds": ["…upload1", "…upload2"],
  "channels": { "pos": true, "marketplaces": true },
  "initialStock": [ { "branchId": "…q3", "variantSkuCode": "MC-BGN-500-X", "quantity": 36 } ],
  "lowStockThreshold": 10
}
```
- **Field notes:**
  - `variants` must cover the attribute combinations being created. If it is omitted, the server generates every combination. Each generated `skuCode` is `baseSku` plus the value codes, so 3 colours × 2 sizes gives 6 variants.
  - `imageIds` come from `uploads/images`. The first one becomes the cover.
  - `channels.pos` maps to `ProductChannelListing` for the POS channel. `channels.marketplaces` only marks the variants as listable; pushing them to a marketplace is done in integration.
  - `initialStock` and `lowStockThreshold` are not stored by catalog. Catalog forwards them in the `catalog.variant.created` payload. Inventory creates a `pending_approval` receipt with source `opening_balance`, and sets the threshold.
- **Response 201:** the product, in the same shape as `GET /products/{id}`.
- **Errors:**
  - 400 `C001`: duplicate `skuCode` in the store.
  - 400 `C002`: duplicate `barcode`.
  - 400 `C003`: unknown category, brand, or attribute value.
  - 400 `C004`: more than 100 variants.
  - 409 `Q001`: the plan's product limit is reached (`details: { key: "products", used, limit, planCode }`). Catalog checks it itself from the plan limits it keeps from platform's events; built, replaces `C005`.
- **Events:** `catalog.product.created`, and one `catalog.variant.created` per variant.

### GET /catalog/api/v1/products/{id}
- **Status:** new.
- **Screens:** product detail (missing screen).
- **Auth:** `products.view`.
- **Response 200:**
```json
{ "id": "…", "name": "Bình giữ nhiệt Mộc", "description": "…", "baseUnit": "Cái", "status": "active", "isCombo": false,
  "category": { "id": "…", "name": "Bình & cốc" }, "brand": { "id": "…", "name": "Mộc Store" },
  "attributes": [ { "id": "…", "name": "Màu sắc", "values": [ { "id": "…", "value": "Xanh" } ] } ],
  "images": [ { "id": "…", "url": "…", "isCover": true, "sortOrder": 0, "variantId": null } ],
  "variants": [ { "id": "…", "skuCode": "MC-BGN-500-X", "barcode": "…", "label": "500ml / Xanh sage", "price": 290000, "avgCostPrice": 180000, "status": "active", "channels": ["pos", "shopee"] } ],
  "createdAt": "2026-10-01T02:00:00.000Z", "updatedAt": "…" }
```

### PATCH /catalog/api/v1/products/{id}
- **Status:** new.
- **Screens:** product edit.
- **Auth:** `products.update`.
- **Body:** any of `name`, `description`, `categoryId`, `brandId`, `baseUnit`, `status`, `imageIds` (the ordered list replaces the current images).
- **Response 200:** the product.
- **Events:** `catalog.product.updated`. If `status` or `name` changes, also `catalog.variant.updated` for every variant.

### DELETE /catalog/api/v1/products/{id}
- **Status:** new.
- **Auth:** `products.delete`.
- **Behaviour:** soft delete.
- **Response:** 204.
- **Errors:** 400 `C006`: a variant still has stock on hand or an open order. The client should suggest `status=inactive` instead.
- **Events:** `catalog.variant.deleted` for each variant.

### POST /catalog/api/v1/products/{id}/variants
- **Status:** new.
- **Auth:** `products.update`.
- **Body:** `{ "attributeValueIds": ["…den", "…300ml"], "skuCode": "MC-BGN-300-D", "barcode": null, "price": 250000, "costPrice": 160000 }`
- **Response 201:** the variant.
- **Errors:** `C001`, `C002`, and `C007` (this attribute combination already exists).
- **Events:** `catalog.variant.created`.

### PATCH /catalog/api/v1/variants/{id}
- **Status:** new.
- **Auth:** `products.update`.
- **Body:** any of `skuCode`, `barcode`, `price`, `status`, `channels` (e.g. `{ "pos": true }`).
- **Response 200:** the variant.
- **Events:** `catalog.variant.updated`.

### DELETE /catalog/api/v1/variants/{id}
- **Status:** new.
- **Auth:** `products.delete`.
- **Response:** 204.
- **Errors:** `C006`.

### GET /catalog/api/v1/variants
- **Status:** new.
- **Screens:** product pickers in POS, manual order, receipt, and PO; mobile scan.
- **Auth:** any of `products.view`, `pos.create`, `orders.create`, `inventory.create`, `purchasing.create`.
- **Query:** `q` (name, SKU, barcode), `barcode` (exact match), `ids` (comma-separated, max 100), `status=active`, `categoryId`, `page`, `limit`.
- **Response 200:** `{ data: [{ "variantId", "productId", "name", "label", "skuCode", "barcode", "imageUrl", "price", "avgCostPrice", "category": {id,name} }], pagination }`

### POST /catalog/api/v1/uploads/images
- **Status:** new.
- **Screens:** 51:2, image dropzone.
- **Auth:** `products.create` or `products.update`.
- **Body:** `{ "fileName": "binh-xanh.jpg", "contentType": "image/jpeg", "size": 812345 }`. Allowed types are `image/png` and `image/jpeg`, up to 5 MB.
- **Response 201:** `{ "imageId": "…", "uploadUrl": "https://<bucket>.s3…?X-Amz-…", "uploadHeaders": { "Content-Type": "image/jpeg" }, "publicUrl": "https://static.<domain>/t/<tenant>/p/<imageId>.jpg", "expiresAt": "…" }`
- **Flow:** the client `PUT`s the file to `uploadUrl` within 15 minutes, then sends `imageId` in `POST/PATCH /products`. Images never attached to a product are deleted after 24 h.
- **Errors:** 422 for a wrong type or size; 409 `Q001` (`details.key` is `storageGb`) when the plan's storage limit is reached. Checked when the bytes are stored, not when the upload is registered; built, replaces `C005`.

### GET /catalog/api/v1/categories
- **Status:** new.
- **Auth:** `products.view`.
- **Query:** `q`, `parentId`.
- **Response 200:** `{ data: [{ "id", "name": "Gốm sứ", "parentId": null, "productCount": 14 }], pagination }`. POS filter chips use this list.

### POST /catalog/api/v1/categories
- **Status:** new.
- **Auth:** `products.create`.
- **Body:** `{ "name": "Đồ bếp", "parentId": null }`
- **Response:** 201.
- **Errors:** 400 `C008` for a duplicate name under the same parent.

### PATCH /catalog/api/v1/categories/{id} · DELETE /catalog/api/v1/categories/{id}
- **Status:** new.
- **Auth:** `products.update` / `products.delete`.
- **Response:** 200 / 204.
- **Errors:** delete returns 400 `C009` while the category still has products.

### GET /catalog/api/v1/brands · POST /catalog/api/v1/brands
- **Status:** new.
- **Auth:** `products.view` / `products.create`.
- **Body:** `{ "name": "Mộc Store" }`
- **Response:** 200 list / 201.

### GET /catalog/api/v1/attributes · POST /catalog/api/v1/attributes · POST /catalog/api/v1/attributes/{id}/values
- **Status:** new.
- **Screens:** 51:2, attribute and value pickers.
- **Auth:** `products.view` / `products.create`.
- **Bodies:** `{ "name": "Dung tích" }`; `{ "value": "300ml", "code": "300" }` (`code` is used in generated SKUs).
- **Response:** list `{ data: [{ "id", "name": "Màu sắc", "values": [{ "id", "value": "Xanh", "code": "X" }] }], pagination }`; creates return 201.

### GET /catalog/api/v1/products/export
- **Status:** new.
- **Screens:** 13:325, button Xuất file (export file).
- **Auth:** `products.view`.
- **Query:** same filters as the list.
- **Response:** 200 `text/csv` (UTF-8 with BOM), one row per variant. Exports are capped at 10,000 rows; above that, 400 `C010`.

### POST /catalog/api/v1/product-imports · GET /catalog/api/v1/product-imports/{id}
- **Status:** new.
- **Screens:** 13:325, button Nhập file (import file).
- **Auth:** `products.create`.
- **Body:** `{ "uploadId": "…" }`. The file is uploaded first through a presigned URL, like images but with type `text/csv`.
- **Response:**
  - POST returns 202 `{ "id", "status": "processing" }`.
  - GET returns `{ "id", "status": "processing|completed|failed", "created": 40, "updated": 8, "errors": [{ "row": 12, "message": "SKU trùng: MC-LG-300-K" }] }`.
- **Events:** the same as creating or updating products, one per row.

---

## Inventory: warehouses

Stock lives in warehouses, keyed by warehouse and variant. A warehouse has a `kind`: `BRANCH` (belongs to one branch and counts in that branch's stock), `CENTRAL` or `QUARANTINE` (belong to no branch and count in no branch view). Built in workstream A (D1, D2, D13, D14); the rules are tested in `apps/inventory/test/branch-warehouse.int-spec.ts`.

- **Every active branch has exactly one default `BRANCH` warehouse.** Inventory consumes `platform.branch.created` and `platform.branch.updated` and, in the same transaction as its branch projection, creates one (`kind` `BRANCH`, `isDefault` true, code from the branch code upper-cased and made unique in the store with `-2`, `-3`, ..., name from the branch name). It is idempotent by branch id and serialised per branch, so a redelivered or concurrent event creates nothing twice; a partial unique index `UQ_warehouse_default_per_branch` on `(tenant_id, branch_id) WHERE kind = 'BRANCH' AND is_default` backs it. A branch that is `inactive` or `deleted` creates nothing; when a branch stops being active, its `BRANCH` warehouses that hold no on-hand, reserved or in-transit stock become `INACTIVE` (those with stock are left alone: platform refuses to switch off a branch that has stock, D4), and when the branch is active again its default warehouse is re-activated. A migration backfills every active branch that has none and repairs branches with two defaults or none.
- **`isWarehouse` of the branch is informational.** Nothing in inventory depends on it (`branch_projection.is_warehouse` is kept, unused). See `01-platform.md`.

### GET /inventory/api/v1/warehouses · GET /inventory/api/v1/warehouses/{id}
- **Status:** `exists`. The list takes `status`, `kind`, `branchId`; a member limited to some branches sees only the warehouses of those branches (a warehouse with no branch is for unrestricted members). A warehouse outside the caller's branches answers 404.
- **Auth:** `inventory.view`.

### POST /inventory/api/v1/warehouses
- **Status:** `change`. It was an upsert on the code (a branch-limited manager could take over another branch's warehouse). It is now a plain insert.
- **Auth:** `inventory.create`. A member limited to some branches creates `BRANCH` warehouses of those branches only; anything else (another branch, `CENTRAL`, `QUARANTINE`) answers 404.
- **Body:** `{ "code": "WH-Q3-2", "name": "…", "kind": "BRANCH", "branchId": "…", "address": "…", "isDefault": false }` (`kind` defaults to `BRANCH`; the code is upper-cased).
- **Rules:**
  - A `BRANCH` warehouse needs `branchId` of a branch that is known to inventory and `active`; `CENTRAL` and `QUARANTINE` must not name a branch.
  - The first `BRANCH` warehouse of a branch becomes its default whatever `isDefault` says; `isDefault: true` on a later one moves the default to it.
  - A code that already exists in the store is refused and nothing is changed.
- **Response:** 201, the warehouse.
- **Errors:**

  | Code | Status | Meaning |
  |---|---|---|
  | `WAREHOUSE_CODE_CONFLICT` | 409 | The code exists (in this store, any branch) |
  | `WAREHOUSE_BRANCH_INVALID` | 400 | `BRANCH` without `branchId`, or `CENTRAL`/`QUARANTINE` with one |
  | `BRANCH_NOT_FOUND` | 404 | The branch is unknown to inventory |
  | `BRANCH_NOT_ACTIVE` | 409 | The branch is inactive or deleted |

### PATCH /inventory/api/v1/warehouses/{id}
- **Status:** `change`.
- **Auth:** `inventory.update`. The caller's branches are checked on the existing warehouse and on the target branch, including `branchId: null` (a limited member never owns a null branch): 404.
- **Body:** any of `name`, `address`, `isDefault`, `status` (`ACTIVE` | `INACTIVE`), `branchId`, `kind`.
- **Rules:**
  - `branchId` or `kind` can change only while the warehouse holds no stock (on hand, reserved or in transit), no `HELD` reservation and no open transfer; the 409 lists every reason in `details.reasons` (`NON_ZERO_STOCK_BALANCE`, `ACTIVE_RESERVATIONS`, `PENDING_TRANSFERS`, `DEFAULT_WAREHOUSE`). A `BRANCH` warehouse can be moved to another active branch but never detached (`branchId: null`, or `kind` away from `BRANCH`).
  - A branch always has one default. `isDefault: false` on the default is refused; make another warehouse the default first (that unsets this one). The default cannot be deactivated or moved while its branch is active. An `INACTIVE` warehouse cannot be a default.
  - Deactivating a warehouse that holds stock, holds or transfers is refused as before (`WAREHOUSE_HAS_PENDING_OPERATIONS`, `details.reason`).
- **Errors:** `WAREHOUSE_BRANCH_LOCKED` 409 (move, re-kind or detach refused, `details.reasons`), `WAREHOUSE_IS_DEFAULT` 409, `WAREHOUSE_INACTIVE` 409, `WAREHOUSE_BRANCH_INVALID` 400, `WAREHOUSE_HAS_PENDING_OPERATIONS` 409, `BRANCH_NOT_ACTIVE` 409.

### Stock views by branch
`GET /stock`, `/stock/summary`, `/stock/lookup`, `/stock/export` and the branch figures sum the stock of a branch's **`BRANCH` warehouses** (`warehouse.kind = 'BRANCH'` and `branch_id`), never "warehouses with a branch id". Central and quarantine stock appears in no branch figure, even for data that still carries a `branch_id`.

### Internal: which warehouse a sale uses
A sale always takes its stock from **its own branch's warehouse**. Both routes are internal (not in `krakend.json`, `x-internal-token`, tenant from `X-Tenant-Id` after the token is valid).

- `GET /internal/v1/branches/{branchId}/sale-warehouse[?warehouseId=…]`: answers `{ id, code, name }`, the branch's default `BRANCH` warehouse, or the named one when it is an active `BRANCH` warehouse of that branch. Sales calls it before it claims anything.
- `POST /internal/v1/reservations` now takes `branchId` (required when `callerService` is `sales`, else 400 `BRANCH_REQUIRED`); a line's `warehouseId` is optional. A line without one uses the branch's default warehouse; a named one is checked the same way. The idempotency hash covers `branchId` when sent and the lines as sent, so a replay returns the same reservation even if the default warehouse changed since.
- **Errors (both routes):** `BRANCH_HAS_NO_WAREHOUSE` 409 (the branch has no active default warehouse), `WAREHOUSE_NOT_IN_BRANCH` 409 (the warehouse is another branch's, `CENTRAL` or `QUARANTINE`), `WAREHOUSE_INACTIVE` 409, `WAREHOUSE_NOT_FOUND` 404. Central and quarantine warehouses are never used for sales.

## Inventory: stock

### GET /inventory/api/v1/stock
- **Status:** change. Today the query is `page, limit, branchId` and rows have `{branchId, sku, onHand, reserved, available}`.
  - **New query params:** `q` (name, SKU, barcode, from the variant projection), `variantIds` (comma-separated), `level=ok|below_min|out_of_stock`, `sort=available|onHand|name`, `order`.
  - **New row fields:** the variant fields and threshold fields shown below.
- **Screens:** 13:647; mobile 06 stock list; 51:596 (`level=below_min`).
- **Auth:** `inventory.view`. `pos.create` may also read it.
- **Response 200:**
```json
{ "data": [{
  "branchId": "…q3", "variantId": "…", "sku": "MC-BGN-500-X", "name": "Bình giữ nhiệt Mộc", "variantLabel": "500ml / Xanh sage",
  "onHand": 42, "reserved": 6, "available": 36, "minQuantity": 12, "maxQuantity": null, "level": "ok"
}], "pagination": { "limit": 8, "currentPage": 1, "totalRecords": 8, "totalPages": 1 } }
```
- **Field notes:**
  - `reserved` is stock held for confirmed orders, shown as ĐANG GIỮ (held).
  - `level` is computed: `out_of_stock` when `available = 0`, `below_min` when `available < minQuantity`, otherwise `ok`.

### GET /inventory/api/v1/stock/summary
- **Status:** new.
- **Screens:** 13:647 KPI cards; mobile 06.
- **Auth:** `inventory.view`.
- **Query:** `branchId` (omit it for all branches the caller can see).
- **Response 200:**
```json
{ "branchId": "…q3", "skuCount": 8, "onHand": 172, "reserved": 23, "available": 149,
  "belowMinCount": 1, "outOfStockCount": 0, "stockValue": 125000000,
  "byBranch": [ { "branchId": "…q3", "branchName": "Quận 3", "available": 149, "fillRate": 0.82 } ] }
```
- **Field notes:**
  - `stockValue` = Σ onHand × average cost.
  - `byBranch` is filled only when `branchId` is omitted. Mobile 06 shows it as "Tồn kho theo chi nhánh" (stock by branch).
  - `fillRate` = available ÷ Σ maxQuantity, or `null` when no max is set.

### GET /inventory/api/v1/stock/lookup
- **Status:** new.
- **Screens:** POS scan box, mobile Scan tab and 07, manual order line ("Còn lại trong kho Q3", left in the Q3 warehouse).
- **Auth:** `inventory.view` or `pos.create` or `orders.create`.
- **Query:** `branchId` (required), `code` (an SKU or barcode, exact match).
- **Response 200:** `{ "variantId", "sku", "barcode", "name", "variantLabel", "price", "onHand", "reserved", "available" }`
- **Errors:** 404 when no variant matches.

### GET /inventory/api/v1/stock/export
- **Status:** new.
- **Screens:** 13:647, button Xuất tồn kho (export stock).
- **Auth:** `inventory.view`.
- **Response:** 200 `text/csv`, using the same filters as the list.

### POST /inventory/api/v1/stock-thresholds
- **Status:** new.
- **Behaviour:** an upsert keyed by (`branchId`, `variantId`).
- **Screens:** 51:2 ("Ngưỡng cảnh báo tồn", low-stock threshold), product detail, the MIN column in 13:647.
- **Auth:** `inventory.update`.
- **Body:** `{ "branchId": "…q3", "variantId": "…", "minQuantity": 10, "maxQuantity": null }`
- **Response 200:** the threshold.
- **Events:** `inventory.stock.below_min` fires when the change puts available below min (and, since workstream F, on every later drop across the minimum: see [Stock integrity rules](#stock-integrity-rules-built-d15-d21)). Insight turns it into a notification, as in the "Cần chú ý" (needs attention) card.

### GET /inventory/api/v1/ledger-entries
- **Status:** new. The `inventory_ledger` table already exists; only the endpoint is new.
- **Screens:** "Lịch sử biến động" (stock movement history) and the per-row "Lịch sử" (history) link in 13:647.
- **Auth:** `inventory.view`.
- **Query:** `branchId`, `variantId`, `refType=receipt|issue|transfer_out|transfer_in|stock_take|sale|sale_shortfall|reservation_release`, `from`, `to`, `page`, `limit`.
- **Response 200:** `{ data: [{ "id", "branchId", "variantId", "sku", "changeQty": -2, "balanceAfter": 40, "refType": "sale", "refId": "…", "refCode": "DH10247", "actor": { "id", "name": "Trần Bảo Linh" }, "createdAt" }], pagination }`

---

## Inventory: stock receipts

The current behaviour, where a receipt is applied immediately, is replaced by an approval flow. Only `approved` receipts add stock.

### POST /inventory/api/v1/stock-receipts
- **Status:** change. Today the body is `{branchId, items[{sku, quantity}]}` and the receipt is applied at once.
  - **New body fields:** supplier, PO, date, note, cost, lot and expiry, as shown below.
  - **New behaviour:** creates a `draft` (`submit: false`) or `pending_approval` (`submit: true`) receipt with a code, and changes **no** stock.
  - Duplicates are prevented with the `Idempotency-Key` header.
- **Screens:** 51:139.
- **Auth:** `inventory.create`.
- **Body:**
```json
{ "branchId": "…q3", "supplierId": "…xuong-gom-an-nhien", "purchaseOrderId": "…po00127", "receivedDate": "2026-10-23",
  "note": "Số chứng từ GH-1023",
  "items": [ { "variantId": "…ly-gom-k", "quantity": 40, "unitCost": 85000, "lotNumber": null, "expiryDate": null } ],
  "submit": true }
```
- **Field notes:**
  - `purchaseOrderId` is optional. When given, every line must be on that PO, and its quantity must not exceed what is still open (ordered − received).
- **Response 201:**
```json
{ "id": "…", "code": "PN00185", "status": "pending_approval", "branchId": "…q3",
  "supplier": { "id": "…", "name": "Xưởng gốm An Nhiên" }, "purchaseOrder": { "id": "…", "code": "PO00127" },
  "receivedDate": "2026-10-23", "note": "…", "totalQuantity": 40, "totalValue": 3400000,
  "items": [ { "variantId": "…", "sku": "MC-LG-300-K", "name": "Ly gốm An Nhiên", "currentOnHand": 28, "quantity": 40, "unitCost": 85000, "lineTotal": 3400000, "lotNumber": null, "expiryDate": null } ],
  "createdBy": { "id", "name" }, "approvedBy": null, "approvedAt": null, "createdAt": "…", "version": 1 }
```
- **Errors:**
  - 400 `I001`: unknown branch.
  - 400 `I004`: a line is not on the linked PO, or exceeds its open quantity.
  - 400 `I005`: unknown supplier.
  - 400 `I010`: `variantId` and `sku` both sent and they don't match.
- **Events:** `inventory.receipt.submitted` when `submit` is true. Insight uses it for the "Phiếu nhập … chờ duyệt" (receipt awaiting approval) alert.

### GET /inventory/api/v1/stock-receipts
- **Status:** new.
- **Screens:** 13:647 stock documents tab (Phiếu kho), receipt list (missing screen), 13:2351 receipts tab (Phiếu nhập kho).
- **Auth:** `inventory.view`.
- **Query:** `branchId`, `status`, `supplierId`, `purchaseOrderId`, `from`, `to`, `q` (code), `page`, `limit`.
- **Response 200:** `{ data: [{ "id", "code", "status", "branchId", "supplier": {id,name}, "purchaseOrder": {id,code}, "totalQuantity", "totalValue", "createdAt", "approvedAt" }], pagination }`

### GET /inventory/api/v1/stock-receipts/{id}
- **Status:** new.
- **Auth:** `inventory.view`.
- **Response 200:** the same shape as the 201 above.

### PATCH /inventory/api/v1/stock-receipts/{id}
- **Status:** new.
- **Auth:** `inventory.update`.
- **Body:** any create field, plus `version`.
- **Response 200:** the receipt.
- **Errors:**
  - 400 `I006`: only a `draft` receipt can be edited. An approved receipt is read-only, as the screen says ("Phiếu đã duyệt chỉ xem").
  - 409: `version` mismatch.

### POST /inventory/api/v1/stock-receipts/{id}/submit · /approve · /reject · /cancel
- **Status:** new.
- **Auth:**
  - `submit`: `inventory.create`
  - `approve`, `reject`: `inventory.approve`
  - `cancel`: `inventory.update`
- **Body:** `{ "version": 2 }`; `reject` also takes `{ "reason": "Sai số lượng" }`.
- **Transitions:**

  | Action | From | To |
  |---|---|---|
  | submit | `draft` | `pending_approval` |
  | approve | `pending_approval` | `approved` |
  | reject | `pending_approval` | `draft` (keeps the reason) |
  | cancel | `draft` or `pending_approval` | `cancelled` |

- **Approve, in one transaction:**
  - adds stock;
  - writes ledger rows (`refType=receipt`);
  - recomputes the average cost;
  - adds to `purchaseOrderItem.quantityReceived`, which sets the PO to `partially_received` or `received`.
- **Response 200:** the receipt.
- **Errors:** 400 `I007` (invalid transition), 409 (`version` mismatch).
- **Events:**
  - approve emits `inventory.receipt.approved`, `inventory.stock.changed` (one per line), `inventory.variant_cost.updated`, and `inventory.purchase_order.updated`;
  - reject emits `inventory.receipt.rejected`.

---

## Inventory: stock issues, transfers, stock takes

### POST /inventory/api/v1/stock-issues
- **Status:** new.
- **Screens:** 13:647, button Xuất kho (stock issue).
- **Auth:** `inventory.create`.
- **Body:** `{ "branchId", "reason": "damaged|internal_use|return_to_supplier|other", "supplierId": null, "note", "items": [{ "variantId", "quantity" }], "submit": true }`
- **Response 201:** `{ "id", "code": "PX00012", "status": "pending_approval", … }`
- **Errors:** 400 `I002` at approve time if stock is not enough.

### GET /inventory/api/v1/stock-issues · GET /inventory/api/v1/stock-issues/{id}
- **Status:** new.
- **Auth:** `inventory.view`.
- **Query:** the same filters as receipts.

### POST /inventory/api/v1/stock-issues/{id}/approve · /cancel
- **Status:** new.
- **Auth:** `inventory.approve` / `inventory.update`.
- **Body:** `{ "version" }`
- **Approve:** deducts stock and writes ledger rows (`refType=issue`).
- **Events:** `inventory.issue.approved`, `inventory.stock.changed`.

### POST /inventory/api/v1/stock-transfers
- **Status:** new.
- **Screens:** 13:647, button Điều chuyển (transfer).
- **Auth:** `inventory.create`.
- **Body:** `{ "fromBranchId": "…q3", "toBranchId": "…q7", "note", "items": [{ "variantId": "…", "quantity": 12 }] }`
- **Response 201:** `{ "id", "code": "DC00032", "status": "draft", "fromBranch": {id,name}, "toBranch": {id,name}, "items": [...], "version": 1 }`
- **Errors:** 400 `I008` when both branches are the same; 404 when the caller has no access to either branch.

### GET /inventory/api/v1/stock-transfers · GET /inventory/api/v1/stock-transfers/{id}
- **Status:** new.
- **Screens:** Transfers tab (Điều chuyển), the tracker card "DC00032 · Quận 3 → Quận 7", the dashboard alert.
- **Auth:** `inventory.view`.
- **Query:** `branchId` (matches either the source or the destination), `status`, `from`, `to`.
- **Row:** `{ "id", "code", "status", "fromBranch", "toBranch", "totalQuantity": 12, "shippedAt", "receivedAt" }`

### POST /inventory/api/v1/stock-transfers/{id}/ship · /receive · /cancel
- **Status:** new. **Built shape (warehouse based):** `POST /inventory/api/v1/stock-transfers/{id}/dispatch`, `/receive` and `/cancel`; the rules, errors and the overdue flag are in [Stock integrity rules](#stock-integrity-rules-built-d15-d21) and win over this sketch.
- **Auth:** `inventory.update` (ship, cancel); `inventory.approve` (receive, on the destination branch).
- **Body:** `{ "version" }`; `receive` may also take `{ "items": [{ "variantId", "receivedQuantity" }] }` to record a shortfall.
- **Transitions and stock:**

  | Action | Stock effect | Ledger |
  |---|---|---|
  | ship (`draft` → `in_transit`) | deducts from the source | `transfer_out` |
  | receive (`in_transit` → `received`) | adds to the destination | `transfer_in` |
  | cancel from `draft` | none | none |
  | cancel from `in_transit` | returns stock to the source | ledger rows |

  The screen note matches this: "Chỉ tăng tồn Quận 7 sau khi xác nhận nhận hàng" (Quận 7 stock only increases after receipt is confirmed).
- **Events:** `inventory.transfer.shipped`, `inventory.transfer.received`, `inventory.stock.changed`.

### POST /inventory/api/v1/stock-takes
- **Status:** new.
- **Screens:** 13:647, button Kiểm kê (stock take); mobile 07 "Bắt đầu kiểm kho" (start stock take).
- **Auth:** `inventory.create`.
- **Body:** `{ "branchId": "…q3", "scope": "all|category|variants", "categoryId": null, "variantIds": null, "note": null }`
- **Behaviour:** snapshots the system quantity per line.
- **Response 201:** `{ "id", "code": "KK00007", "status": "in_progress", "branchId", "items": [{ "variantId", "sku", "name", "systemQuantity": 42, "countedQuantity": null, "difference": null }], "version": 1 }`

### GET /inventory/api/v1/stock-takes · GET /inventory/api/v1/stock-takes/{id}
- **Status:** new.
- **Auth:** `inventory.view`.
- **Query:** `branchId`, `status=in_progress|completed|cancelled`, `from`, `to`.

### PATCH /inventory/api/v1/stock-takes/{id}/items
- **Status:** new.
- **Screens:** mobile counting (missing screen), with several devices counting at once.
- **Auth:** `inventory.update`.
- **Body:** `{ "version": 3, "items": [ { "variantId": "…", "countedQuantity": 41, "reason": "Vỡ 1" } ] }`
  - Lines not yet in the take may be added by scanning.
  - `mode: "increment"` adds to the count instead of replacing it, for scan-per-unit.
- **Response 200:** the stock take with its new `version`.
- **Errors:** 409 on a `version` mismatch.

### POST /inventory/api/v1/stock-takes/{id}/complete · /cancel
- **Status:** new.
- **Auth:** `inventory.approve` / `inventory.update`.
- **Body:** `{ "version" }`
- **Complete:** applies `counted − system` per line and writes ledger rows (`refType=stock_take`). Lines never counted are left unchanged.
- **Events:** `inventory.stocktake.completed`, `inventory.stock.changed`.

---

## Inventory: suppliers and purchase orders

### GET /inventory/api/v1/suppliers
- **Status:** new.
- **Screens:** 13:2351 Suppliers tab (Nhà cung cấp · 12), pickers in 51:139 and 51:596.
- **Auth:** `purchasing.view`.
- **Query:** `q` (name, code, phone), `page`, `limit`.
- **Response 200:** `{ data: [{ "id", "code": "NCC0003", "name": "Xưởng gốm An Nhiên", "phone": "028 ••• •• 36", "openPurchaseOrderCount": 2, "debtBalance": 3400000 }], pagination }`
- **Phone masking:** the phone is masked in lists and returned in full by `GET /suppliers/{id}`.

### POST /inventory/api/v1/suppliers
- **Status:** new.
- **Auth:** `purchasing.create`.
- **Body:** `{ "name", "phone", "email", "address", "taxCode": null, "note": null }`
- **Response 201:** the supplier, with a generated `code`.
- **Errors:** 400 `I009` when the phone number already exists in the store.

### GET /inventory/api/v1/suppliers/{id}
- **Status:** new.
- **Screens:** the supplier card in 13:2351 and the supplier detail (missing screen).
- **Auth:** `purchasing.view`.
- **Response 200:** `{ "id", "code", "name", "phone", "email", "address", "taxCode", "note", "openPurchaseOrderCount": 2, "totalPaid": 5100000, "debtBalance": 3400000, "createdAt" }`

### PATCH /inventory/api/v1/suppliers/{id} · DELETE /inventory/api/v1/suppliers/{id}
- **Status:** new.
- **Auth:** `purchasing.update` / `purchasing.delete`.
- **Behaviour:** delete is a soft delete.
- **Errors:** delete returns 400 `I011` while the supplier has open POs or debt.

### GET /inventory/api/v1/purchase-orders
- **Status:** new.
- **Screens:** 13:2351.
- **Auth:** `purchasing.view`.
- **Query:** `q` (code, supplier name), `status`, `supplierId`, `branchId`, `from`, `to` (the month picker sends the first and last day), `sort=createdAt|expectedDate|totalAmount`, `page`, `limit`.
- **Response 200:**
```json
{ "data": [{ "id": "…", "code": "PO00127", "createdAt": "2026-10-18T03:00:00.000Z",
  "supplier": { "id": "…", "name": "Xưởng gốm An Nhiên" }, "branchId": "…q3",
  "quantityOrdered": 100, "quantityReceived": 60, "totalAmount": 8500000, "remainingAmount": 3400000,
  "status": "partially_received", "expectedDate": "2026-10-21" }], "pagination": { "limit": 6, "currentPage": 1, "totalRecords": 18, "totalPages": 3 } }
```

### GET /inventory/api/v1/purchase-orders/summary
- **Status:** new.
- **Screens:** 13:2351 KPI cards.
- **Auth:** `purchasing.view`.
- **Query:** `branchId`, `from`, `to`.
- **Response 200:** `{ "openCount": 18, "partiallyReceivedCount": 4, "awaitingDeliveryCount": 7, "dueThisWeekCount": 3, "payableAmount": 26450000 }`

### GET /inventory/api/v1/purchase-orders/export
- **Status:** new.
- **Auth:** `purchasing.view`.
- **Response:** 200 `text/csv`, using the same filters as the list.

### POST /inventory/api/v1/purchase-orders
- **Status:** new.
- **Screens:** 51:596.
- **Auth:** `purchasing.create`.
- **Body:**
```json
{ "supplierId": "…xuong-gom-an-nhien", "branchId": "…q3", "expectedDate": "2026-10-28",
  "items": [
    { "variantId": "…ly-gom", "quantity": 100, "unitCost": 85000, "vatRate": 8 },
    { "variantId": "…dia-gom", "quantity": 60, "unitCost": 95000, "vatRate": 8 } ],
  "noteToSupplier": "Đóng thùng 20 cái", "paymentTermDays": 15, "depositAmount": 0, "submit": true }
```
- **Field notes:**
  - `vatRate` is a whole-number percentage, 0–10.
  - `unit` and `conversionFactor` are optional and default to the base unit and 1.
- **Computed by the server** (the client's totals are for display only):
  - `lineSubtotal` = quantity × unitCost, before VAT.
  - `vatAmount` per line = round(lineSubtotal × vatRate ÷ 100).
  - `subtotal` = Σ lineSubtotal.
  - `totalAmount` = subtotal + Σ vatAmount.
- **Response 201:**
```json
{ "id": "…", "code": "PO00128", "status": "pending_approval", "supplier": { "id": "…", "name": "Xưởng gốm An Nhiên" }, "branchId": "…q3",
  "expectedDate": "2026-10-28",
  "items": [
    { "variantId": "…", "sku": "MC-LG-300", "name": "Ly gốm An Nhiên", "quantity": 100, "quantityReceived": 0, "unitCost": 85000, "vatRate": 8, "lineSubtotal": 8500000, "vatAmount": 680000 },
    { "variantId": "…", "sku": "MC-DG-20", "name": "Đĩa gốm Tròn", "quantity": 60, "quantityReceived": 0, "unitCost": 95000, "vatRate": 8, "lineSubtotal": 5700000, "vatAmount": 456000 } ],
  "subtotal": 14200000, "vatAmount": 1136000, "totalAmount": 15336000,
  "depositAmount": 0, "paidAmount": 0, "remainingAmount": 15336000,
  "paymentTermDays": 15, "noteToSupplier": "…", "receipts": [], "createdAt": "…", "version": 1 }
```
- **Errors:** 400 `I005` (unknown supplier), 400 `I001` (unknown branch), 422 (no lines, or a quantity ≤ 0).
- **Events:** `inventory.purchase_order.created`, and `inventory.purchase_order.submitted` when `submit` is true.

### GET /inventory/api/v1/purchase-orders/{id}
- **Status:** new.
- **Screens:** PO detail (missing screen), the tracking card "PO00127 · Theo dõi nhận hàng" (receiving progress), and the picker "Chọn từ đơn mua" in 51:139.
- **Auth:** `purchasing.view`.
- **Response 200:** the same shape as the 201, plus `receipts: [{ "id", "code": "PN00184", "status": "approved", "totalQuantity": 60, "receivedDate" }, { "code": "PN00185", "status": "pending_approval", "totalQuantity": 40 }]`.

### PATCH /inventory/api/v1/purchase-orders/{id}
- **Status:** new.
- **Auth:** `purchasing.update`.
- **Body:** any create field, plus `version`.
- **Errors:** 400 `I012` unless the PO is `draft`; 409 on a `version` mismatch.

### POST /inventory/api/v1/purchase-orders/{id}/submit · /approve · /cancel
- **Status:** new.
- **Auth:** `purchasing.create` / `purchasing.approve` / `purchasing.update`.
- **Body:** `{ "version" }`; `cancel` also takes `{ "reason" }`.
- **Transitions:**

  | Action | From | To |
  |---|---|---|
  | submit | `draft` | `pending_approval` |
  | approve | `pending_approval` | `approved` (receiving opens: "đơn được gửi NCC và mở nhận hàng") |
  | cancel | anything before any receipt is approved | `cancelled` |

- **Errors:** 400 `I007` for an invalid transition.
- **Events:** `inventory.purchase_order.approved` (insight can notify), `inventory.purchase_order.cancelled`.

### POST /inventory/api/v1/purchase-orders/{id}/payments
- **Status:** new.
- **Screens:** the supplier card ("Đã trả / Còn phải trả", paid / still owed) and PO detail.
- **Auth:** `purchasing.update`.
- **Body:** `{ "amount": 5100000, "method": "transfer", "paidAt": "2026-10-19T03:00:00.000Z", "note": null }`
- **Behaviour:** adds to `paidAmount` and lowers `supplier.debtBalance`.
- **Response 201:** `{ "id", "amount", "method", "paidAt", "purchaseOrder": { "paidAmount": 5100000, "remainingAmount": 3400000 } }`
- **Errors:** 400 `I013` when the payment exceeds the remaining amount.
- **Events:** `inventory.supplier_payment.recorded`. Finance consumes it later for the cash book and `SupplierDebtLedger`.

---

## Error codes

| Code | Meaning |
|---|---|
| `C001` | duplicate SKU |
| `C002` | duplicate barcode |
| `C003` | unknown category, brand, or attribute value |
| `C004` | more than 100 variants |
| `C005` | plan quota reached (products or storage) |
| `C006` | variant still in use (stock on hand or open order) |
| `C007` | attribute combination already exists |
| `C008` | duplicate category name |
| `C009` | category not empty |
| `C010` | export too large |
| `I001` | unknown branch (exists) |
| `I002` | out of stock (exists) |
| `I003` | reservation mismatch (exists) |
| `I004` | receipt line not on the linked PO, or over its open quantity |
| `I005` | unknown supplier |
| `I006` | document not editable in its status |
| `I007` | invalid status transition |
| `I008` | transfer to the same branch |
| `I009` | duplicate supplier phone |
| `I010` | `variantId` and `sku` mismatch |
| `I011` | supplier still in use (open POs or debt) |
| `I012` | PO not editable in its status |
| `I013` | payment over the remaining amount |
| `WAREHOUSE_CODE_CONFLICT` | warehouse code exists (409) |
| `WAREHOUSE_BRANCH_INVALID` | warehouse kind and `branchId` disagree (400) |
| `WAREHOUSE_BRANCH_LOCKED` | move, re-kind or detach refused (409, `details.reasons`) |
| `WAREHOUSE_IS_DEFAULT` | default warehouse of a branch cannot be unset, deactivated or moved alone (409) |
| `WAREHOUSE_NOT_IN_BRANCH` | a sale named a warehouse that is not a `BRANCH` warehouse of its branch (409) |
| `BRANCH_HAS_NO_WAREHOUSE` | the branch has no active default warehouse (409) |
| `BRANCH_NOT_FOUND` / `BRANCH_NOT_ACTIVE` | warehouse create or move into an unknown or inactive branch (404 / 409) |

Messages are added in `en`, `vi`, and `jp`.

## Open questions

1. **Average cost: who is the source of truth?** Approving a receipt changes it. This section proposes that inventory computes it and catalog stores a copy for display. The alternative is that catalog computes it from receipt events.
2. **Initial stock on product create:** should it become a `pending_approval` receipt (the safer choice, used here), or be applied immediately for the opening balance?
3. **PO payments vs `finance`:** this section records them in inventory (`paidAmount`, `debtBalance`) until `finance` exists. Should finance own them from the start instead?
4. **Lot and expiry:** they are stored per receipt line only. Should stock be tracked per lot (FEFO picking, expiry alerts)? That would need a `StockLot` entity in the ERD.
5. **Purchasing "Nhập file" (import file) on 13:2351:** is it a PO import or a supplier import? It is not specified here.
6. **Barcodes:** must they be unique across all variants in a store, or may a combo share its component's barcode?


## Stock integrity rules (built, D15-D21)

Built in workstream F ([built-f](../../business-rules/built-f.md)). These rules win over the older screen sketches above where they differ.

### Stock enters only through documents (D15)
- `POST /inventory/api/v1/stock-balances/receipts` is **removed** (no route, no gateway entry).
- `POST /inventory/api/v1/stock-receipts` takes `warehouseId` and `items` only. The old body `{branchId, items[{sku, quantity}]}` answers **410** `DIRECT_STOCK_ENTRY_REMOVED`.
- Stock is added by posted receipts (document, cost, `inventory.approve` to post or `autoPost`), transfers, stock takes and returns. There is no second-person approval on receipts, stock takes or purchase orders by default (D21): the permission is the control.
- `POST /stock-receipts` honours `Idempotency-Key`: the same key returns the same receipt (also for a retried `autoPost`) and posts nothing twice. `POST /purchase-orders/{id}/receive` with the same key is a pure replay: it answers the first result, moves no `received_qty` and creates no second receipt; the same key on another PO answers 409 `IDEMPOTENCY_CONFLICT`.

### Transfers (D17, D18)
- **Create** (`inventory.create`): the caller needs branch scope on **both** warehouses (404 otherwise); both must be `ACTIVE` (409 `WAREHOUSE_INACTIVE`). `QUARANTINE` stock may only be transferred **into a `BRANCH` warehouse** (409 `TRANSFER_QUARANTINE_NOT_ALLOWED` otherwise); any transfer into or out of a quarantine warehouse needs `inventory.approve` (403 `PERMISSION_DENIED`).
- **Dispatch** (`inventory.update`, source scope): `DRAFT` only (409 `TRANSFER_INVALID_STATE` the second time), 409 `INSUFFICIENT_STOCK` with the shortages; deducts the source, adds the destination in-transit.
- **Receive** (`inventory.update`, destination scope): `items` must name each SKU **at most once** (422 `TRANSFER_DUPLICATE_SKU`); every line is validated against the quantity still in transit **now** (409 `TRANSFER_QUANTITY_MISMATCH`); on hand rises only by what leaves in-transit. `resolveDiscrepancy: true` needs `inventory.approve` (403).
- **Close a discrepancy** (`receive` with `resolveDiscrepancy: true`, status `DISCREPANCY` to `RECEIVED`, `inventory.approve`): the units recorded as lost are written off at the **dispatch cost**: ledger rows `TRANSFER_LOST_IN` (+n) and `TRANSFER_LOSS` (-n) at the destination (they net to zero, so on hand and reconciliation are unchanged; the loss row carries quantity and cost) and one `inventory.stock.changed` with `movementType: "TRANSFER_LOSS"`, `qtyDelta: "-n"`.
- **Cancel** `POST /inventory/api/v1/stock-transfers/{id}/cancel` (`inventory.approve`, source scope), body `{ "reason"? }`: allowed for `DRAFT`, `DISPATCHED`, `PARTIALLY_RECEIVED` (409 `TRANSFER_INVALID_STATE` otherwise). The units not yet received go back to the source at the dispatch cost with a reversing ledger row `TRANSFER_CANCEL` (`reversal_of_ledger_id` = the dispatch row) and an `inventory.stock.changed` (`TRANSFER_CANCEL`); units already received stay. Status `CANCELLED`; the detail carries `cancelledBy`, `cancelledAt`, `cancelReason` and per line `returnedQty`.
- **Overdue:** list and detail carry `daysOpen` (whole days since dispatch, only while `DISPATCHED` or `PARTIALLY_RECEIVED`, else `null`) and `overdue: true` from 7 days (`TRANSFER_OVERDUE_DAYS`). No scheduler.

### Reservations without expiry (D19)
`POST /internal/v1/reservations` accepts `noExpiry: true` (wins over `ttlSeconds`). The hold is stored with `expires_at = NULL`, answers and emits `expiresAt: null`, is never expired by the sweep and is released by cancel or committed by fulfilment. Sales sends it when it confirms an omnichannel or manual order (`POST /orders/{id}/confirm`); the POS checkout keeps its 15 minute hold.

### Events (D16, D21)
- `inventory.stock.below_min` is emitted whenever a sale hold, a stock issue or a transfer dispatch drops **available** stock (on hand minus holds) from at or above the warehouse minimum to below it: once per crossing, quiet while below, re-armed when stock rises back to the minimum; a threshold edit that leaves available below the minimum still emits as before.
- `inventory.stock.changed` has the new `movementType` values `TRANSFER_CANCEL`, `TRANSFER_LOST_IN`, `TRANSFER_LOSS`. There is no separate `inventory.stock.written_off` event: a write-off is the `TRANSFER_LOSS` change.
- `sales.order.completed` no longer deducts from the older branch-and-SKU-code store for an order that has a warehouse reservation (no `sale_shortfall` row).
- A stock take freezes nothing (`freezeMovement` is stored and ignored). Its approval is stale only when on hand moved since the snapshot (holds do not count); `forceRebase` is part of `approve`, so it needs `inventory.approve`.
- The ledger (`stock_balance_ledger`) is append-only: the database refuses UPDATE and DELETE of its rows.
