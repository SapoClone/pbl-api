# M7 Insight & Analytics — Event Contracts & Topology (`M7_INSIGHT_EVENT_CONTRACTS.md`)

**Date:** 2026-10-30
**Contract Files:** [`libs/contracts/src/events.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/events.ts), [`libs/contracts/src/topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts)
**Consumer:** [`apps/insight/src/consumers/insight-events.consumer.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/apps/insight/src/consumers/insight-events.consumer.ts)

---

## 1. Consumed Domain Events (`insight-events-queue`)

The Insight microservice subscribes to upstream operational events via `TOPOLOGY.subscriptions.insight` (`insight-events-queue`). Every incoming event is deduplicated atomically via `@pbl/events` `InboxConsumer.handle` using the `inbox_messages` table (`UNIQUE(tenant_id, event_id)`).

| Upstream Domain | Event Type (`ROUTING_KEYS`) | Analytical Action in `ProjectionsService` |
|---|---|---|
| **Sales** | `sales.order.created` (`SALES_ORDER_CREATED`) | Creates or updates `order_analytics_facts` (`order_status = 'CREATED'`, not yet counted in recognized revenue unless already paid/completed). |
| **Sales** | `sales.order.paid` (`SALES_ORDER_PAID`) | Transitions `order_analytics_facts` to recognized sales (`is_counted_in_sales = true`), computes contribution delta `(newState - oldState)`, and increments `daily_sales_summaries`, `daily_sales_projections` (M0 compatibility), `product_sales_summaries`, `category_sales_summaries`, `branch_sales_summaries`, `channel_sales_summaries`, and `customer_sales_summaries`. |
| **Sales** | `sales.order.completed` (`SALES_ORDER_COMPLETED`) | Ensures order is recognized in sales if not already counted at `paid` stage; idempotent zero-delta if already counted at `paid` with identical amounts. |
| **Sales** | `sales.order.cancelled` (`SALES_ORDER_CANCELLED`) | If the order was previously counted in recognized sales, reverses its full contribution delta (`-1` order count, `-gross_sales`, `-net_sales`, `-cogs`, `-gross_profit`) and increments `cancelled_order_count = +1`. If never counted, simply increments `cancelled_order_count = +1`. |
| **Sales** | `sales.return.completed` (`SALES_RETURN_COMPLETED`) | Applies partial or full return (`refunded_amount`, `units_returned`, `returned_cogs_amount`) to `order_analytics_facts`, recomputes net sales and gross profit, and applies the exact negative net-sales/gross-profit delta and positive refund/return delta to all summary projections. |
| **Inventory** | `inventory.stock.received` (`INVENTORY_STOCK_RECEIVED`) | Updates weighted-average `unit_cost`, `on_hand_qty`, `available_qty`, `is_low_stock`, and `inventory_value_amount` in `inventory_stock_projections`; updates `analytics_sku_catalog_cache.latest_unit_cost`; records `INBOUND` movement in `inventory_movement_facts` and `inventory_movement_summaries`. |
| **Inventory** | `inventory.stock.reserved` / `inventory.stock.released` | Adjusts `reserved_qty`, `available_qty`, and `is_low_stock` in `inventory_stock_projections`. |
| **Inventory** | `inventory.stock.deducted` (`INVENTORY_STOCK_DEDUCTED`) | Decrements `on_hand_qty` and `reserved_qty`, updates `last_sale_at`, and records `OUTBOUND` movement in `inventory_movement_summaries`. |
| **Inventory** | `inventory.stock.adjusted` (`INVENTORY_STOCK_ADJUSTED`) | Applies positive/negative stock adjustment or `DAMAGE` movement and recalculates `inventory_value_amount`. |
| **Finance** | `finance.cashbook.voucher_posted` (`FINANCE_CASHBOOK_VOUCHER_POSTED`) | Records idempotent fact in `financial_cashflow_facts` and increments `cash_inflow_amount` (`RECEIPT`) or `cash_outflow_amount` (`PAYMENT`) and `net_cashflow_amount` in `daily_cashflow_summaries`. |
| **Finance** | `finance.payment.settled` (`FINANCE_PAYMENT_SETTLED`) | Increments `settled_payment_amount` and `cash_inflow_amount` in `daily_cashflow_summaries`. |
| **Finance** | `finance.refund.Completed` (`FINANCE_REFUND_COMPLETED`) | Increments `refund_paid_amount` and `cash_outflow_amount` in `daily_cashflow_summaries`. |
| **Finance** | `finance.cod.reconciled` (`FINANCE_COD_RECONCILED`) | Increments `cod_settled_amount`, `cod_fee_amount`, and reduces `cod_pending_delta` in `daily_cashflow_summaries`. |
| **Finance** | `finance.receivable.updated` (`FINANCE_RECEIVABLE_UPDATED`) | Updates `receivable_created_amount`, `receivable_collected_amount`, and `outstanding_receivable_delta` in `daily_cashflow_summaries`, and updates `outstanding_receivable_amount` in `customer_sales_summaries`. |
| **Catalog** | `catalog.product.created` / `updated`, `catalog.variant.created` / `updated` | Upserts SKU code, product name, category ID/name, and cost metadata in `analytics_sku_catalog_cache`. |
| **Customer** | `customer.created` / `updated` | Upserts customer code and name in `customer_sales_summaries`. |
| **Integration** | `integration.order.synced` (`INTEGRATION_ORDER_SYNCED`) | Upserts channel metadata in `analytics_branch_channel_cache`. |
| **All (`*`)** | Any domain event | Appends an immutable audit entry to `audit_logs` and updates `projection_checkpoints`. |

---

## 2. Published Domain Events (`insight-events` SNS Topic)

Insight publishes operational governance events via the transactional outbox (`outbox_events` -> `TOPOLOGY.producers.insight`):

| Event Constant | Routing Key | Payload Interface | Trigger |
|---|---|---|---|
| `INSIGHT_PROJECTION_REBUILT` | `insight.projection.rebuilt` | `InsightProjectionRebuiltPayload` | Emitted when a non-blocking shadow projection rebuild completes and passes checksum verification. |
| `INSIGHT_PROJECTION_STALE_DETECTED` | `insight.projection.stale_detected` | `InsightProjectionStaleDetectedPayload` | Emitted when a projection checkpoint exceeds the staleness threshold. |
| `INSIGHT_RECONCILIATION_DISCREPANCY_DETECTED` | `insight.reconciliation.discrepancy_detected` | `InsightReconciliationDiscrepancyDetectedPayload` | Emitted when an analytical reconciliation run detects a variance between retained facts and summary tables. |
| `INSIGHT_EXPORT_COMPLETED` | `insight.export.completed` | `InsightExportCompletedPayload` | Emitted when a report export job (`CSV`, `XLSX`, or `PDF`) finishes generating its artifact and SHA-256 checksum. |
| `INSIGHT_EXPORT_FAILED` | `insight.export.failed` | `InsightExportFailedPayload` | Emitted if an export job encounters a failure. |
