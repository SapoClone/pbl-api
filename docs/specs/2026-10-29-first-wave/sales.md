# Sales: first wave

Service `apps/sales`. All changes are additive: `POST /orders` with the old body still creates a completed, paid order, holds stock in inventory and emits `sales.order.completed`.

## 1. Built

| Method | Path                                                            | Status vs contract                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/sales-channels`                                        | as contract; lazy-seeded per tenant (pos, manual, website, facebook, zalo, phone); extra field `code`                                                                                                                                                       |
| GET    | `/api/v1/shipping-providers`                                    | as contract; seeded (ghn, ghtk, viettel_post, jt_express, self_delivery) in sales' own table                                                                                                                                                                |
| GET    | `/api/v1/registers?branchId=`                                   | as contract; `branchId` required (422)                                                                                                                                                                                                                      |
| POST   | `/api/v1/registers`                                             | as contract; 201; branch checked against the projection (S001), duplicate code 409 S006                                                                                                                                                                     |
| PATCH  | `/api/v1/registers/{id}`                                        | as contract (code, name, status)                                                                                                                                                                                                                            |
| GET    | `/api/v1/shifts/current?registerId=`                            | as contract; 404 when none open; `staff.name` is `null`                                                                                                                                                                                                     |
| POST   | `/api/v1/shifts`                                                | changed: register already open is **409** S021 (contract: 400)                                                                                                                                                                                              |
| POST   | `/api/v1/shifts/{id}/close`                                     | as contract; also `paymentTotals`; S022 when drafts are open; closed shift S009                                                                                                                                                                             |
| GET    | `/api/v1/orders`                                                | extended: `q`, `tab`, `orderStatus`/`paymentStatus`/`fulfillmentStatus`/`channel` (comma lists), `customerId`, `registerId`, `from`/`to`, `sort=createdAt\|totalAmount`, `order`                                                                            |
| POST   | `/api/v1/orders`                                                | extended: `orderStatus` (draft, confirmed, completed), `source`, `channel`, `customerId`, `customerName`, `customerPhone`, `registerId`, `shiftId`, `shipping{}`, `discountAmount`, `payments[]`, `note`, line `variantId`; `paymentMethod` is now optional |
| GET    | `/api/v1/orders/summary`                                        | as contract                                                                                                                                                                                                                                                 |
| GET    | `/api/v1/orders/export`                                         | CSV, UTF-8 BOM, cap 10,000 (422 S020)                                                                                                                                                                                                                       |
| GET    | `/api/v1/orders/{id}`                                           | extended (see decision 2)                                                                                                                                                                                                                                   |
| PATCH  | `/api/v1/orders/{id}`                                           | drafts only (S014); `orderStatus: confirmed\|completed` finalises                                                                                                                                                                                           |
| POST   | `/api/v1/orders/{id}/confirm` `pack` `ship` `complete` `cancel` | as contract; `version` optional (see decision 6)                                                                                                                                                                                                            |
| POST   | `/api/v1/orders/{id}/payments`                                  | as contract; 201; negative amount = refund; S017                                                                                                                                                                                                            |
| GET    | `/api/v1/orders/{id}/history`                                   | as contract, newest first, cap 200                                                                                                                                                                                                                          |
| GET    | `/api/v1/orders/{id}/print`                                     | JSON print data, `type`, `paper`                                                                                                                                                                                                                            |

22 routes, in `scratchpad/routes/sales.json` (`Idempotency-Key` header on `POST /orders`).

Migrations (`apps/sales/src/migrations`):

- `1792000000000-create-reference-and-shift-tables`: `sales_channel`, `shipping_provider`, `register`, `shift`, `code_sequence`.
- `1792000000100-extend-orders`: order columns, `order_items.variant_id`, `order_payment`, `order_status_history`, CHECK constraints, backfill of old rows.

Events: produces `sales.order.completed` (at creation and at `complete`) with new `channel`, `customerId`, `costAmount: null`. Consumes branch events (unchanged).

Error codes added: S006 duplicate register code, S007 unknown register, S008 version conflict (409), S009 shift closed, S010 shift not open, S011 payments below total (POS), S013 customer required for cod, S014 not a draft, S015 transition not allowed, S016 cannot cancel shipped, S017 payment/refund exceeds, S020 export too large, S021 register has open shift, S022 drafts open, S023 discount above subtotal.

## 2. Deferred

- Returns and refund flow (`POST /orders/{id}/returns`, `S018`/`S019`): per instruction. A refund is only a negative payment.
- Events `sales.order.created/confirmed/packing/shipped/cancelled`, `sales.payment.recorded`, `sales.shift.opened/closed`: the names are not in `libs/contracts` (shared file) and no consumer exists.
- `Idempotency-Key` on `POST /orders/{id}/payments`: not required, not stored (the guarded version write protects against races only when `version` is sent).
- `send-receipt` (email), `qrPayload`, store name on print (platform data).
- Per-line `discountAmount`, price-list pricing and `unitPrice` omission, variant/channel validation (S012): catalog is another service.
- `POST/PATCH /sales-channels`, marketplace channels, `exceptionCode` writes (integration events), `shipping.status` projection from finance.
- Shift `staff.name` and `scheduledEnd` (platform data).

## 3. Decisions to review

1. **`status` column is the order status.** The spec says add `order_status`; the table already has `status` (existing rows `completed`). I kept it, added a CHECK, and the response returns both `status` and `orderStatus`. Alternative: a new column plus a backfill.
2. **Response shape.** Old fields stay. `channel` is `{type, name}` (names from a static map, no channel `id`); `customer` is `{id, name, phoneMasked}`; `shipping` uses `shippingProviderCode` (stable string, not the contract's `shippingProviderId`); `payments`, `allowedActions`, `paidAmount`, `dueAmount`, `changeAmount`, `version` added. Lists use the same shape with `items: []`.
3. **Drafts are hidden from `GET /orders`** unless `orderStatus` asks for them (no drafts existed before). `tab=confirmed` means confirmed and unfulfilled; `processing` = every confirmed order.
4. **Old rows backfill:** completed, fulfillment `delivered`, paid in full (`paid_amount = total`) unless method `cod` (unpaid), `subtotal = total`, channel `pos`, `stock_reserved = true`.
5. **Order code** `DH10001+` per tenant from `code_sequence`, allocated in the creating transaction. The counter row also serialises concurrent creates, so a retry that waited finds the winner's row (explicit check, otherwise `save()` would UPDATE it; found by the existing race test). Shift code `CA00001+`.
6. **`version` is optional on actions and PATCH** (contract: required). When sent and stale: 409 S008. When omitted the write is still guarded by the version just read, so a race gives 409, but a stale client without `version` is not detected.
7. **Payments model.** `order_payment` rows (negative = refund) plus denormalised `orders.paid_amount`, `change_amount`. Create with no `payments` on a completed order records the legacy payment (full total with `paymentMethod`, nothing for `cod`). Overpaying with cash stores the cash row reduced and returns `changeAmount`; overpaying with another method is S017; S011 applies only when `source: pos` is sent explicitly and `payments` is sent. S013 (cod needs a customer) applies only when new fields are used (`payments` has cod, or `paymentMethod: cod` with `source`/non-completed status), so legacy cod sales still work.
8. **Totals:** `total = subtotal - discount + shippingFee` when `feePayer` is `customer` (default when fee > 0); a `shop`-paid fee is not added. Discount above subtotal is 400 S023.
9. **Shift cash:** `expected = opening + sum of payments (incl. negative refunds) with method cash of orders with status completed and shift_id = this shift`. A legacy order without `registerId`/`shiftId` belongs to no shift. A `pos` + `completed` order with a register but no open shift is S010; a register alone picks up its open shift.
10. **S021 is 409**, not the contract's 400, per the binding conflict rule.
11. **Lifecycle:** `confirm` draft|new, `pack` confirmed+unfulfilled, `ship` confirmed+packing (optional provider code, tracking code), `complete` confirmed only (sets fulfillment delivered, writes the event in the same transaction), `cancel` draft|new|confirmed before shipping (S016 when shipping or delivered), releases the hold after commit when `stock_reserved`. `confirm` reserves before the guarded write and gives the hold back on failure only if the order is still not marked reserved.
12. **History** has `status_type` order | fulfillment | payment; actor `{type: system, id: null}` only when `changed_by` is null.
13. **Summary:** `today` uses `from`/`to` (default today in Asia/Ho_Chi_Minh); the other figures are live and ignore dates unless sent. `externalSku` is always `null`. `exceptionCode` can only be read here (nothing writes it yet).
14. **Roles:** `view`, `orders.create`, `pos.*` (shifts, current, list registers): owner, manager, cashier. `orders.update` actions, payments, register create/update, cancel (`orders.delete`): owner, manager. PATCH draft: all three (`pos.create`).
15. **Existing tests changed:** `orders.service.spec.ts` (constructor, code `DH10001`), `app.e2e.spec.ts` (extra stub providers), `test/sales.int-spec.ts` (new entities, migrations, constructor). No assertion about old behaviour was weakened.
16. Pre-existing bug seen, not touched: `1791800000200` down drops its index without a schema (harmless; the column drop removes it). My migration qualifies the index names.

## 4. Needs from shared files

- `krakend.json`: the 22 routes in `scratchpad/routes/sales.json`; `POST /sales/api/v1/orders` forwards `Idempotency-Key`.
- `libs/contracts`: event names for created/confirmed/packing/shipped/cancelled, payment recorded, shift opened/closed, if wanted.
- `docker-compose.yml`: no new env.

## 5. How to verify

```
pnpm exec tsc -p apps/sales/tsconfig.app.json --noEmit                      # clean
pnpm exec jest apps/sales/src --maxWorkers=2                                # 10 suites, 163 tests pass
pnpm exec eslint apps/sales && pnpm exec prettier --check apps/sales        # clean
EVENTS_IT_DB_PORT=25451 pnpm exec jest --config libs/events/test/jest-int.json apps/sales/test --maxWorkers=1   # 2 suites, 48 tests pass
```

Port 25432 was not reachable, so I ran a throwaway `pgvector/pgvector:pg17` on 25451 and removed it afterwards. The integration run covers migrations up, down and re-up with old rows backfilled, counters per tenant, one open shift per register (incl. two at once), two confirms at once, stock holds and release, history, payments, filters, summary, CSV, and cross-tenant 404s.
