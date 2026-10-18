# ADR-0010: Eight services: `commerce` is split into `inventory`, `sales` and `customer`

- **Status:** Accepted (direction, 2026-10-18). Amends ADR-0001, ADR-0002 and ADR-0007. The stubs are generated; no business code exists yet.
- **Date:** 2026-10-18
- **Scope:** service boundaries, data ownership, the stock reservation, payment placement; `apps/*`, `docker/postgres-init-schemas.sql`, `krakend/krakend.json`, pbl-infra diagrams. Full design: [eight-service decomposition](../specs/2026-10-18-eight-service-decomposition-design.md).

## Context

The target architecture had six services and a deliberately large `commerce`
(POS, inventory, purchasing, promotions, CRM) so that a sale and its stock
movement committed in one database transaction. Two things changed:

- The project has to demonstrate service-oriented design, and a service that
  holds three bounded contexts (selling, stock, customers) hides the
  boundaries a reviewer should be able to see. "Product" already means a
  description in `catalog`, a stock-keeping unit with a quantity in
  inventory, and a priced line in an order.
- Nothing in `commerce` is built yet (only `GET /health`), so splitting it
  now costs a design change, not a migration.

The reason for keeping it whole (no overselling) has a good answer without a
shared transaction: reserve the stock atomically inside the service that owns
it.

## Decision

Eight services, one app and one Postgres schema each:

| Service | Owns | Subdomain |
|---|---|---|
| `platform` | accounts, tenants, branches, auth, (later) staff, RBAC, plans | generic |
| `catalog` | categories, brands, products, variants, combos, units, price lists | supporting |
| `inventory` | stock, reservations, ledger, receipts, issues, transfers, stock takes, suppliers, purchase orders | **core** |
| `sales` | channels, shifts, orders, payments, returns, promotions, coupons | **core** |
| `customer` | customers, groups, addresses, membership tiers, loyalty | supporting |
| `finance` | cash book, customer/supplier/shipping debt, shipments, COD reconciliation | supporting |
| `integration` | marketplace connections, SKU mapping, webhooks, (later) payment gateways | supporting |
| `insight` | reports, notifications, audit log (read side) | generic |

- **`platform` keeps its name.** The roadmap proposed `identity`, but platform
  also owns tenants, branches and (later) plans, the token issuer is
  `platform`, and web/mobile already call `/platform/...`. A rename would
  break all three for no architectural gain.
- **`commerce` is removed.** Its modules map one to one: `inventory` and
  `purchasing` to `inventory`; `sales` and `promotion` to `sales`;
  `customer` to `customer`.
- **Promotions and coupons stay in `sales`.** Coupon usage limits must be
  atomic with the order, and discounts are part of pricing. **Purchasing
  stays in `inventory`:** a received purchase order is a stock receipt.
  **Customers are separate** because loyalty has its own lifecycle and rules.
- **Stock reservation, not a shared transaction.** `sales` asks `inventory` to
  hold the lines of an order; `inventory` does it in one conditional update
  per line (`quantity_on_hand - quantity_reserved >= qty`), idempotent by
  `(tenant_id, order_id)`, with an expiry so a crash between the call and the
  order cannot lock stock. Completing the order (`order.completed`) turns the
  reservation into a deduction and a ledger entry; cancelling it
  (`order.cancelled`, expiry) releases it. See the design for the sequence.
- **One synchronous command is allowed.** ADR-0007 forbids runtime REST for
  business data but explicitly keeps it for commands that must be
  synchronous. The reservation is that command: `sales` calls
  `inventory` through `InternalHttpClient`, which forwards the caller's token,
  so `inventory` verifies the user and derives the tenant itself. The route is
  internal: it is not declared in `krakend.json`, so it is unreachable from
  outside. The call has a timeout and a circuit breaker; the default when
  `inventory` is unavailable is to refuse the sale (fail closed), which the
  P5 spec may relax per channel. Everything else stays event-driven.
- **Payment is split by concern, not given its own service.** The payment
  record and `payment_status` belong to `sales` (atomic with the order). The
  money ledger (cash book, debt, COD) belongs to `finance`, fed by
  `order.payment.recorded`. An online payment gateway, if built, is a
  connector in `integration` that emits `payment.gateway.confirmed`; only
  `sales` writes `payment_status`. A separate payments service would be
  justified only if card data or a wallet were handled in-house (PCI scope).
- **Sagas.** Three, each with explicit compensation: marketplace order intake
  (orchestrated by `integration`), COD reconciliation (choreographed between
  `finance` and `sales`), and sale reservation (orchestrated by `sales`).
  Do not add a fourth without a reason that a local transaction cannot meet.
- **When to split further.** Only on a measured reason: a different scaling
  or failure profile, a different team or release cadence, or a consistency
  need that differs from its neighbours. Two services that always change
  together are one service. Candidates are listed in the design; none is
  planned.
- **Inside a service, modules stay separate.** `sales` and `inventory` each
  keep one Nest module per area and no imports across areas except through a
  public interface, so a later extraction is a move, not a rewrite.

## Consequences

- Event catalog v2 (design doc): `inventory`, `sales` and `customer` replace
  `commerce` as producers and consumers; `order.delivery_failed` and
  `inventory.reservation.expired` are new.
- The event bus (P1) is required before P3 and P5, not optional.
- `sales` keeps read models of variants, branches, staff and customers;
  `inventory` of variants and branches; `customer` of orders (for total spent,
  order count and history) and of debt from `finance`.
- Stock on the order screen comes from `inventory` through the BFF route, not a
  join. The cross-service query is a gateway concern, not a database one.
- Reserved subdomains (`CreateTenantReqDto`) now include `inventory`, `sales`
  and `customer`; `commerce` is no longer a service name.
- pbl-infra diagrams, the ERD grouping and (when deployed) ECR repositories
  and ECS services follow eight services.
- Gaps this ADR does not close: service-to-service tokens for calls made
  outside a request (ADR-0004 §8) and per-service database roles
  (ADR-0002 target).

## Alternatives considered

- **Keep `commerce` whole:** simplest, and the original choice. Rejected
  because it hides three bounded contexts and the reservation pattern.
- **Two services (`sales`, `inventory`) with customers and promotions inside
  `sales`:** the lean option, fewer sagas. Kept as the fallback if `customer`
  proves too thin to justify its events.
- **One service per module (promotion, purchasing, loyalty, ...):** nano
  services. Each would add a service with no scaling or failure reason.
- **Split by workflow (POS, online order, returns):** duplicates the same
  entities across services and forces constant synchronisation.
