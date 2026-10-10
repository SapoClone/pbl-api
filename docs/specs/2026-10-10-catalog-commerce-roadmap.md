# Catalog & commerce roadmap

- **Date:** 2026-10-10
- **Status:** Approved (sequence and cross-cutting rules); each sub-project gets its own design spec before implementation
- **Related:** [ADR-0007 event bus](../decisions/0007-event-bus.md), [ADR-0008 tenancy](../decisions/0008-tenancy.md), pbl-infra `docs/erd_viewer.html`

## Goal

Replace the mock data in pbl-mobile's seven business screens with real APIs,
built the way the target architecture describes. The screens are home dashboard,
products, inventory, stock alerts, customers, orders and order detail.
"As complete as possible" was the explicit direction. That means services
exchange data through events, not shortcuts; tenancy is real from day one; and
the POS covers promotions, coupons, shifts, loyalty and returns.

Success: each mobile screen can switch from its mock cubit to a gateway
endpoint (`/<service>/api/v1/...`) scoped to the signed-in user's store.

## What the mobile screens need

Read from pbl-mobile `feat/home-bao` (2026-09-29). The mobile DTOs will be
changed to match the backend; the backend does not copy the mock shapes.

| Screen | Data |
|---|---|
| Products (list, detail, editor) | name, SKU, barcode, category, sale price, cost price, colour/size variants, stock per branch, sales channels, active flag |
| Inventory, stock take | stock per branch, minimum level, stock in/out/correction, counted vs expected |
| Stock alerts | variant, SKU, current stock, threshold, branch |
| Customers (list, detail) | tier (retail/member/vip), points, total spent, order count, order history, note |
| Orders (list, filter, detail) | code, channel, amount, status; filter by status/channel/branch/date range; lines, customer, shipping fee, discount, status timeline |
| Home | today's revenue and growth, 7-day revenue, best sellers, low-stock count |

## Sub-projects (in order)

Each row is its own spec → plan → implementation cycle.

| # | Sub-project | Scope | Unblocks on mobile |
|---|---|---|---|
| P0 | Platform tenancy | Account, Tenant, Branch, AccountTenant(role); create store; select/switch tenant; `tid` + `roles` claims; `@pbl/auth` tenant support. Spec: [P0 design](2026-10-10-p0-platform-tenancy-design.md) | — (foundation) |
| P1 | Event bus | `libs/events`: transactional outbox (publish retry with backoff) and idempotent inbox per service schema, relay to SNS, SQS consumers with per-message failure reporting; a DLQ + redrive policy (`maxReceiveCount` 3) on every queue and SNS subscription, plus a redrive script; versioned contracts in `libs/contracts`; LocalStack (SNS+SQS+Lambda) replaces ElasticMQ with the same definitions as production, running pbl-mail-service locally; tests for retry → DLQ, redrive, duplicates, SNS outage; tenant-scoped repository base | — (foundation) |
| P2 | Catalog core | Category, Brand, Attribute/Value, Product, ProductVariant, VariantAttributeValue; CRUD + search; publishes `catalog.variant.*` | Products |
| P3 | Commerce · inventory | Variant read model (from P2 events), StockItem, StockThreshold, InventoryLedger, receipts/issues (stock in/out/correction), transfers, stock takes, low-stock query | Inventory, stock take, alerts |
| P4 | Commerce · customers | CustomerGroup, Customer, CustomerAddress, MembershipTier, LoyaltyAccount/Transaction/Setting | Customers |
| P5 | Commerce · sales (POS) | SalesChannel, Shift, Order/OrderItem/Payment/OrderStatusHistory; stock deduction in the same transaction; loyalty points; returns; optimistic locking (`version`) | Orders |
| P6 | Insight · dashboard | Read models fed by order and stock events: daily revenue, best sellers, low-stock count | Home |
| P7 | Promotions & coupons | Promotion, conditions, benefits, Coupon, usage; applied to order pricing in P5 | Full POS |
| P8 | Catalog advanced | ComboItem, UnitConversion, PriceList (+channel, customer group) | Full POS |
| P9 | Purchasing | Supplier, PurchaseOrder → stock receipts | — |

Deferred beyond P9: Staff login and RBAC (permissions in tokens,
`@RequirePermission`), plans/subscriptions, finance, integration
(marketplaces). Staff/RBAC should be scheduled before the POS is used by
non-owners.

## Cross-cutting rules (apply to every sub-project)

1. **Tenancy ([ADR-0008](../decisions/0008-tenancy.md)).** Every business
   table has `tenant_id`. The tenant comes only from the token's `tid`
   (`@CurrentTenant()`), never from the request. Every query filters by it
   through the tenant-scoped repository base. Other tenants' rows answer 404.
2. **Data across services only through events ([ADR-0007](../decisions/0007-event-bus.md)).**
   No runtime REST calls between services for business data and no
   cross-schema reads (ADR-0002). A consumer keeps its own read model (e.g.
   commerce's copy of variants). Orders store a snapshot of name, SKU and
   price at sale time (the ERD's `OrderItem` columns).
3. **Events are published through a transactional outbox:** the state change
   and its event commit together. Consumers are idempotent through an inbox
   table, and events carry `tenantId`, `eventId`, `occurredAt`, `version`.
4. **Ownership follows the service boundaries** in CLAUDE.md. The dashboard
   belongs to insight, built from events, not by reading commerce tables.
5. **API conventions:** [docs/conventions/api-conventions.md](../conventions/api-conventions.md):
   gateway path `/<service>/api/v1/<resource>`, every route in `krakend.json`
   with `auth/validator` when protected, `@pbl/auth` in every service,
   Swagger per service, offset pagination (`PageOptionsDto`) for lists.
6. **Money** is stored as integer VND (`bigint`), matching the mobile's
   `int` amounts. There are no fractional currencies in scope.

## Out of scope for the whole roadmap

- Changing pbl-mobile or pbl-web code (tracked separately; each sub-project
  lists the endpoints that become available).
- Production deployment (see `docs/deploy-actions.md`).
