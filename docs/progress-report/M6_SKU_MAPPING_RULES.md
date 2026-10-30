# M6 SKU Mapping Rules & Catalog Consistency

## 1. SKU Mapping Domain Rules

Implemented in [`sku-mapping.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/sku-mapping/sku-mapping.service.ts) and [`inventory-sync.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/inventory-sync/inventory-sync.service.ts).

1. **Tenant & Variant Validation:** Every `SkuMappingEntity` must reference an existing `ChannelConnectionEntity` and an `ACTIVE` `IntegrationCatalogVariantEntity` belonging to the **same `tenant_id`**. Cross-tenant mapping attempts are rejected with `404 INTERNAL_VARIANT_NOT_FOUND` (Mandatory Test P).
2. **Composite Uniqueness per Channel Variation:** `UNIQUE (tenant_id, connection_id, external_item_id, external_sku_id)` (`UQ_sku_mappings_conn_ext_item_sku`) prevents one marketplace variation from being mapped to two internal variants simultaneously.
3. **One-to-Many Multi-Channel Support:** One internal `variantId` can be mapped to multiple marketplace channels (e.g., Shopee Flagship + Lazada Mall), and stock changes fan out across all active mapped channels.
4. **No Fuzzy Name Matching:** Automatic mapping (`syncProductListingsForConnection`) only creates `EXACT_SKU_AUTO` mappings when `externalSkuCode.trim() === catalogVariant.skuCode` and the internal variant is `ACTIVE`. Product titles are never fuzzy-matched.
5. **Catalog Event Synchronization:** [`IntegrationEventsConsumer`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/consumers/integration-events.consumer.ts) consumes `catalog.variant.created`, `catalog.variant.updated`, `catalog.variant.deactivated`, and `catalog.product.deactivated`. When a mapped variant or product is deactivated, all associated `sku_mappings` transition to `status = 'NEEDS_REVIEW'` so deactivated items are never silently sold or updated.
6. **Immutable In-Flight Order Mapping Snapshot (Test R):** When `OrderSyncService` begins importing an external order, it captures `mappingSnapshot` (`mappingId`, `mappingVersion`, `internalVariantId`, `internalSkuCode`) on `channel_order_refs`. Subsequent remapping of the SKU affects future orders only and never mutates in-flight or historical orders.
