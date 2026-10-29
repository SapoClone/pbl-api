# M1 Catalog Microservice — API Reference

- **Direct Service Base Path:** `/api/v1` (OpenAPI UI at `/api/docs` and `/api-docs`; JSON spec at `/api/docs-json` and `/api-docs-json`)
- **KrakenD Gateway Base Path:** `/catalog/api/v1` (Unified OpenAPI UI on Platform at `http://localhost:3000/api-docs`)
- **Authentication:** Bearer RS256 JWT (`Authorization: Bearer <accessToken>`) with active tenant claim (`tid`).

---

## 1. Categories (`/api/v1/categories`)

| Method | Path | Roles | Success | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/categories` | `owner`, `manager` | `201` | Create root or child category (`depth <= 3`) |
| `GET` | `/api/v1/categories` | `owner`, `manager`, `cashier` | `200` | Paginated list/search (`status`, `parentId`, `q`) |
| `GET` | `/api/v1/categories/tree` | `owner`, `manager`, `cashier` | `200` | Hierarchical 3-level category tree (`activeOnly`) |
| `GET` | `/api/v1/categories/:id` | `owner`, `manager`, `cashier` | `200` | Get category by UUID |
| `PATCH` | `/api/v1/categories/:id` | `owner`, `manager` | `200` | Update category name/slug |
| `POST` | `/api/v1/categories/:id/reparent` | `owner`, `manager` | `200` | Reparent category and subtree with cycle & depth (`<= 3`) lock validation |
| `PATCH` | `/api/v1/categories/:id/status` | `owner`, `manager` | `200` | Activate/deactivate category (rejects `409 CATEGORY_IN_USE` if active products exist) |
| `DELETE` | `/api/v1/categories/:id` | `owner`, `manager` | `204` | Delete unreferenced leaf category (`409 CATEGORY_IN_USE` if referenced) |

---

## 2. Brands (`/api/v1/brands`)

| Method | Path | Roles | Success | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/brands` | `owner`, `manager` | `201` | Create tenant-scoped brand |
| `GET` | `/api/v1/brands` | `owner`, `manager`, `cashier` | `200` | Paginated list/search brands (`status`, `q`) |
| `GET` | `/api/v1/brands/:id` | `owner`, `manager`, `cashier` | `200` | Get brand by UUID |
| `PATCH` | `/api/v1/brands/:id` | `owner`, `manager` | `200` | Update brand name, description, or status |
| `DELETE` | `/api/v1/brands/:id` | `owner`, `manager` | `200` | Safely deactivate brand (`status = 'INACTIVE'`), preserving historical product references |

---

## 3. Attributes (`/api/v1/attributes`)

| Method | Path | Roles | Success | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/attributes` | `owner`, `manager` | `201` | Create variant attribute (e.g., `Color`, `Size`) |
| `GET` | `/api/v1/attributes` | `owner`, `manager`, `cashier` | `200` | List all attributes with their values |
| `PATCH` | `/api/v1/attributes/:id` | `owner`, `manager` | `200` | Rename attribute |
| `POST` | `/api/v1/attributes/:id/values` | `owner`, `manager` | `201` | Add value to attribute (`Black`, `White`, `M`, `L`) |
| `PATCH` | `/api/v1/attributes/:id/values/:valueId` | `owner`, `manager` | `200` | Update attribute value |
| `DELETE` | `/api/v1/attributes/:id/values/:valueId` | `owner`, `manager` | `204` | Delete unreferenced attribute value (`409 ATTRIBUTE_IN_USE` if used by variants) |

---

## 4. Products, Variants & Unit Conversions (`/api/v1/products`, `/api/v1/variants`)

| Method | Path | Roles | Success | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/products` | `owner`, `manager` | `201` | Create product, base unit conversion, and optional default variant |
| `GET` | `/api/v1/products` | `owner`, `manager`, `cashier` | `200` | List/search products (`page`, `limit`, `afterCursor`, `q`, `status`, `categoryId`, `brandId`) |
| `GET` | `/api/v1/products/lookup` | `owner`, `manager`, `cashier` | `200` | Exact indexed lookup by `sku` or `barcode` (POS scanner path) |
| `GET` | `/api/v1/products/:id` | `owner`, `manager`, `cashier` | `200` | Get product detail with variants, attributes, and unit conversions |
| `PATCH` | `/api/v1/products/:id` | `owner`, `manager` | `200` | Update product master data (optimistic concurrency via `version`) |
| `PATCH` | `/api/v1/products/:id/status` | `owner`, `manager` | `200` | Transition product status (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED`) |
| `DELETE` | `/api/v1/products/:id` | `owner`, `manager` | `200` | Soft-delete product (`deleted_at`), archive product, and deactivate variants |
| `POST` | `/api/v1/products/:id/variants` | `owner`, `manager` | `201` | Create single variant with attribute pairs, SKU, and optional EAN-13/Code128 barcode |
| `POST` | `/api/v1/products/:id/variants/generate` | `owner`, `manager` | `201` | Atomically generate Cartesian variants from attribute axes (capped at 100) |
| `PATCH` | `/api/v1/variants/:id` | `owner`, `manager` | `200` | Update variant SKU, barcode, name, basePrice, weight, or attributes |
| `PATCH` | `/api/v1/variants/:id/status` | `owner`, `manager` | `200` | Transition variant status (`ACTIVE`, `INACTIVE`, `ARCHIVED`) |
| `POST` | `/api/v1/products/:id/units` | `owner`, `manager` | `201` | Add packaging unit conversion (`conversionFactor > 0`) |
| `GET` | `/api/v1/products/:id/units` | `owner`, `manager`, `cashier` | `200` | List unit conversions for a product |

---

## 5. Pricing & Price Resolution (`/api/v1/price-lists`, `/api/v1/variants/:id/price`)

| Method | Path | Roles | Success | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/price-lists` | `owner`, `manager` | `201` | Create catalog price list (`isDefault`, `currency`, `startDate`, `endDate`) |
| `GET` | `/api/v1/price-lists` | `owner`, `manager`, `cashier` | `200` | List tenant price lists |
| `GET` | `/api/v1/price-lists/:id` | `owner`, `manager`, `cashier` | `200` | Get price list with all variant price items |
| `PATCH` | `/api/v1/price-lists/:id` | `owner`, `manager` | `200` | Update price list metadata or default flag |
| `PUT` | `/api/v1/price-lists/:id/items` | `owner`, `manager` | `200` | Atomically upsert variant prices and emit `catalog.price.changed` outbox events |
| `GET` | `/api/v1/variants/:id/price` | `owner`, `manager`, `cashier` | `200` | Deterministically resolve active sellable price (`PRICE_LIST` -> `DEFAULT_PRICE_LIST` -> `VARIANT_BASE_PRICE`) |

---

## 6. Standardized Error Codes

| Error Code | HTTP Status | Trigger Condition |
|---|---|---|
| `PRODUCT_NOT_FOUND` | `404` | Product does not exist in active tenant or is soft-deleted |
| `VARIANT_NOT_FOUND` | `404` | Variant does not exist in active tenant |
| `CATEGORY_NOT_FOUND` | `404` | Category does not exist in active tenant |
| `BRAND_NOT_FOUND` | `404` | Brand does not exist in active tenant |
| `ATTRIBUTE_NOT_FOUND` | `404` | Attribute does not exist in active tenant |
| `ATTRIBUTE_VALUE_NOT_FOUND` | `404` | Attribute value does not exist in active tenant |
| `PRICE_LIST_NOT_FOUND` | `404` | Price list does not exist in active tenant |
| `PRICE_NOT_CONFIGURED` | `404` | No active price in selected/default price list and base price is `0.00` |
| `CATEGORY_DEPTH_EXCEEDED` | `409` | Creating or reparenting a category results in tree depth `> 3` |
| `CATEGORY_CYCLE_DETECTED` | `409` | Reparenting a category under itself or one of its descendants |
| `CATEGORY_IN_USE` | `409` | Deactivating/deleting a category referenced by active products or subcategories |
| `CATEGORY_SLUG_EXISTS` | `409` | Duplicate sibling category slug within the same parent level |
| `CATEGORY_NAME_EXISTS` | `409` | Duplicate sibling category name within the same parent level |
| `BRAND_NAME_EXISTS` | `409` | Duplicate normalized brand name within the tenant |
| `ATTRIBUTE_NAME_EXISTS` | `409` | Duplicate normalized attribute name within the tenant |
| `ATTRIBUTE_VALUE_EXISTS` | `409` | Duplicate normalized value within the same attribute |
| `ATTRIBUTE_IN_USE` | `409` | Deleting an attribute value currently assigned to a variant |
| `SKU_ALREADY_EXISTS` | `409` | Duplicate normalized SKU within the tenant |
| `BARCODE_ALREADY_EXISTS` | `409` | Duplicate non-null barcode within the tenant |
| `INVALID_SKU` | `400` | SKU format invalid or empty |
| `INVALID_BARCODE` | `400` | Barcode format invalid or fails GS1/EAN-13 check digit |
| `INVALID_VARIANT_COMBINATION` | `400` | Multiple values for the same attribute on a single variant |
| `VARIANT_COMBINATION_EXISTS` | `409` | Duplicate canonical `combination_signature` for the same product |
| `VARIANT_GENERATION_LIMIT_EXCEEDED` | `400` | Cartesian product exceeds 100 variants |
| `INVALID_PRICE` | `400` | Negative price or more than 2 decimal places |
| `INVALID_UNIT_CONVERSION` | `400` | Conversion factor `<= 0` or > 4 decimal places |
| `UNIT_CONVERSION_EXISTS` | `409` | Duplicate unit name or second base unit on the same product |
| `PRICE_LIST_CONFLICT` | `409` | Duplicate price list name, invalid date range, or concurrent active default price list |
| `INVALID_PRODUCT_LIFECYCLE` | `409` | Invalid status transition (e.g., `ARCHIVED -> ACTIVE`, `ACTIVE -> DRAFT`) |
| `RESOURCE_VERSION_CONFLICT` | `409` | Optimistic lock `version` mismatch on concurrent update |
