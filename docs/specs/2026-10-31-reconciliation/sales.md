# Reconciliation: sales service (THEIRS dhtphu05 M3 vs MINE first wave + RBAC)

THEIRS = `WT/apps/sales` (WT = scratchpad `wt17`). MINE = `apps/sales`. Counts come from grep and ls. Nothing was built or run, so every test claim of theirs (`docs/progress-report/M3_SALES_TEST_RESULTS.md`) is unverified.

## 1. Scope and size

| Item | THEIRS | MINE |
|---|---|---|
| Routes (decorator count) | 47 (orders 7, m3-orders 6, pos/checkout 8, pos 6, shifts 5, returns 8, promotions 4, fulfillments 3) | 22 (orders 14, registers 3, shifts 3, reference 2) |
| Tables (migrations) | 18 plus outbox: orders, order_items, branch_projection, catalog_variant_projection, checkout_workflow, order_status_history, order_tenders, pos_shifts, pos_drafts, sales_returns, sales_return_items, refund_requests, order_fulfillments, fulfillment_items, promotions, coupons, coupon_usages, sales_code_sequence | 10 plus outbox: orders, order_items, branches, order_payments, order_status_history, sales_channels, shipping_providers, registers, shifts, code_sequence |
| Migrations | 4 (1791800000000, 1791800000200, 1791800000300, 1791900000200) | 4 (1791800000000, 1791800000200, 1792000000000, 1792000000100) |
| Unit spec files / `it(` cases | 5 / 44 | 8 / 70 |
| Integration (`*.int-spec.ts`) | 1 / 24 | 2 / 52 |
| e2e (`*e2e*`) | 1 / 11 | 2 / 24 |
| Source size | checkout.service.ts 1463 lines, sales-domain.ts 1030, m3-orders.service.ts 776 | orders.service.ts 676, order-actions.service.ts 499 |

Only theirs: promotions and coupons with usage limits (`modules/promotions`), durable checkout saga `checkout_workflow` with timeout recovery (ADR-0015, `modules/checkout/checkout.service.ts`), price waterfall from a Catalog projection with `expectedUnitPrice` (409 PRICE_CHANGED), pro-rated order-discount allocation, role discount ceilings (10% cashier, 30% manager), returns with approve/reject/receive and refund requests, fulfillments, marketplace dedupe `(sourceConnectionId, externalOrderId)`, POS drafts (max 5) and quote, a `/internal/v1/reservations` client (commit, release, by-key), RLS on 17 of 18 tables, 15 published event types.
Only mine: the order-lifecycle API of the contract (summary, export CSV, print, pack/ship/complete, payments with refunds, history), channels, shipping providers, registers, `/shifts/current`, contract error codes S010-S022, `version` optimistic locking (guarded UPDATE, `orders/order-actions.service.ts:455`), branch scope (`common/branch-scope.ts`).

## 2. Contract coverage (21 sales endpoints of 03-sales-channels-customers.md; send-receipt not counted)

| Class | Count | Endpoints |
|---|---|---|
| Mine covers | 20 of 21 | all but `POST /orders/{id}/returns`. Also not in mine: send-receipt, `POST/PATCH sales-channels`, errors S012, S018, S019 |
| Theirs, same path and same shape | 0 | none matches the contract in full |
| Theirs, same path, different shape | 7 | `POST /orders` (legacy body kept, always `completed`; no `orderStatus`, `channel`, `payments`), `GET /orders` (only `page,limit,branchId`; rows have `status`, no three axes, no customer/channel objects: `orders.controller.ts:200`, `dto/list-orders.req.dto.ts`), `GET /orders/{id}` (legacy `OrderRes`: `status, paymentMethod, customerName`; no `version`, `allowedActions`, `paidAmount`: `dto/order.res.ts`), `PATCH /orders/{id}` (`m3-orders.controller.ts:57`; DRAFT or PENDING only, `version`, other body), `POST /orders/{id}/confirm`, `POST /orders/{id}/cancel`, `GET /orders/{id}/history` (shape not compared) |
| Theirs, different path | 8 | pack/ship/complete -> `POST /orders/:id/fulfillments` and `POST /fulfillments/:id/confirm` (3 routes become 2; step names not verified); payments -> `POST /pos/checkouts/:id/confirm-payment` (no standalone order payment, no refund by negative amount); returns -> `POST /returns` plus approve/reject/receive/refund-request; shifts current/open/close -> `GET /pos/shifts/active`, `POST /pos/shifts/open`, `POST /pos/shifts/:id/close` (per branch and staff, no register) |
| Missing in theirs | 6 | `GET /orders/summary`, `/orders/{id}/print`, `/orders/export`, `/sales-channels`, `/shipping-providers`, `/registers` (no register table; `pos_shifts` has no register column) |
| Theirs, needed by no contract endpoint | about 27 of 47 | promotions 2, coupons 2, POS lookup and quote 2, POS drafts 4 (contract keeps drafts inside `/orders`), checkout saga routes 12 (`/orders/checkouts*` 4, `/pos/checkouts*` 8), `POST /orders/omnichannel`, `GET /orders/:id/details`, returns approve/reject/receive/refund-request 4 |

D5 vocabulary. Contract: lowercase `orderStatus draft|new|confirmed|completed|cancelled`, `fulfillmentStatus unfulfilled|packing|shipping|delivered|returned`, `paymentStatus unpaid|partially_paid|paid|refunded|unreconciled`, plus `exceptionCode`. Theirs (ADR-0015 section 1): `order_status DRAFT|PENDING|CONFIRMED|CANCELLED|COMPLETED`, `payment_status UNPAID|PARTIALLY_PAID|PAID|REFUND_PENDING|PARTIALLY_REFUNDED|REFUNDED`, `fulfillment_status UNFULFILLED|RESERVED|PARTIALLY_FULFILLED|FULFILLED|RETURNED`. Theirs has no `new`, `packing`, `shipping`, `delivered`, `unreconciled`, `exceptionCode` (`PENDING` is close to `new`). Methods: theirs `CASH|BANK_TRANSFER|CARD|...|COMBINED` vs contract `cash|transfer|card|e_wallet|cod|marketplace`. Channel types: theirs `POS|MANUAL|ONLINE|MARKETPLACE` (`domain/sales-domain.ts:96`) vs 9 contract types in a `sales_channels` table. Error codes: theirs are strings (`PRICE_CHANGED`, `INSUFFICIENT_STOCK`), contract and mine use `S0xx`.

## 3. Data model and compatibility

| Topic | THEIRS | MINE |
|---|---|---|
| Status columns | legacy `status` (default `completed`, `orders/entities/order.entity.ts:39`) plus `order_status`, `payment_status`, `fulfillment_status` (uppercase) plus `checkout_workflow.state` | `status` is the orderStatus (lowercase), plus `payment_status`, `fulfillment_status`, `exception_code` (`order.entity.ts:40-95`) |
| Order code | legacy path `DH-<base36 time><salt>` (`orders.service.ts:712`); M3 paths `HD-YYYYMMDD-000001` from `sales_code_sequence` | `DH10001...` per-tenant counter (`common/code-sequence.service.ts:28`), as D4 |
| Money | legacy bigint VND; M3 columns `numeric(18,2)`, qty `numeric(18,3)`; two column sets on `orders` (`total_amount` and `grand_total`) | bigint VND throughout |
| Payments | `order_tenders` (tendered cash, change due), `refund_requests` | `order_payments`; negative amount is a refund; `paidAmount/dueAmount/changeAmount` |
| Shifts | `pos_shifts` per branch and staff, `expected_cash`, `variance`, `version` | `shifts` per register, `closing_cash_expected/actual`, `difference`, `version` |
| Registers | none | `registers` table and 3 routes |
| Idempotency | `UQ_orders_tenant_idempotency_key` (same index name as mine) plus `request_hash`; `checkout_workflow` unique `(tenant, idempotency_key)` | same index and hash; `POST /payments` also takes the header |

Conflicts if both lived in schema `sales`: migrations 1791800000000 and 1791800000200 have the same class names and purpose in both trees (common ancestor, not diffed, verify before merging). `orders` would get two extensions with same-named columns of different types (mine in `1792000000100-extend-orders.ts:38-42` bigint `subtotal, discount_amount, shipping_fee, paid_amount`; theirs numeric(18,2) in `1791900000200-create-m3-sales-core.ts:213-224`). `order_status_history`, `shifts`/`pos_shifts`, `code_sequence`/`sales_code_sequence` would exist twice with different shapes. `orders.status` (`completed`) and `order_status` (`COMPLETED`) would diverge.
Existing `POST /orders` in theirs (`orders.service.ts:159-250`): behaviour kept. Body `{branchId, paymentMethod, items[{sku,name,quantity,unitPrice}]}`, UUID `Idempotency-Key`, 201, 200 plus `Idempotency-Replayed` on replay, 409 on payload mismatch, status `completed`, reserves via the old `/internal/reservations`, emits `sales.order.completed`. The legacy contract survives, but none of the new contract body fields exist on it (M3 features sit behind `/orders/omnichannel` and `/pos/checkout`).

## 4. Reservation, events, cross-service

| Topic | THEIRS | MINE |
|---|---|---|
| Reservation | legacy `POST /internal/reservations` (`inventory/inventory.client.ts:67`) for `POST /orders`; warehouse-scoped `POST /internal/v1/reservations`, `/commit`, `/release`, `/by-key/:key` (`inventory.client.ts:121-285`) for saga, confirm, cancel (needs their M2 warehouse inventory) | only `POST /internal/reservations` by sku and branch, release by `DELETE` (`orders/orders.service.ts:538`); confirm reserves, cancel releases |
| Published | 15 types: order.created/confirmed/cancelled/completed, checkout.completed, checkout.reconciliation_required, tender.recorded, payment.confirmed, return.created/approved/completed, refund.requested, shift.opened/closed, fulfillment.completed (`libs/contracts/src/topology.ts`) | `sales.order.completed` only (`orders.service.ts:234`, `order-actions.service.ts:209`); other contract events not emitted |
| Consumed | branch created/updated, catalog product/variant/price, inventory reservation events | branch created/updated |
| `sales.order.completed` payload | no `channel`, no `costAmount`; `customerId` and decimal strings only on the checkout path (`checkout.service.ts:1161`), absent on legacy `POST /orders` (`orders.service.ts:232-247`) | adds `channel`, `customerId`, `costAmount: null` (`orders/order-events.ts`) |

Cross-use. My insight (`apps/insight/src/sales-summary/sales-summary.handler.ts:77`) and customer handlers default a missing `channel` to `pos` and leave customer and cost unknown, so their sales would not crash them, but all revenue would land in channel `pos`, `by-channel` would be one bar, cost/margin empty, and legacy-path orders carry no customer so loyalty skips them. Their topology subscribes customer, finance, insight, inventory, integration to events mine never emits (`sales.order.cancelled`, `sales.return.completed`, `sales.tender.recorded`...): with my sales they would get nothing (no point reversal, no refunds in finance). My inventory only has `/internal/reservations`, so their saga, confirm and cancel (v1 routes) would fail against it (not run).

## 5. Tenancy and authorization

| Topic | THEIRS | MINE |
|---|---|---|
| Tenant | RLS: `enableTenantRlsPolicy` on 17 of 18 tables (`migrations/1791800000300-...:52`, `1791900000200-...:30-544`), per-service DB role (their ADR-0019, `libs/events/src/database/pbl-database.module.ts:109`). `TenantScopedRepository` only in 2 files (15 uses); M3 modules use raw SQL with explicit `tenant_id` (32 hits in `modules/`) and `runInTenantTransaction`/`TenantContext` (43 hits) | `TenantScopedRepository`; no RLS helper in my `libs/events` |
| Authorization | `@RequireRoles(OWNER, MANAGER, CASHIER)` at class level on all 8 controllers; OWNER/MANAGER on returns approve/reject, promotions and coupons create, checkout reconcile; discount override by string `sales.pos.discount.override`; no branch scope | `@RequirePermission('orders.view'...)` per route, `pos.*`; branch scope in services (`common/branch-scope.ts`, 404 outside scope) |

Moving theirs to my catalog: replace 8 class-level `@RequireRoles` with per-route `@RequirePermission`: orders routes to `orders.view/create/update/delete`, shifts, POS, checkout to `pos.view/create/update`. Returns, promotions, coupons and fulfillments have no code in `libs/contracts/src/permissions.ts` (only orders and pos for sales), so new codes and a role-matrix update are needed. Branch scope has to be threaded into checkout, m3-orders, shifts, returns, pos, fulfillment services, none of which take a scope today. Effort estimate, not measured: 3-4 days.

## 6. Quality signals

| Check | THEIRS | MINE |
|---|---|---|
| Error shape | `{errorCode, message}` via `SalesExceptionFilter` (`presentation/sales-http-error.ts:17-33`), string codes | `{errorCode: 'S0xx', message}` (`common/errors.ts`) |
| Pagination | `{data, pagination{limit,currentPage,nextPage,totalRecords,totalPages}}` (`orders.service.ts:418`); list has no filters | same envelope, with filters |
| Concurrency | `FOR UPDATE` on shifts (`shifts.service.ts:220`), `pessimistic_write` (`checkout.service.ts:951,1387`), advisory lock on the key (`orders.service.ts:211`); no DB lock across HTTP (per ADR, not traced) | guarded UPDATE `WHERE version = x` (`order-actions.service.ts:455`) |
| Tests | 79 cases in the app; stress and fault tests A-O reported, unverified | 146 cases in the app |

Risks seen in theirs: production code branches on test doubles, `typeof (em as {query?}).query === 'function'` and `typeof orders.findOne === 'function'` (`orders.service.ts:211,217`); `@Optional()` on the workflow repository (`orders.service.ts:152`) hides a missing dependency; `Math.max(1, Math.round(Number(l.qty)))` in event items (`checkout.service.ts:986,1178`) turns a decimal quantity like 0.4 into 1; raw SQL in M3 modules bypasses `TenantScopedRepository` (convention of CLAUDE.md, ADR-0008) and relies on RLS plus manual `tenant_id`; one 1463-line service. Other CLAUDE.md conventions not checked.

## 7. Assessment

| | Cost |
|---|---|
| Adopt THEIRS (for me) | Large. Build 6 missing endpoints (summary, print, export, channels, providers, registers). Rewrite statuses to D5 lowercase three-axis plus `exceptionCode`, 9 channel types, `S0xx` codes, `version` and `allowedActions`, list filters and shapes. Add `channel/costAmount` to the event or insight degrades. Permission catalog and branch scope across 6 services. Saga needs warehouse inventory, which mine lacks. Estimate not measured: 2-3 weeks |
| Adopt MINE (for them) | Medium. They lose promotions, saga recovery, price waterfall, returns with disposition, fulfillments, RLS on sales tables and 14 of 15 event types unless ported; their finance, customer, integration subscribers lose producers for tenders and returns. Estimate not measured: 1-2 weeks to port saga and returns |

Unique value of theirs: checkout saga with recovery, price and discount engine, returns and refunds, promotions, RLS, rich events. Unique value of mine: contract coverage for the Figma screens (20 of 21), D5-compatible statuses, `DH` codes, registers and channels, the `sales.order.completed` payload that insight and customer read, permissions and branch scope.

Recommendation: keep MINE as the sales API and schema, because the contract and the downstream readers depend on it, and port selectively from THEIRS: returns (`POST /orders/{id}/returns` on their pro-rated refund logic), the saga recovery only if the POS needs a stock commit step, the RLS migration helper, price waterfall and promotions as later work, and the extra events (`sales.order.cancelled`, `sales.return.completed`, `sales.shift.*`, `sales.payment.recorded`). Do not run both in schema `sales`: table names and migration ids collide.
