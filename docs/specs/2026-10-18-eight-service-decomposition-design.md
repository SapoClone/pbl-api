# Eight-service decomposition

- **Date:** 2026-10-18
- **Status:** Approved direction ([ADR-0010](../decisions/0010-eight-services.md)); each business sub-project still gets its own design spec before code.
- **Related:** [roadmap](2026-10-10-catalog-commerce-roadmap.md), [ADR-0001](../decisions/0001-monorepo-one-app-per-service.md), [ADR-0002](../decisions/0002-database-schema-per-service.md), [ADR-0007](../decisions/0007-event-bus.md), [ADR-0008](../decisions/0008-tenancy.md), pbl-infra `docs/architecture.html` and `docs/erd_viewer.html`

## Purpose

Say which services exist, why their boundaries are where they are, how they
talk, and which architectural patterns each boundary demonstrates. This
replaces the six-service split (`commerce` was one service) as the source of
truth for boundaries. It does not design the internals of any service.

## How the boundaries were found

Four lenses were applied in order; a boundary is kept only where they agree.

1. **Business capability.** What the business does: sell, hold stock, manage
   the product range, know its customers, handle money, reach marketplaces,
   report, and identify users and stores.
2. **Bounded context (DDD).** Where the same word means different things:

   | Word | In `catalog` | In `inventory` | In `sales` | In `customer` |
   |---|---|---|---|---|
   | Product / variant | a described, attributed item | a SKU with a quantity per branch | a priced line item (name, SKU, price copied at sale time) | something a customer bought (history) |
   | Customer | not used | not used | the buyer of an order (id, name, group) | a person with points, tier, addresses |
   | Order | not used | a reason for a reservation or issue | the aggregate | a source of loyalty points |

3. **Subdomain priority.** *Core* (where the product differs and effort
   goes): `sales`, `inventory`. *Supporting:* `catalog`, `customer`,
   `finance`, `integration`. *Generic* (could be bought): `platform`
   (identity, tenancy), `insight` (reporting, notifications).
4. **Event storming.** The event catalog below falls out of the boundaries;
   a boundary that needed a chatty synchronous protocol to work was moved.
   The one exception is the stock reservation, kept synchronous on purpose.

Volatility and scale were used only as a tiebreaker: `integration` (slow
external APIs, scales with connected shops) and `insight` (read-heavy) are
separate for operational reasons; the others for domain reasons.

## Services and data ownership

Each service has one Postgres schema and touches only that schema
([ADR-0002](../decisions/0002-database-schema-per-service.md)).

| Service | Tables owned | Read models it keeps (fed by events) |
|---|---|---|
| `platform` | Account, AccountTenant, Tenant, Branch, RefreshToken; later Staff, Role, Permission, Plan, Subscription | none |
| `catalog` | Category, Brand, Attribute, AttributeValue, Product, ProductVariant, VariantAttributeValue, ComboItem, UnitConversion, PriceList (+Channel, +CustomerGroup, +Item) | none |
| `inventory` | StockItem, StockThreshold, StockReservation, InventoryLedger, StockReceipt/Issue/Transfer/Take (+items), Supplier, PurchaseOrder (+items) | Variant, Branch; supplier debt balance |
| `sales` | SalesChannel, Shift, Order, OrderItem, OrderPromotion, Payment, Return (+items), OrderStatusHistory, Promotion (+conditions, benefits), Coupon, CouponUsage | Variant, Branch, Staff, Customer (name, group, tier), price lists |
| `customer` | CustomerGroup, Customer, CustomerAddress, MembershipTier, LoyaltyAccount, LoyaltyTransaction, LoyaltySetting | Order summary (total spent, count, history); customer debt balance |
| `finance` | CashBookCategory, CashBookEntry, Customer/Supplier/ShippingProvider DebtLedger, ShippingProvider, Shipment, ShipmentStatusHistory | Customer, Supplier, Branch |
| `integration` | ChannelConnection, SkuMapping, SyncJob, webhook InboxEvent, ChannelOrderRef | Variant |
| `insight` | DailySalesSummary, ProductSalesSummary, InventoryValueSnapshot, Notification (+recipient, device token), EmailTemplate, EmailLog, AuditLog | Variant, Branch, Channel |

Rules that follow from ADR-0002 and ADR-0008, unchanged: every business table
has `tenant_id`; ids of other services' rows are plain UUID columns; a service
that needs another's data keeps a read model and validates a bare id against it
with the tenant condition (`WHERE id = :id AND tenant_id = :tid`).

## Selling without overselling

The sale and the stock movement no longer share a transaction, so the
protection lives in `inventory`.

```
sales                                   inventory
  |  POST /internal/reservations          |
  |  { orderId, branchId, lines[] }  ---> |  per line, one statement:
  |                                       |  UPDATE stock_item
  |                                       |     SET quantity_reserved = quantity_reserved + :q
  |                                       |   WHERE tenant_id=:t AND branch_id=:b AND variant_id=:v
  |                                       |     AND quantity_on_hand - quantity_reserved >= :q
  |  <--- { reserved | shortage[] } ----- |  unique (tenant_id, order_id): a retry is a no-op
  |  create Order + Payment (own tx)      |
  |  emit order.completed  ------------>  |  reservation -> deduction + InventoryLedger row
  |  or order.cancelled / expiry ------>  |  reservation released
```

- A reservation expires (default 15 minutes, configurable). A job releases
  expired ones and emits `inventory.reservation.expired`, so `sales` can
  cancel an order whose hold lapsed.
- The call is made inside a user request through `InternalHttpClient`, which
  forwards the caller's token; `inventory` verifies it and derives the tenant
  itself. The route is internal (not in `krakend.json`).
- Failure mode: timeout and circuit breaker on the call. If `inventory` is down
  the default is to refuse the sale. The orders spec (P5) may allow a channel to
  create the order flagged `has_shortage`, which a later reservation resolves.
- Overselling is impossible within one `(tenant, branch, variant)` row
  because the check and the update are one statement.
- Returns and failed deliveries restock through events
  (`order.returned`, `order.delivery_failed`), never through a call.

## Payment

| Concern | Owner | Why |
|---|---|---|
| Payment record, `payment_status` | `sales` | Must be atomic with the order |
| Money ledger: cash book, debts, COD | `finance` | Consumes `order.payment.recorded`; never blocks a sale |
| Online gateway (VNPay, MoMo, Stripe), if built | `integration` | Slow external API with webhooks; emits `payment.gateway.confirmed` |

Only `sales` writes `payment_status`. Gateway webhooks are made idempotent by
the gateway transaction id (inbox). Refunds follow the same direction:
`sales` approves a return and emits `order.returned`; `finance` records the
refund. A separate payments service is justified only if card data or an
own wallet were handled here; with a hosted gateway it is not. Real payment
processing is out of scope for the project.

## Sagas

| Saga | Style | Steps and compensation |
|---|---|---|
| Sale reservation | Orchestrated by `sales` | reserve, create order, commit on completion; compensate by release on cancel or expiry |
| Marketplace order intake | Orchestrated by `integration` | verify webhook, record inbox, fetch order, map SKUs, emit `integration.order.received`; `sales` creates the order and reserves stock; a missing mapping leaves `ChannelOrderRef` as `pending_mapping` and emits `integration.sync.failed` |
| COD reconciliation | Choreographed by `finance` and `sales` | `shipment.delivered` marks fulfilled; `shipment.cod_settled` creates the COD payment; `shipment.failed` makes `sales` emit `order.delivery_failed`, which `inventory` restocks; a daily job warns when COD is unsettled after N days |

A new saga needs a reason a local transaction cannot meet.

## Event catalog (v2)

Names are `<aggregate>.<past-tense verb>`; the payload carries the envelope in
`@pbl/common` (`id`, `type`, `version`, `tenantId`, `occurredAt`, `traceId`).
Versioned; fields are only added.

| Event | Producer | Consumers |
|---|---|---|
| `tenant.created`, `tenant.suspended` | platform | catalog, inventory, sales, insight |
| `branch.created`, `branch.updated` | platform | inventory, sales, finance, insight |
| `staff.updated`, `staff.deactivated` | platform | sales |
| `plan.quota_exceeded` | platform | insight |
| `catalog.variant.created`, `.updated`, `.deactivated` | catalog | inventory, sales, integration, insight |
| `catalog.price.changed` | catalog | sales, integration |
| `catalog.category.updated` | catalog | sales, insight |
| `inventory.stock.changed` | inventory | integration, insight |
| `inventory.low_stock` | inventory | insight |
| `inventory.reservation.expired` | inventory | sales |
| `supplier.created`, `.updated` | inventory | finance |
| `purchase.received` | inventory | finance |
| `customer.created`, `.updated` | customer | sales, finance, insight |
| `customer_group.updated` | customer | sales |
| `sales_channel.created`, `.updated` | sales | insight |
| `order.created` | sales | integration, insight |
| `order.completed` | sales | inventory, customer, finance, insight, integration |
| `order.cancelled` | sales | inventory, customer, finance, insight, integration |
| `order.returned` | sales | inventory, customer, finance, insight |
| `order.delivery_failed` | sales | inventory, insight |
| `order.payment.recorded` | sales | finance |
| `finance.customer_debt.changed` | finance | customer |
| `finance.supplier_debt.changed` | finance | inventory |
| `shipment.delivered` | finance | sales, insight |
| `shipment.cod_settled` | finance | sales |
| `shipment.failed` | finance | sales, insight |
| `integration.order.received` | integration | sales |
| `integration.sync.failed` | integration | insight |
| `payment.gateway.confirmed` (if built) | integration | sales |
| `audit.recorded` | every service | insight |

Consumers are idempotent through an inbox table, and the producer writes the
event with its state change through an outbox ([ADR-0007](../decisions/0007-event-bus.md)).

## What the design demonstrates

| Concern | Where | Status |
|---|---|---|
| API gateway, per-route circuit breaker, error normalisation | KrakenD | built |
| Token-based security, JWKS, token verified at gateway and service | `platform`, `@pbl/auth` | built |
| Multi-tenancy from the token, tenant-scoped repository | `@pbl/common`, `@pbl/auth` | built |
| Service autonomy: app, schema, CI job, container per service | all | built (schema-level isolation; roles are a gap) |
| Shared infrastructure libraries with semver and a publish workflow | `libs/*` | built (publishing to GitHub Packages not yet confirmed) |
| Request-id propagation, internal HTTP client with token forwarding | `@pbl/common` | built |
| Event-driven messaging, outbox, inbox, retry, DLQ | all producers and consumers | designed (P1) |
| Reservation with expiry (TCC-like), idempotent command | `sales` to `inventory` | designed (P3, P5) |
| Orchestrated and choreographed sagas | `integration`, `finance`, `sales` | designed |
| Event sourcing | `inventory` ledger: stock equals the sum of ledger rows; audit and replay | designed (P3) |
| CQRS and read models | `insight`; projections in every consumer | designed (P6) |
| Anti-corruption layer, canonical order | `integration` | designed |
| BFF aggregation (order detail from `sales`, `customer`, `inventory`) | gateway or a small BFF route | designed |
| Contract testing of events and internal REST | CI | planned |

"Designed" means specified here and in an ADR, not implemented. Nothing in this
table should be presented as built until it is.

## Platform concerns (not services)

- **Registry and discovery:** Docker DNS locally, ECS Service Connect in AWS. No
  registry service.
- **Governance:** the ADRs, this document, and a service catalogue (owner,
  contract version, dependencies) to add when the first service has a contract.
- **Observability:** `X-Request-Id` is propagated and logged today; distributed
  tracing (OpenTelemetry) and one dashboard are to add.
- **Configuration and secrets:** per-service environment through compose
  locally and SSM in AWS.
- **Workflow engine:** not used. The sagas are small enough for outbox and
  events; add one only if a saga outgrows that.

## Vertical slice to build first

Breadth is not the goal. One flow built end to end shows more than eight
services with only `/health`:

1. `catalog`: create a product and variant (`catalog.variant.created`).
2. `inventory`: variant read model, receive stock, `inventory.stock.changed`.
3. `sales`: sell at POS, reserve stock, create order and payment, `order.completed`.
4. `insight`: daily revenue and low-stock count from those events.

It exercises outbox, inbox, projection, reservation, CQRS and tenancy. It
needs P1 (event bus) first. `customer`, `finance` and `integration` stay
designed until the slice works.

## What was deliberately not split

- Promotions and coupons (inside `sales`): coupon limits must be atomic with
  the order.
- Purchasing (inside `inventory`): a received order is a stock receipt.
- Payment record (inside `sales`), shipping (inside `finance`), notifications
  (inside `insight`).
- Staff and RBAC stay in `platform` until the roadmap schedules them.

Candidates for a later extraction, each only on a measured reason: `inventory`
into reservation and ledger if stock is read far more than written;
`insight` read models onto their own store when dashboards get heavy;
`notification` out of `insight` if delivery channels grow.

## Mapping to the roadmap

| Roadmap item | Service |
|---|---|
| P0 tenancy | `platform` (done) |
| P1 event bus | libraries, all services |
| P2 catalog core | `catalog` |
| P3 inventory | `inventory` (stock, reservation, ledger, receipts, transfers, stock takes) |
| P4 customers | `customer` |
| P5 sales (POS) | `sales` (orders, payments, shifts, returns); reservation client |
| P6 insight dashboard | `insight` |
| P7 promotions and coupons | `sales` |
| P8 catalog advanced | `catalog` |
| P9 purchasing | `inventory` |
