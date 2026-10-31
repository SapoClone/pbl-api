# M6 Integration Event Contracts & Topology

## 1. Published Domain Events (`TOPOLOGY.producers.integration`)

Defined in [`libs/contracts/src/events.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/events.ts) and [`libs/contracts/src/topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts).

| Event Constant | Event Type String | Version | Payload Interface | Trigger |
|---|---|---|---|---|
| `INTEGRATION_CONNECTION_CONNECTED` | `integration.connection.connected` | `1` | `IntegrationConnectionEventPayload` | Channel connection authorized / connected |
| `INTEGRATION_CONNECTION_DISCONNECTED` | `integration.connection.disconnected` | `1` | `IntegrationConnectionEventPayload` | Channel connection disconnected by operator |
| `INTEGRATION_CONNECTION_REAUTH_REQUIRED` | `integration.connection.reauth_required` | `1` | `IntegrationConnectionEventPayload` | Refresh token expired or rejected by provider |
| `INTEGRATION_SKU_MAPPING_CREATED` | `integration.sku_mapping.created` | `1` | `IntegrationSkuMappingEventPayload` | New SKU mapping created |
| `INTEGRATION_SKU_MAPPING_UPDATED` | `integration.sku_mapping.updated` | `1` | `IntegrationSkuMappingEventPayload` | Existing SKU mapping updated |
| `INTEGRATION_EXTERNAL_ORDER_RECEIVED` | `integration.external_order.received` | `1` | `IntegrationExternalOrderEventPayload` | External marketplace order recorded in `channel_order_refs` |
| `INTEGRATION_EXTERNAL_ORDER_IMPORTED` | `integration.external_order.imported` | `1` | `IntegrationExternalOrderEventPayload` | Canonical Sales order created and linked |
| `INTEGRATION_EXTERNAL_ORDER_CONFLICTED` | `integration.external_order.conflicted` | `1` | `IntegrationExternalOrderEventPayload` | Order blocked by `SKU_UNMAPPED`, `STOCK_INSUFFICIENT`, or `ORDER_STATE_CONFLICT` |
| `INTEGRATION_INVENTORY_PUBLICATION_SUCCEEDED` | `integration.inventory_publication.succeeded` | `1` | `IntegrationInventoryPublicationEventPayload` | Sellable stock quantity confirmed by marketplace |
| `INTEGRATION_INVENTORY_PUBLICATION_FAILED` | `integration.inventory_publication.failed` | `1` | `IntegrationInventoryPublicationEventPayload` | Stock publication failed or timed out (`UNKNOWN_OUTCOME`) |
| `INTEGRATION_SYNC_JOB_COMPLETED` | `integration.sync_job.completed` | `1` | `IntegrationSyncJobEventPayload` | Background sync job completed |
| `INTEGRATION_SYNC_JOB_FAILED` | `integration.sync_job.failed` | `1` | `IntegrationSyncJobEventPayload` | Background sync job dead-lettered |
| `INTEGRATION_RECONCILIATION_DISCREPANCY_DETECTED` | `integration.reconciliation.discrepancy_detected` | `1` | `IntegrationReconciliationDiscrepancyPayload` | Reconciliation run detected open discrepancies |

## 2. Subscribed Upstream Events (`TOPOLOGY.subscriptions.integration`)

Handled idempotently by [`IntegrationEventsConsumer`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/integration/src/consumers/integration-events.consumer.ts):
- `catalog.variant.created` (`CATALOG_VARIANT_CREATED`)
- `catalog.variant.updated` (`CATALOG_VARIANT_UPDATED`)
- `catalog.variant.deactivated` (`CATALOG_VARIANT_DEACTIVATED`)
- `catalog.product.deactivated` (`CATALOG_PRODUCT_DEACTIVATED`)
- `inventory.stock.changed` (`INVENTORY_STOCK_CHANGED`)
- `sales.order.created` / `sales.order.cancelled` / `sales.order.completed`
