# Phase 4: sales serves the screen contract

Scope: `apps/sales/**`, `libs/contracts/src/events.ts` (types only) and this report. Their routes and shapes are kept; every
change below is an extra optional field, extra query parameter or a new route. Gateway path = `/sales` + the path.

## Route table (all `@RequirePermission`, branch scope 404, lists filtered)

| Method, path | Permission | Covers (03-sales) |
|---|---|---|
| GET `/api/v1/orders/summary` | orders.view | `orders/summary` (missing) |
| GET `/api/v1/orders/export` | orders.view | `orders/export`, CSV with BOM, 422 `EXPORT_TOO_LARGE` above 10,000 (missing) |
| GET `/api/v1/orders/{id}/print?type=&paper=` | orders.view | `orders/{id}/print` (missing) |
| GET `/api/v1/sales-channels` | orders.view | `sales-channels` (missing; six types seeded per store on first read) |
| POST, PATCH `/api/v1/sales-channels[/{id}]` | channels.update | the "Related" rename/disable |
| GET `/api/v1/shipping-providers` | orders.view | `shipping-providers` (missing) |
| GET `/api/v1/registers?branchId=` | pos.view | `registers` (missing; a branch with none gets `Q01`) |
| POST, PATCH `/api/v1/registers[/{id}]` | pos.update | the "Related" create/rename |
| GET `/api/v1/shifts/current?registerId=` | pos.view | `shifts/current` (404 `SHIFT_NOT_OPEN`) |
| POST `/api/v1/shifts` | pos.create | open shift on a register |
| POST `/api/v1/shifts/{id}/close` | pos.create or pos.update | close with `version`, `closingCashActual`, per-method totals |
| POST `/api/v1/orders/{id}/pack`, `/ship`, `/complete` | orders.update | stepper (body `{version}`, ship adds provider, tracking) |
| POST `/api/v1/orders/{id}/payments` | orders.update | payments, negative = refund, `Idempotency-Key` required |
| POST `/api/v1/orders/{id}/returns` | orders.update or pos.create | returns on the order |
| POST `/internal/v1/orders/omnichannel` | `x-internal-token` | integration creates marketplace orders. NOT in krakend |

Changed existing routes (same path): `GET /orders` (filters), `GET /orders/{id}` (fields), `GET /orders/{id}/history?view=timeline`,
`PATCH /orders/{id}` (now orders.update or pos.create), `POST /orders/{id}/confirm|cancel` (optional `version`).
Gateway: add the new client routes (18 entries; `{id}` params); `GET /orders/summary` and `/export` before `/orders/{id}`.

## Shape additions

- `GET /orders`: query `q, tab (all|new|confirmed|packing|shipping|completed|needs_action|processing), orderStatus, paymentStatus,
  fulfillmentStatus (comma lists), channel, customerId, registerId, from, to, sort (createdAt|totalAmount), order`. Rows keep
  `status, paymentMethod, customerName, items: []` and gain `orderStatus, fulfillmentStatus, paymentStatus, exceptionCode,
  externalOrderCode, customer{id,name,phoneMasked}, channel{id,type,name}`. Dates `YYYY-MM-DD` are days in UTC+7.
- `GET /orders/{id}`: old keys kept, plus `version, source, branch, channel(+environment), three axes, exceptionCode, subtotal,
  discountAmount, shippingFee, taxAmount, paidAmount, dueAmount, changeAmount, customer, shipping, payments[], note, receivedAt,
  allowedActions`; items gain `id, variantId, skuCode, productName, variantName, discountAmount`. A first-generation order
  (M3 columns at 0) reads its amounts from `total_amount` and as paid.
- D5 mapping (stored enums unchanged): PENDING=new, packing/shipping come from new `orders.fulfillment_stage`, RESERVED=unfulfilled,
  FULFILLED=delivered, REFUND_PENDING and PARTIALLY_REFUNDED read as `paid`. `unreconciled` is never produced.
- `PATCH /orders/{id}`: `version` alias of `expectedVersion`, `orderStatus: "confirmed"` finalises (needs orders.update), `warehouseId`.
- `POST /pos/shifts/open`: optional `registerId`; shift responses gain `registerId`; close takes optional `version`.
- Event `sales.order.completed`: `channel` (pos, manual, website, marketplace or the channel row type), `channelId`, `costAmount`
  (sum qty x `unit_cost_snapshot` of lines that carry one, else omitted), items gain `variantId`.
- Schema (baseline migration edited in place): `orders.fulfillment_stage, exception_code`; `pos_shifts.register_id`;
  `order_tenders.kind (PAYMENT|REFUND), note, paid_at` and method `MARKETPLACE`; new tables `sales_channels, registers,
  shipping_providers` (tenant column, RLS, bigint untouched).

## Behaviour notes

- (a) Emitters: checkout (variant ids, `channel: pos`, cost) and legacy `OrdersService` (both emissions, `channel: pos`). No cost
  exists in the catalog projection today, so `costAmount` is always omitted for real data (tested with a seeded snapshot).
  New: an order that becomes COMPLETED through fulfilment confirm or its last payment now emits `sales.order.completed`
  too (manual, website, marketplace orders were invisible to insight and customer before). Guard: only when it was not COMPLETED.
- (b) Internal route: `InternalTokenGuard` (copy of inventory's) before anything reads `X-Tenant-Id`; 401 without a valid token,
  400 for a missing or non-UUID tenant; `@Public()`, tenant set with `TenantContext.run` only after the guard. Actor is the zero
  UUID, all branches, lowest discount tier. Only here: `lines[].unitPriceOverride` (marketplace price), stock shortage on
  auto-confirm leaves the order PENDING with `exceptionCode: stock_shortage` and answers 201 with `shortageDetected, shortages`,
  `exceptionCode` (`sku_unmapped|stock_shortage`). Replay by `(sourceConnectionId, externalOrderId)`: 200 + `Idempotency-Replayed`.
- Lifecycle: pack needs CONFIRMED and no stage; ship needs PACKING and creates a SHIPPED fulfilment; complete confirms open
  fulfilments (stock commit) or makes a pickup one; the order completes when paid, else stays `confirmed`/`delivered` until the
  last payment completes it. Cancel is refused once SHIPPING. Refund reduces `paid_amount`, adds `refunded_amount`, moves open
  shift cash.

## Contract mismatches left

- `POST /orders` keeps the legacy body (`sku, name, quantity, unitPrice`); the contract body (`source, variantId lines, shipping,
  payments, orderStatus`) is served by `POST /orders/omnichannel` (+ PATCH, confirm). Not merged: would break the legacy consumer.
- Error codes stay in their style (`ORDER_INVALID_STATE` 409 for S015/S016, `PAYMENT_EXCEEDS_DUE` S017, `RETURN_NOT_ELIGIBLE` S018,
  `RETURN_QUANTITY_EXCEEDED` S019, `EXPORT_TOO_LARGE` S020, `SHIFT_ALREADY_OPEN` S021 (409, not 400), `SHIFT_HAS_PENDING_TRANSACTIONS`
  S022 (pending checkouts only, no list of drafts), `INSUFFICIENT_STOCK` S004, `UNKNOWN_BRANCH` S010-ish). S011-S013 not built.
- `history` default shape stays the entity array; the contract shape is `?view=timeline`.
- `q` searches code, external code, customer name only (phone lives in customer). `phoneMasked`, `groupName`, staff names null.
- `shipping.addressText` is null: sales stores no recipient or address. Close shift `scheduledEnd` null (platform schedule).

## Deferred

- Shipping address and recipient capture (needs columns on orders and the contract create body). Refund event (`sales.payment.recorded`
  for a refund, `sales.order.returned`) and send-receipt (mail queue). Store name/address in print (platform lookup).
- Feeding `sales_channels` from integration connections and `shipping_providers` from finance (no event exists); until then
  defaults are seeded lazily (decision below). `unreconciled` payment status (needs finance COD reconciliation).
- Draft-invoice check on shift close (drafts have no shift link).

## Events added

`sales.order.packing`, `sales.order.shipped` (`SalesOrderShippedPayload`) in `events.ts`; emitted, not in `topology.ts` (no subscriber:
finance should create its Shipment from `shipped`). Existing `sales.tender.recorded` and `sales.payment.confirmed` are now also
emitted by `POST /orders/{id}/payments` (payments only). `OrderCompletedPayload` gained `channelId` and item `variantId`.

## Decisions to review

1. Seeded data: six channels per store, four shipping providers, register `Q01` per branch (lazy, idempotent). Alternative: none.
2. A delivered, unpaid (COD) order stays `confirmed`; contract says `complete` gives `completed`.
3. Summary: `tabCounts` follow the dates, `awaitingConfirmation, inFulfillment, needsAction` are the current backlog; `all` and
   `today.total` exclude drafts while a plain `GET /orders` (no tab) still lists them.
4. One open shift per register whoever opens it (M3's own rule is per staff and register).
5. `events.ts` was edited with a read-modify-write script, not the Edit tool (three additive blocks, no other worker's lines touched).

## Cross-service changes (not made here)

- integration `SalesOrderClient`: call `POST {SALES_URL}/internal/v1/orders/omnichannel`, always as a service (no user token), add header
  `X-Tenant-Id: <cmd.tenantId>`, keep `x-internal-token`; send `qty` as a number (it sends a string, sales needs a number) and keep
  `unitPriceOverride`; read `id, code, orderStatus, fulfillmentStatus` (uppercase), `replayed, shortageDetected, shortages` from the
  body; optionally send `exceptionCode`. Update its spec.
- compose/env: `INTERNAL_S2S_TOKEN` for sales (phase 2 note). krakend: the 18 client routes above, none for `/internal`.
- finance: subscribe to `sales.order.shipped` when shipments are built. insight and customer need no change (fields optional).
- Docs: `03-sales-channels-customers.md` could note `?view=timeline` and the `fulfillment_stage` mapping.

## How verified

- `tsc -p apps/sales/tsconfig.app.json --noEmit` clean; insight, customer, finance, integration also compile.
- `jest apps/sales/src libs/contracts`: 14 suites, 411 pass. New: permission matrix for 63 routes (401, 403, each code, owner),
  422 validation of filters, bodies and money (fraction, string, zero), privileged return flags, the internal route (no token,
  wrong token, closed when unset outside test, tenant header only after token, 400 on bad tenant, replay, stripped override on the
  public route), `order-views.spec`, `order-query.service.spec`.
- Integration `apps/sales/test` on a throwaway `pgvector/pgvector:pg17` (port 55477, removed): 63 of 63 pass (25 old, 38 new in
  `screen.int-spec.ts`: filters, summary, export over 10,000 rows, stepper, payments, refunds, shift cash, returns, internal order,
  cross-tenant and branch-scope 404s, bigint above 2^31, event payloads).
- `eslint apps/sales libs/contracts/src/events.ts` and `prettier --check apps/sales`: clean.
