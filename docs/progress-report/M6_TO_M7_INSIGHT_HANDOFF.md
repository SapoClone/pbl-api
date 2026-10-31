# M6 Integration to M7 Insight Handoff Guide

## 1. Outbox Events Available for M7 Insight Analytics Projections

The Integration microservice (`apps/integration`) publishes 13 versioned domain events via the transactional outbox (`TOPOLOGY.producers.integration` in [`libs/contracts/src/topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts)) for M7 Insight omnichannel reporting:

1. **Channel Connection Health & Adoption:**
   - `integration.connection.connected`
   - `integration.connection.disconnected`
   - `integration.connection.reauth_required`
2. **Omnichannel Order Volume, Conversion & Conflict Rates:**
   - `integration.external_order.received`
   - `integration.external_order.imported`
   - `integration.external_order.conflicted` (`SKU_UNMAPPED`, `STOCK_INSUFFICIENT`, `ORDER_STATE_CONFLICT`)
3. **Catalog Coverage & SKU Mapping Velocity:**
   - `integration.sku_mapping.created`
   - `integration.sku_mapping.updated`
4. **Inventory Publication Reliability & Drift:**
   - `integration.inventory_publication.succeeded`
   - `integration.inventory_publication.failed`
   - `integration.reconciliation.discrepancy_detected`
5. **Sync Job SLA & DLQ Metrics:**
   - `integration.sync_job.completed`
   - `integration.sync_job.failed`

## 2. Recommended M7 Analytical Projections

- **Channel Sales Performance by Marketplace (`SHOPEE` vs `LAZADA` vs `POS`):** Combine `sales.order.completed` with `integration.external_order.imported` to break down GMV, order count, and cancellation rate per marketplace shop (`externalShopId`).
- **Omnichannel Operational Health Dashboard:** Track webhook-to-order import latency, open SKU mapping conflicts, inventory publication success rate, and reconciliation discrepancy counts per tenant.
