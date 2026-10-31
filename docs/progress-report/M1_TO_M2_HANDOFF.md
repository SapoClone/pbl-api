# M1 Catalog to M2 Inventory/Sales Integration Handoff

## 1. Published Domain Events (`@pbl/contracts`)

Downstream services (`inventory`, `sales`, `integration`, `insight`) can subscribe to the `catalog` SNS topic (`pbl6-catalog-events`) via `@OnDomainEvent(...)` handlers using the contracts in `libs/contracts/src/events.ts`:

| Event Definition | Event Type String | Payload Type | Primary Downstream Consumers |
|---|---|---|---|
| `CATALOG_PRODUCT_CREATED` | `catalog.product.created` | `CatalogProductEventPayload` | `insight`, `integration` |
| `CATALOG_PRODUCT_UPDATED` | `catalog.product.updated` | `CatalogProductEventPayload` | `insight`, `integration` |
| `CATALOG_PRODUCT_DEACTIVATED` | `catalog.product.deactivated` | `CatalogProductEventPayload` | `inventory`, `sales`, `integration` |
| `CATALOG_VARIANT_CREATED` | `catalog.variant.created` | `CatalogVariantEventPayload` | `inventory` (SKU projection), `sales` (POS catalog projection) |
| `CATALOG_VARIANT_UPDATED` | `catalog.variant.updated` | `CatalogVariantEventPayload` | `inventory` (handles `previousSkuCode`), `sales` |
| `CATALOG_VARIANT_DEACTIVATED` | `catalog.variant.deactivated` | `CatalogVariantEventPayload` | `sales` (block new checkouts), `integration` |
| `CATALOG_PRICE_CHANGED` | `catalog.price.changed` | `CatalogPriceChangedPayload` | `sales` (price projection), `integration` |

---

## 2. Synchronous Lookup & Price Resolution Contracts

For POS barcode scanning and checkout validation:

1. **Fast SKU / Barcode Lookup:**
   - `GET /api/v1/products/lookup?sku=<skuCode>` or `GET /api/v1/products/lookup?barcode=<barcode>`
   - Returns `{ variant: VariantRes, product: ProductRes }` using `UQ_product_variants_tenant_sku` or `UQ_product_variants_tenant_barcode` index scan (`~0.02ms` DB execution time).
2. **Deterministic Sellable Price Resolution:**
   - `GET /api/v1/variants/:id/price?priceListId=<uuid>&asOfDate=<YYYY-MM-DD>`
   - Evaluates:
     1. Selected `PriceList` (if `ACTIVE` and within `startDate..endDate`)
     2. Tenant's active default `PriceList` (`isDefault = true AND status = 'ACTIVE'` and within `startDate..endDate`)
     3. Variant's `basePrice` (if `> 0.00`)
   - Rejects `INACTIVE` or `ARCHIVED` variants with `409 INVALID_PRODUCT_LIFECYCLE`.

---

## 3. Deferred M2/M3 Capabilities Ready in Schema

The database tables `combo_items`, `price_list_channels`, and `price_list_customer_groups` are already created with composite tenant foreign keys and `FORCE ROW LEVEL SECURITY` in `apps/catalog/src/migrations/1791900000200-create-catalog-tables.ts`:

- **M2 (`ComboItem`):** Expose `PUT /api/v1/variants/:id/combo-items` and integrate component stock deduction with `inventory` warehouse reservations.
- **M3 (`PriceListChannel` & `PriceListCustomerGroup`):** Extend `GET /api/v1/variants/:id/price` to accept optional `channelId` and `customerGroupId` query parameters once `integration` and `customer` services publish their master IDs.
