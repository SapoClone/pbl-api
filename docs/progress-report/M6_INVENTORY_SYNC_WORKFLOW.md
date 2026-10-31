# M6 Inventory Availability Publication & Burst Coalescing Workflow

## 1. Sellable Stock Calculation Formula

Implemented in [`calculateChannelPublishableQuantity`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.ts#L486-L526) and [`inventory-sync.service.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/inventory-sync/inventory-sync.service.ts).

For each active mapped channel connection:
- $\text{availableQty} = \max(0, \lfloor \text{onHandQty} - \text{reservedQty} \rfloor)$
- $\text{bufferedQty} = \max(0, \text{availableQty} - \text{safetyStockBuffer})$
- $\text{publishableQty} = \max\left(0, \left\lfloor \frac{\text{bufferedQty} \times \text{stockAllocationPercent}}{100} \right\rfloor\right)$

 Marketplace stock is **always floored at zero** and never negative.

## 2. Stale-Version Protection & Burst Coalescing

1. **Monotonic Stock Version Guard (Test K):** Every publication tracks `stock_version` and `last_published_stock_version` on `channel_inventory_publications`. [`shouldApplyInventoryStockVersion`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/domain/integration-domain.ts#L528-L536) rejects any incoming update where `incomingStockVersion <= lastPublishedStockVersion` as `STALE_SKIPPED`, preventing delayed older stock events from overwriting newer marketplace inventory.
2. **Rapid Burst Coalescing (Test T):** [`InventorySyncService.coalesceInventoryBurstAndPublish`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/modules/inventory-sync/inventory-sync.service.ts#L568-L586) groups rapid stock changes by `(tenantId, internalVariantId)`, supersedes intermediate stock versions, and executes only a single outbound marketplace publication per variant for the highest `stockVersion`.
3. **Unknown Outcome Quarantine (Test J):** If a provider request times out after transmission (`PROVIDER_TIMEOUT_UNKNOWN_OUTCOME`), the publication is marked `UNKNOWN_OUTCOME` and reconciled against remote marketplace state before re-publishing.
