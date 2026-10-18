# Stock reservation: `sales` holds stock in `inventory`

- **Date:** 2026-10-19
- **Status:** Built the same day. Follows the design already approved in [ADR-0010](../decisions/0010-eight-services.md) and the [eight-service design](2026-10-18-eight-service-decomposition-design.md) ("Selling without overselling"); this file records the choices that those left open.
- **Related:** [event bus guide](../guides/events.md), [ADR-0007](../decisions/0007-event-bus.md)

## Goal

A sale must not take stock that is not there. `sales` and `inventory` no longer share a transaction, so
the protection is one atomic, idempotent command that `sales` sends to `inventory` before it creates an
order, and an event that turns the hold into a deduction once the order is completed.

Success: with 5 in stock, two cashiers selling 3 at the same moment get one sale and one refusal; stock
never goes below zero; a retried request holds stock once; stock held for a sale that never completes is
released by itself.

## Scope

In: `inventory` becomes a service with logic (stock per branch and SKU, receipts, a ledger, reservations,
an expiry job, a branch projection); `sales` calls it before an order; the demo and tests cover it.

Out: catalog variants (stock is keyed by **SKU text** like the order lines), transfers, stock takes,
thresholds and low-stock alerts, returns, cancelling orders, purchasing, a stock read model in `insight`.

## Data (schema `inventory`)

| Table | Meaning |
|---|---|
| `stock_item` | `(tenant_id, branch_id, sku)` unique; `quantity_on_hand`, `quantity_reserved`; `CHECK (quantity_reserved >= 0 AND quantity_on_hand >= quantity_reserved)` |
| `stock_reservation` | one per `(tenant_id, order_id)`: `branch_id`, `status` (`held`, `committed`, `released`, `expired`), `expires_at` |
| `stock_reservation_item` | `reservation_id`, `sku`, `quantity` |
| `inventory_ledger` | every change of `quantity_on_hand`: `change_qty`, `balance_after`, `ref_type` (`receipt`, `sale`), `ref_id` |
| `branch_projection` | the branches of platform, from events, as in `sales` |
| `inbox_event` | the inbox of the consumer |

The check constraint is the last line of defence: whatever the code does, the database refuses stock below
zero or a hold above what is on hand.

## The command

`POST /internal/reservations` on `inventory`: `{ orderId, branchId, lines: [{ sku, quantity }] }`.

- Not declared in `krakend.json`, so it is unreachable from outside. `sales` calls it through
  `InternalHttpClient`, which forwards the caller's token: `inventory` verifies it and takes the tenant from it.
- In one transaction, per line, one statement:
  `UPDATE stock_item SET quantity_reserved = quantity_reserved + :q WHERE tenant_id AND branch_id AND sku
  AND quantity_on_hand - quantity_reserved >= :q`. A line that matches nothing makes the whole call roll
  back: **201** with the hold when every line fits, **409** with the `shortages` (`sku`, `requested`,
  `available`) otherwise. Nothing is held on a refusal.
- Idempotent by `(tenant_id, order_id)`: the same order again returns the same hold with **200**
  (a `held` or `committed` one) and never holds twice. Lines are locked in SKU order, so two calls for
  overlapping SKUs cannot deadlock.
- `DELETE /internal/reservations/:orderId` releases a `held` reservation (idempotent, 204).

## Sales

Order of work in `POST /orders` (the order id is chosen first and is the reservation key):

1. a replay of the `Idempotency-Key` returns the first order, before anything else;
2. the branch is checked against the projection;
3. `inventory` is asked to hold the lines. Refused: **409 `S004`** with the shortages, no order. Unavailable
   (timeout 3 s, connection error, 5xx, or the breaker open): **503 `S005`**, no order (fail closed);
4. the order, its lines and the event commit as before. If that fails, the hold is released at once, best
   effort; otherwise it expires.

A small circuit breaker in `sales` (5 consecutive failures, open for 10 s) stops it from queueing behind a
service that is down.

## From hold to deduction

`inventory` consumes `sales.order.completed`: in the inbox transaction the reservation becomes `committed`,
`quantity_on_hand` and `quantity_reserved` both drop by each line, and a `sale` ledger row is written. If the
hold is missing or already expired (the event was very late) it deducts directly, taking no more than what is
unreserved by others and logging what was short; it never drives stock below what other holds need.

A job (every 60 s) expires `held` reservations past `expires_at` (default 15 minutes,
`INVENTORY_RESERVATION_TTL_MINUTES`) and gives the stock back, so a crash between the hold and the order
cannot lock stock.

## Endpoints for people

Through the gateway, `/inventory/api/v1/...`: `POST /stock-receipts` (owner, manager) adds stock to a branch
(`{ branchId, items: [{ sku, quantity }] }`, a ledger row each) and `GET /stock?branchId=` (owner, manager,
cashier) lists stock with the available quantity (`onHand - reserved`).

## Events

`inventory` subscribes to `platform.branch.*` (its projection) and `sales.order.completed`. It produces none
yet. `TOPOLOGY` lists both.

## Known limits

- Stock is keyed by SKU text: two spellings are two items. Catalog variants replace this in P2/P3.
- A stock receipt is not idempotent (a retried request adds stock twice).
- An order cannot be cancelled yet, so a completed order's stock only comes back through a future return flow.
- A commit that arrives after the hold expired is best effort, as described.
