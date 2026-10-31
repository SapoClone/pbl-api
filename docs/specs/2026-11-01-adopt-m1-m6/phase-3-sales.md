# Phase 3: sales money becomes integer VND

Scope: `apps/sales/**`, the `sales.*` money fields of `libs/contracts/src/events.ts` (Edit only) and this report.
Helper: `apps/sales/src/common/money.ts` (`toMoney`, `toMoneyOrNull`, `moneyTransformer`, `discountValueTransformer`).
The pure domain (`domain/sales-domain.ts`) still computes in bigint; it now takes and returns safe-integer numbers
(`parseVndAmount` refuses fractions and strings with 422, `vndNumber` is the way out; `formatVnd` is gone).

## Converted

| Where | Old | New |
|---|---|---|
| orders: subtotal, item_discount_total, order_discount_total, promotion_discount_total, shipping_fee, tax_total, grand_total, paid_amount, refunded_amount | numeric(18,2) string | bigint, number |
| order_items: line_gross, item_discount_amount, allocated_order_discount, line_net, tax_amount, unit_cost_snapshot, refunded_amount | numeric(18,2) | bigint |
| checkout_workflow.total_amount | integer | bigint (was overflow-prone) |
| pos_shifts: opening_cash, cash_sales_total, cash_refunds_total, expected_cash, actual_cash, variance | numeric(18,2) | bigint (variance may be negative) |
| pos_drafts.order_discount_value, orders.order_discount_value, order_items.item_discount_value, promotions.discount_value | numeric(18,2) | numeric(12,2), read as number (see Decisions) |
| order_tenders: amount, tendered_cash, change_due | numeric(18,2) | bigint |
| sales_returns.total_refund_amount; sales_return_items.unit_refund_amount, refund_amount; refund_requests.amount | numeric(18,2) | bigint |
| promotions: min_order_amount, max_discount_amount; coupon_usages.discount_amount | numeric(18,2) | bigint |
| catalog_variant_projection.unit_price | numeric(18,2) | bigint |
| orders.total_amount, order_items.unit_price/line_total | bigint (already) | same, now the shared transformer that fails on unsafe values |
| Request DTOs: tender amount/tenderedCash, shippingFee, expectedUnitPrice, checkout tenderedCash, promotion minOrderAmount/maxDiscountAmount, refund amount (min 1), shift openingCash/actualCash (was a "1000.00" string) | IsNumber / regex string | `@IsInt()` (+ `@Min`), 422 on fraction or string |
| Responses, order/shift/return/refund/coupon entities, quote, tenders, `quote_json`/`tenders_json` | strings "270000.00" | numbers |
| Events: OrderCompleted subtotal/discountTotal/taxTotal/grandTotal; SalesOrderLifecycle subtotal/discountTotal/taxTotal/grandTotal; SalesShift openingCash/expectedCash/actualCash/variance; SalesReturn totalRefundAmount; SalesRefundRequested amount | string | number. Untyped `sales.tender.recorded` / `sales.payment.confirmed` now carry numbers too |
| Calls to inventory: `receiveReturnedStock` unitCost | "0.00" | 0 (number) |
| Raw SQL: `$n::numeric(18,2)` on pos_shifts and order_items | | `$n::bigint`; every raw money row goes through `toMoney` |

Migrations edited in place (`1791800000300` and `1791900000200`); rebuild local stacks with `docker compose down -v`.

## Rounding points (all half up, line level, totals are sums of rounded lines)

1. Line gross = round(qty x unitPrice) (qty has 3 decimals).
2. Percent item or order discount = round(base x pct) (pct in basis points).
3. Order discount (manual + coupon) is shared across lines by round(share x lineNet / net); the last positive line takes
   the residual, so the allocations add up exactly.
4. Tax per line = round(lineNet x taxRate); taxTotal is the sum of the lines.
5. Coupon percent discount = round(base x pct), then capped by max discount and by the base.
6. Return refund per line = round(lineTotal x returnQty / soldQty); the final units take the exact remainder; unit
   refund = round(refund / qty).
7. Legacy `OrdersService`: line total = Math.round(qty x unitPrice), order total = sum of lines (unchanged, noted).
8. `effectiveDiscountPercent` (a percentage, not money) keeps two decimals.

## Cross-service changes

- inventory: `POST /api/v1/stock-receipts` (called by sales on a return) now receives `items[].unitCost` as an integer
  number; its DTO must accept a number (it had accepted the string "0.00"). Reservations carry no money.
- catalog: no change needed for sales; `catalog.variant.*` `basePrice` and `catalog.price.changed` `price` are already
  numbers and are stored via `toMoney` (an integer string would also pass).
- customer, finance, insight consume `sales.*` payloads: they must read the money fields as numbers. customer's
  `parseVndBigInt` already takes number|bigint only (it will now receive numbers for subtotal/discountTotal/grandTotal/
  totalRefundAmount); finance `refunds.service` (`amount`) and `reconciliation.service` (shift `openingCash`,
  `expectedCash`, `actualCash`, `variance`) and `settlements.service` (tender `totalConfirmed`, `totalCashSales`,
  `totalChangeDue`, payment `amount`) must drop any string parsing. All four apps still compile (`tsc` clean).
- Gateway/clients (web): shift open/close bodies and every money response are numbers now.

## Deferred

- `qty` inputs (decimal string/number, scale 3) and `taxRate` (string "8.00", a rate) are untouched on purpose; the
  grep hits for `toFixed(2)` in `sales-domain.ts` are that tax-rate string and a percent in an error message.
- `apps/sales/test/performance/sales-benchmark.ts` seed SQL was converted to integer literals but not run.

## Decisions to review

1. The four `*_discount_value` / `discount_value` columns hold a VND amount when the type is FIXED and a percentage when
   PERCENT, so they cannot be bigint. They stay numeric (now `numeric(12,2)`, read as number); a FIXED value must be a
   whole number (422 in the domain, `CreatePromotionDto` checks it for FIXED). Alternative: split into two columns.
2. `PosCartLineDto.discountValue` / `orderDiscountValue` stay `@IsNumber()` for the same reason (percent may be 7.5).
3. `CHK_*` money constraints stay as they were (>= 0); `variance` has none.
4. `prettier --write apps/sales` re-formatted a few already-touched sales files.

## How verified

- `tsc -p apps/sales/tsconfig.app.json --noEmit`: clean (insight, customer, finance, inventory also compile).
- `jest apps/sales/src libs/contracts`: 12 suites, 292 tests pass. New: `common/money.spec.ts` (bigint round trip,
  unsafe values fail, DTOs reject fraction/string), money block in `domain/sales-domain.spec.ts` (fraction/string
  rejected, rounding half up, totals = sum of lines, refund residual).
- Integration `apps/sales/test/sales.int-spec.ts` against a throwaway `pgvector/pgvector:pg17` (port 55432, removed
  afterwards): 25 of 25 pass, including new Test P (every money column is bigint in information_schema, 5,000,000,000
  round trip, fractional discount 422, rounded tax and totals equal the sum of the lines, event payload numbers).
- `eslint apps/sales libs/contracts/src/events.ts` and `prettier --check`: clean.
- The required grep shows no money left (only the rate/percent/qty/latency hits listed under Deferred).
