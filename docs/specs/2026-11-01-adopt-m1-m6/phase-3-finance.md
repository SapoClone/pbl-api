# Phase 3: finance money becomes integer VND

Scope: `apps/finance/**` (src, test, benchmark) and the `finance.*` payloads in `libs/contracts/src/events.ts`.
Protocol: `phase-3-rules.md`. Phase 2 (permissions, branch scope) is untouched.

## Converted

| Where | Old | New |
|---|---|---|
| Baseline migration `1791900000200-create-m5-finance-core`, all 61 money columns (journals total_debit/credit; journal lines debit/credit; cash_accounts.current_balance; cashbook_entries.amount; customer_credit_profiles credit_limit/posted_debt/held_credit/prepayment_balance; credit authorizations authorized_amount; customer/supplier receivables and payables original/paid/adjusted/outstanding; both debt ledgers amount_delta/balance_before/balance_after; payment_settlements requested/confirmed/settled/refunded; refund_operations.amount; cod_receivables, cod batches and lines (expected, reported, fee, adjustment, net, remitted, discrepancy, totals); shift reconciliations (opening, sales, refunds, other in/out, expected, counted, variance); adjustments amount; reconciliation runs matched/mismatched; issues expected/actual/difference) | `numeric(18,2)` | `bigint` (check constraints unchanged; `credit_limit` default `2000000.00` -> `2000000`) |
| Entities (`finance.entities.ts`), same 61 columns | `numeric` + `string` | `bigint` + `moneyTransformer`, TS type `number` |
| `src/common/money.ts` (new, same helper as the other services) | n/a | `toMoney`, `moneyTransformer`: throws if not a safe integer |
| Request DTOs: `amount` (cashbook, receivables, payables, credit, adjustments, refunds), `debitAmount`/`creditAmount`, `creditLimit`, `openingCash`, `confirmedCashSales/Refunds`, `otherCashReceipts/Expenses`, `actualCountedCash`, `expectedCodAmount`, `reportedCodAmount`, `carrierFeeAmount`, `netPayoutAmount`, `requestedAmount`, `confirmedAmount`, `settledAmount` | `@IsNumberString()`/`@IsString()` string | `@IsInt()` number (no old minimum existed; zero/negative rules stay in the domain, 422) |
| Domain (`finance-domain.ts`) | `parseMoneyCents` (string to bigint cents, 2 decimals), `formatMoneyCents`, `MAX_MONETARY_CENTS`, `DEFAULT_CUSTOMER_CREDIT_LIMIT_VND='2000000.00'` | `parseVnd(number)` returns a validated safe integer (422 on fraction, string, unsafe, negative, zero when disallowed); `formatMoneyCents` removed; default limit `2_000_000`; all results, allocations, journals, refunds, COD and shift math are plain integers |
| Responses and event payloads (`finance.cashbook.entry_posted`, `receivable.*`, `payable.*`, `credit.*`, `payment.settlement_confirmed`, `refund.*`, `cod.*`) | decimal strings | numbers (`libs/contracts/src/events.ts`: amount, originalAmount, paidAmount, outstandingAmount, customerTotalDebtAfter, supplierTotalDebtAfter, authorizedAmount, postedDebtAfter, heldCreditAfter, availableCreditAfter, confirmedAmount, refund amount, totalExpectedCod/ReportedCod/CarrierFee/NetPayout/Discrepancy) |
| Raw SQL | `SUM(...)::numeric(18,2)` (supplier debt); `$4::numeric(18,2), 0.00` credit profile insert; `0.00` cash account insert; `authorized_amount` read from raw row via `String` | `::bigint` + `toMoney`; `$4::bigint, 0`; `0`; `toMoney` |
| Inbound event fields | `totalAmount?`, `codAmount?`, `amount` typed string; `grandTotal ?? String(totalAmount)` | numbers (`grandTotal ?? totalAmount`) |

## Rounding points

None. Finance has no rate, tax, percent or proration math: every amount is supplied by the caller or by an event
and is only added, subtracted, compared or allocated (FIFO allocation caps at outstanding, so lines and totals
stay integers). Totals are sums of lines by construction (`totalAllocated` = sum of `allocatedAmount`; journal
`total_debit` = sum of line debits, enforced by the balanced check).

## Cross-service changes

- sales: `sales.order.completed` (`grandTotal`/`totalAmount`), the payment-confirmed event (`amount`) and the
  refund-request event must carry integer numbers. `OrderCompletedPayload` is already numeric in contracts. Finance now
  rejects a string or fractional value (domain 422 inside the consumer, so the message goes to retry then DLQ).
- inventory: `inventory.stock.received` (`totalAmount`) and `inventory.purchase_order.approved` (`totalAmount`) must be numbers.
- integration/sales (COD): the fulfillment event `codAmount` must be a number.
- sales: any HTTP call to finance `/internal/credit-authorizations*` must send `amount` as an integer and read money
  back as numbers (all finance money responses are numbers now).
- insight/customer: any consumer of `finance.*` events must read numbers, not strings.
- pbl-web/mobile (not owned): finance request bodies and responses use numbers.

## Deferred

None for money. The payload `FinanceCreditAuthorizationEventPayload` etc. keep their other fields unchanged.

## Decisions to review

1. Event-handler inputs are strict: a string money value from a producer that has not converted yet fails (422, DLQ)
   instead of being coerced. This matches "accept numbers".
2. Unsafe integers (> 2^53-1) are rejected by `parseVnd` and `toMoney`; the previous `NUMERIC(18,2)` bound is gone.
3. Test strings such as `'1000.00'` became `1000`; a fractional case (`1000.5`) is covered in domain, e2e and integration tests.
4. `CHK_*` constraints and the `UQ`/RLS setup are unchanged; only the column types and one default changed.

## How verified

- `tsc -p apps/finance/tsconfig.app.json --noEmit` OK; also type-checked `src` + `test` (including the benchmark) with jest types.
- `jest apps/finance/src`: 223 passed (new: `parseVnd` fraction/string/unsafe rejection, e2e 422 for fractional, string and null amounts on cashbook and receivable payment, `common/money.spec.ts` bigint round trip and loud failure). `jest libs/contracts`: 10 passed.
- Integration (`finance.int-spec.ts`) against a throwaway `pgvector/pgvector:pg17` on port 35433 (removed afterwards): 14 passed, including new Test V (5,000,000,000 VND round trips as a number, columns are `bigint`, parts sum to the total, `1000.5` rejected 422).
- Benchmark `finance-benchmark.ts` ran against the same throwaway DB: all latency targets met, contention results consistent (credit hold limited to 10 of 100, receivable fully paid, refund cap 5 of 50).
- `eslint apps/finance`: 0 errors (1 pre-existing unused-variable warning in the benchmark). `prettier --check`: clean.
- Grep for `numeric(18,2)|toFixed(2)|parseFloat|decimal` finds only `toFixed(2)` on millisecond timings in the benchmark (not money).
