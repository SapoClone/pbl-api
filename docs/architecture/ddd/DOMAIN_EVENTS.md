# Domain Events Catalog — `@pbl/contracts`

All domain events are defined in [`libs/contracts/src/events.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/events.ts) and wired in [`libs/contracts/src/topology.ts`](file:///Users/mac/Desktop/SEM7/pbl6/pbl-api/libs/contracts/src/topology.ts). Every event envelope conforms to `DomainEvent<TPayload>`:

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string;          // UUID v4 event ID
  type: string;        // Canonical routing key, e.g. 'sales.order.completed'
  version: number;     // Schema version (1)
  tenantId: string;    // Mandatory multi-tenant isolation key
  occurredAt: string;  // ISO-8601 UTC timestamp
  correlationId?: string;
  actorId?: string;
  payload: TPayload;
}
```

## Producer & Consumer Event Matrix

| Bounded Context (Producer) | Event Type (`routingKey`) | Version | Subscribing Contexts (Consumers) | Business Meaning |
|---|---|---|---|---|
| **Platform** | `platform.branch.created` | `1` | `inventory`, `insight` | New retail branch created for a tenant |
| **Platform** | `platform.branch.updated` | `1` | `inventory`, `insight` | Branch metadata or active status updated |
| **Catalog** | `catalog.product.created` / `updated` / `deactivated` | `1` | `inventory`, `sales`, `integration`, `insight` | Product master lifecycle changes |
| **Catalog** | `catalog.variant.created` / `updated` / `deactivated` | `1` | `inventory`, `sales`, `integration`, `insight` | Sellable SKU variant created, updated, or deactivated |
| **Catalog** | `catalog.price.changed` | `1` | `sales`, `integration`, `insight` | Variant base price or price book item updated |
| **Inventory** | `inventory.stock.changed` | `1` | `sales`, `integration`, `insight` | Authoritative `on_hand_qty`, `reserved_qty`, `available_qty`, or `avg_unit_cost` changed |
| **Inventory** | `inventory.stock.received` | `1` | `finance`, `insight` | Inbound stock receipt posted with supplier & unit cost |
| **Inventory** | `inventory.stock.issued` | `1` | `finance`, `insight` | Outbound stock issued on fulfillment with WAC COGS snapshot |
| **Inventory** | `inventory.reservation.confirmed` / `committed` / `released` / `expired` | `1` | `sales`, `insight` | Stock reservation lifecycle state transitions |
| **Inventory** | `inventory.transfer.dispatched` / `received` | `1` | `insight` | Inter-warehouse stock transfer dispatched or received |
| **Inventory** | `inventory.stocktake.adjusted` | `1` | `finance`, `insight` | Physical stocktake variance approved and posted |
| **Sales** | `sales.order.created` / `confirmed` / `completed` / `cancelled` | `1` | `inventory`, `customer`, `finance`, `integration`, `insight` | Order aggregate lifecycle transitions |
| **Sales** | `sales.return.created` / `approved` / `completed` | `1` | `inventory`, `customer`, `finance`, `insight` | Customer return lifecycle & pro-rated refund calculation |
| **Sales** | `sales.refund.requested` | `1` | `finance` | Triggers downstream financial refund execution |
| **Sales** | `sales.shift.opened` / `closed` | `1` | `finance`, `insight` | POS cashier shift cash drawer reconciliation |
| **Customer** | `customer.created` / `updated` / `deactivated` | `1` | `sales`, `insight` | Customer CRM profile lifecycle |
| **Customer** | `customer.loyalty.points_earned` / `points_redeemed` / `points_reversed` | `1` | `finance`, `insight` | Loyalty point ledger postings |
| **Finance** | `finance.cashbook.entry_posted` | `1` | `insight` | Cash/bank receipt or expense voucher posted |
| **Finance** | `finance.receivable.created` / `payment_applied` | `1` | `customer`, `insight` | Customer AR invoice & payment allocation |
| **Finance** | `finance.payment.settlement_confirmed` | `1` | `sales`, `insight` | Asynchronous bank transfer / gateway settlement confirmed |
| **Finance** | `finance.refund.completed` | `1` | `sales`, `insight` | Financial refund completed |
| **Finance** | `finance.cod.settlement_reconciled` / `discrepancy_detected` | `1` | `sales`, `insight` | Carrier COD batch statement reconciled or variance flagged |
| **Integration** | `integration.external_order.imported` / `mapping_required` / `sync_failed` | `1` | `sales`, `insight` | Marketplace order ingested via ACL or quarantined for SKU mapping |
| **Integration** | `integration.inventory_publication.succeeded` / `failed` | `1` | `insight` | Sellable stock pushed to Shopee/Lazada |
| **Insight** | `insight.projection.rebuilt` / `export.completed` | `1` | `platform` (audit/notification) | Analytical read-model rebuild or export job finished |
