# First wave: inventory

Branch `feat/first-wave-screen-apis`. Everything lives in `apps/inventory/**`. Gateway routes:
`/tmp/claude-1000/-home-truong-Code-PBL6/25df95e7-b007-408f-a3ea-a382b0d5d4e9/scratchpad/routes/inventory.json` (40 routes).
Permissions: `*.view` = owner, manager, cashier; create/update/approve/delete = owner, manager (comment on each controller).

## 1. Built

Status column is against `02-catalog-inventory.md`. Writes that answer 200 are actions (`POST` verbs) as in the conventions.

| Method | Path | Status |
|---|---|---|
| POST | /stock-receipts | unchanged (applies stock at once, same response) |
| GET | /stock | changed: added `q` (SKU), `level`, `sort` (sku, available, onHand, reserved), `order`; rows gain `minQuantity`, `maxQuantity`, `level`; no `variantId`/`name`/`variantLabel` (no variant data here) |
| GET | /stock/summary | as contract, `stockValue` always null, `byBranch` has `branchName` from the projection |
| GET | /stock/lookup | changed: exact SKU match only; `variantId`, `barcode`, `name`, `variantLabel`, `price` are null |
| GET | /stock/export | as contract (CSV, max 10,000 rows, same filters as the list) |
| POST, GET | /stock-thresholds | upsert keyed by (branch, sku), 200; list added (not in contract) |
| GET | /ledger-entries | changed: filter by `sku` (not `variantId`); `variantId`, `refCode`, `actor` are null |
| GET, POST | /suppliers | as contract (list masks phone; `q` on name, code, phone; `sort` createdAt, code, name, debtBalance) |
| GET, PATCH, DELETE | /suppliers/{id} | as contract (soft delete 204) |
| GET, POST | /purchase-orders | changed: lines use `sku, name, unitName, quantityOrdered, unitCost, vatRate`, `variantId` optional |
| GET | /purchase-orders/summary, /export | as contract |
| GET, PATCH | /purchase-orders/{id} | as contract; `receipts` is always `[]` |
| POST | /purchase-orders/{id}/submit, approve, cancel | as contract (200 + the order) |
| POST | /purchase-orders/{id}/payments | as contract (201) |
| POST, GET | /stock-transfers, /stock-transfers/{id} | as contract, items keyed by `sku` (+ optional `variantId`) |
| POST | /stock-transfers/{id}/ship, receive, cancel | as contract, see decisions 9-10 |
| POST, GET | /stock-takes, /stock-takes/{id} | changed: body `{branchId, skus?, note?}` (no scope/category) |
| PATCH | /stock-takes/{id}/items | as contract incl. `mode: increment`; items keyed by `sku` |
| POST | /stock-takes/{id}/complete, cancel | changed: sets on hand = counted (decision 11) |
| POST, GET | /stock-issues, /stock-issues/{id} | changed: status `draft` (no `pending_approval`, no `submit` flag) |
| POST | /stock-issues/{id}/approve, cancel | as contract, 409 on shortage |

Migration `1792100000000-add-purchasing-and-documents`: `code_sequence`, `stock_threshold`, `supplier`, `purchase_order`,
`purchase_order_line`, `supplier_payment`, `stock_transfer`(+`_line`), `stock_take`(+`_line`), `stock_issue`(+`_line`).
`inventory_ledger.ref_type` is an unconstrained varchar(20), so the new types (`issue`, `transfer_out`, `transfer_in`,
`stock_take`) needed no change. Codes: NCC0001, PO00001, DC00001, KK00001, PX00001 per tenant. New error codes: I005-I009,
I011-I013 as in the contract, plus I014 (version conflict) and I015 (count below held quantity).
Events: none produced or consumed beyond today's.

## 2. Deferred

- Draft/approve stock receipts, receiving against a PO (`partially_received`/`received` stay in the enum, nothing enters them), `receipts` on a PO: binding decision 4.
- Barcode lookup, variant/name/price fields on stock rows and lookup: need catalog data (decision 5).
- `stockValue` / average cost: no unit cost on receipts yet.
- Events (`inventory.stock.below_min`, `purchase_order.*`, `supplier_payment.recorded`, `transfer.*`, `stocktake.completed`, `stock.changed`) and the insight notifications: not in this wave's scope.
- Ledger `actor` and `refCode`: not stored on ledger rows.
- Stock take `scope=category`, `categoryId`: catalog data.
- Supplier `totalPaid` is kept, but there is no supplier-payment list endpoint.

## 3. Decisions to review

1. Raw SQL with an explicit `tenant_id` filter (as `ReservationsService` does) instead of `TenantScopedRepository` for all new tables; only the branch projection uses the scoped repository (`BranchGuard`). Alternative: entities + scoped repos for the plain reads.
2. `GET /stock` response now has three extra fields; the existing int test expectation was updated. The receipt response keeps its exact old shape (`StockQuantityRes`).
3. `level`: `out_of_stock` when available <= 0, `below_min` when a min exists and available < min, else `ok`.
4. `summary.skuCount` counts distinct SKUs; `belowMinCount`/`outOfStockCount` count stock rows (SKU x branch). `fillRate` = available / sum of max of that branch, rounded to 2 decimals, null without maxes.
5. Thresholds are keyed by SKU text; `variantId` is stored unvalidated. `minQuantity`/`maxQuantity` nullable (null clears). max < min answers 422.
6. Duplicate supplier phone (I009) and supplier in use (I011) answer **409**, not the contract's 400 (rule: conflicts are 409). Delete is blocked by open POs (draft, pending_approval, approved, partially_received) or debt > 0.
7. Supplier debt = sum of remaining amounts of approved-or-later POs: `approve` adds the total, a payment subtracts, cancelling an approved PO subtracts what is unpaid. Payments are accepted from `approved` on (earlier -> 400 I007). `depositAmount` is stored for display only; it does not count as paid.
8. PO lines are pre-VAT, VAT per line = round(subtotal x rate / 100); 14.200.000 + 1.136.000 = 15.336.000 is a unit test and an int test. `vatRate` 0-10 whole number. PO cancel is allowed from draft, pending_approval and approved.
9. Transfer cancel from `in_transit` returns the goods to the source with ledger type `transfer_in` (the contract says "ledger rows" without a type). `receive` accepts `items: [{sku, receivedQuantity}]`; the shortfall is not added anywhere (lost in transit), `receivedQuantity` > shipped is 422.
10. Ship/issue approval can only take `on_hand - reserved`; a shortage answers 409 `I002` with `details: [{sku, requested, available}]` (the contract says 400 at approve; the task asked for 409, same as reservations). The whole transaction rolls back, rows are locked in SKU byte order like the reservation code.
11. Stock take complete sets `on_hand = counted`; the ledger change is `counted - current on hand` (not `counted - snapshot`) so movements during the count are not undone. Counting below the held quantity answers 409 `I015` and rolls back. Lines never counted are untouched. A SKU added during the count gets the current on hand as system quantity.
12. Stock issue statuses are `draft`, `approved`, `cancelled` (approve straight from draft); the contract's `pending_approval`/`submit` is skipped because there is no separate approver step in wave 1.
13. Optimistic locking: every document and supplier has `version`; the optional `version` in a body is checked (409 `I014`) and every change bumps it.
14. Dates: `from`/`to` filter on `created_at` in Asia/Ho_Chi_Minh. `expectedDate` is a `date` column returned as `YYYY-MM-DD`; "due this week" = expected within today..today+7 (VN date) and approved/partially_received.
15. CSV: CRLF, a field starting with `= + - @` is prefixed with `'` (formula injection) unless numeric; no BOM.
16. `created_by` on documents is the token subject when it is a UUID (else null); it is not returned yet.
17. Phone mask keeps the first three and last two digits (`028 ••• •• 36`).

## 4. Needs from shared files

- `krakend/krakend.json`: the 40 routes in `routes/inventory.json` (the `stock/summary|lookup|export` and `purchase-orders/summary|export` entries are separate gateway routes; KrakenD matches them literally). `Idempotency-Key` is not used here.
- Nothing for compose, topology or libs.

## 5. How to verify

```
pnpm exec tsc -p apps/inventory/tsconfig.app.json --noEmit                                   # clean
pnpm exec jest apps/inventory --maxWorkers=2                                                 # 7 suites, 124 tests pass
pnpm exec jest --config libs/events/test/jest-int.json apps/inventory/test --maxWorkers=1    # 2 suites, 59 tests pass (Postgres :25432)
pnpm exec eslint apps/inventory ; pnpm exec prettier --check apps/inventory                  # clean
```
The int suite runs migration up, down and up again, the SQL of every list filter, the counters, every state machine,
concurrent payments and concurrent shipments, and a cross-tenant check per resource.
