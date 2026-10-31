# Phase 3: inventory money becomes integer VND

## Converted

| Where | Old | New |
|---|---|---|
| `stock_balance.avg_unit_cost`, `.valuation_amount` | numeric(18,2) | bigint (check `>= 0` kept) |
| `stock_balance_ledger.unit_cost`, `.avg_cost_after` | numeric(18,2) | bigint |
| `purchase_order.total_amount` | numeric(18,2) | bigint |
| `purchase_order_item.unit_cost` | numeric(18,2) | bigint |
| `stock_receipt_item.unit_cost` | numeric(18,2) | bigint |
| `stock_issue_item.unit_cost` | numeric(18,2) | bigint |
| `stock_transfer_item.unit_cost` | numeric(18,2) | bigint |
| Entities (`PurchaseOrder.totalAmount`, 4x `unitCost`) | `numeric` string | `bigint` + `moneyTransformer`, type `number` |
| Request DTOs `unitCost` (create PO line, receive PO line, receipt line) | string `^\d+(\.\d{1,2})?$` | `@IsInt() @Min(0)` number (fraction or string answers 422) |
| API responses: `unitCost`, `avgUnitCost`, `valuationAmount`, `totalValuationAmount`, `avgCostAfter`, `totalAmount` | `"100000.00"` | `100000` (number) |
| `inventory.stock.changed` `unitCost`, `avgCostAfter` (contracts) | string | number |
| `inventory.purchase_order.approved` `totalAmount` (contracts) | string | number |
| `inventory.stock.received` `totalAmount` (inline payload, not typed in contracts) | string | number |

Quantities (`qty`, `*_qty`, `conversion_factor`) are untouched. Migrations were edited in place
(`1791900000200-create-m2-inventory-core.ts`). Code: `src/common/money.ts` (`toVnd`, `toVndOrNull`,
`moneyTransformer`); domain `parseMoneyToVnd` / `vndToNumber` replace `parseMoneyToCents` / `formatCentsToMoney`
in `src/domain/inventory-domain.ts`, and all services use them. Money is bigint end to end in SQL (`::bigint`);
no `SUM` aggregates are done in SQL (totals are summed in JS as BigInt).

## Rounding points (all half up, integer BigInt math)

1. Weighted-average cost on receipt (stock receipt, PO receive, transfer receive):
   `round((old_qty*old_avg + add_qty*unit_cost) / (old_qty+add_qty))` to whole VND.
2. Valuation = `round(on_hand * avg_cost)` (after receipt, deduction, stocktake, transfer).
3. Duplicate SKU lines merged in one receipt: weighted unit cost rounded to whole VND.
4. Line amount = `round(qty * unit_cost)`: PO `total_amount` and `inventory.stock.received` `totalAmount` are the
   sums of the rounded lines.
5. Stocktake valuation of the counted quantity = `round(counted * avg_cost)`.

Outbound movements keep the average unchanged (no rounding). Stocktake has no separate variance amount field in
this service (only `variance_qty`), so there was none to convert.

## Cross-service changes

- Consumers of `inventory.stock.changed`, `inventory.purchase_order.approved` and `inventory.stock.received`
  (insight, finance, others) must read `unitCost`, `avgCostAfter`, `totalAmount` as numbers, not strings.
- Clients (pbl-web) must send `unitCost` as an integer and read the money fields above as numbers.

## Deferred

- `inventory.stock.received` has no typed payload in `@pbl/contracts`; left inline (not my event definition to add).

## Decisions to review

- `parseMoneyToVnd` still accepts numeric strings of whole numbers when reading raw SQL rows (the pg driver
  returns bigint as string); request DTOs accept only numbers.
- Merged duplicate receipt lines round the blended unit cost, so line total can differ by < 0.5 VND per unit from the
  sum of the original lines (a rounding point, recorded above).

## How verified

- `tsc -p apps/inventory/tsconfig.app.json --noEmit` clean; `jest apps/inventory/src` 258 passed; `jest libs/contracts`
  passed; eslint and prettier clean on `apps/inventory` and `events.ts`.
- Integration tests (`inventory.int-spec`, `inventory-scope.int-spec`, 47 tests) run against a throwaway
  `pgvector/pgvector:pg17` container on port 25499 (removed afterwards): all pass, including a new PO test
  (fractional qty, total 551 = 51 + 500, number type).
- New unit tests: `src/common/money.spec.ts` (bigint string round trip, unsafe/fractional fail loudly, DTOs reject
  fraction/string/negative with validation errors), `inventory-domain.spec.ts` (half-up weighted average 100.67 ->
  101, 100.5 -> 101, 100.33 -> 100, valuation 50.5 -> 51, fractional money rejected, unsafe bigint rejected).
- `grep -rnE "numeric\(18, ?2\)|toFixed\(2\)|parseFloat|decimal" apps/inventory`: remaining hits are quantity
  text (NUMERIC(18,3)) and latency stats in the benchmark, no money.
