# Workstream C1 as built: the cash session in sales

Settles D20 (returns part), D22, D23, D24, D26 and D27 of [the decision log](decisions.md), from
[the cash design](../specs/2026-11-06-cash-shift-design.md). Contracts:
[03-sales-channels-customers.md](../specs/2026-10-28-api-contracts/03-sales-channels-customers.md) (section "The cash
session"). Branch `feat/cash-shift-session`.

## Rules, as testable sentences

1. `expected = opening float + sum(entries except CASH_SHORTAGE and CASH_OVERAGE)`; `variance = counted - expected`.
2. A cash sale writes one `CASH_SALE` entry of the **cash part** (the cash allocation = tendered minus change); card, QR,
   transfer, COD and on-account never write an entry.
3. Every entry carries the signed-in user as `staffId`; the order's `created_by` is the caller, never the shift's opener.
4. A retry writes one entry: sale `sale:{orderId}`, refund `refund:{refundRequestId}`, screen payment `tender:{tenderId}`,
   pay-in/out `cash:{shiftId}:{Idempotency-Key}`, close `close:{shiftId}` (unique per tenant).
5. A POS checkout without `shiftId` is 400 `SHIFT_REQUIRED`; the shift must be `OPEN` and of the order's branch.
6. Only an `OPEN` shift takes an entry (`CLOSED`: 409 `SHIFT_CLOSED`, other states 409 `SHIFT_NOT_OPEN`).
7. One `OPEN`, `PENDING_CLOSE` or `PENDING_APPROVAL` shift per (branch, register code), whoever opens it, on both open
   routes (unique partial index `UQ_pos_shifts_active_register` and an advisory lock).
8. Variance within `toleranceVnd` closes (note optional); above it a reason is required; above `approvalAboveVnd` the shift
   waits for approval. The closing variance is one `CASH_SHORTAGE` (negative) or `CASH_OVERAGE` entry linked to the shift.
9. The approver holds `pos.approve`, is in branch scope, and is neither the person who counted nor the one who asked to close.
10. A cash refund goes into the **refunding cashier's own open shift** at the return's branch, chosen by the server.
11. A refund request is accepted only for an `APPROVED`, `RECEIVED` or `COMPLETED` return.
12. Receiving a return restocks the original sale's warehouse at the original line cost, once; without a warehouse the
    return stays `APPROVED` (409 `RETURN_WAREHOUSE_UNRESOLVED`).

## The approver process, as built

1. The cashier counts (`POST /pos/shifts/{id}/count`): the shift becomes `PENDING_CLOSE`, sales stop, the answer has the
   computed total, expected, variance and the `decision`.
2. The cashier presses close (`POST .../close`). Variance above `approvalAboveVnd`: a `reason` is required (400
   `VARIANCE_REASON_REQUIRED` otherwise) and the shift becomes `PENDING_APPROVAL`; the register stays blocked (a new open on
   it is 409). `GET /pos/shifts?status=PENDING_APPROVAL` lists it, and `PENDING_APPROVAL` shifts sort first in every list.
3. A manager with `pos.approve` opens `GET /pos/shifts/{id}`: float, every entry with who made it, `staffTotals`, the count by
   denomination, expected, variance, reason, `closeHistory`.
4. The manager **approves** (`approve-close`: the shift closes, the shortage entry is written, `approvedBy` and `approvedAt`
   are set, `sales.shift.closed` is emitted) or **sends it back** (`reject-close` with a note: the shift returns to `OPEN`, the
   count and its author are kept in `closeHistory`, nothing is written). A counter or requester who tries to approve gets 403
   `APPROVER_IS_COUNTER`. There is no way to approve by editing a number.
5. `closeHistory` records every step (`counted`, `close_requested`, `sent_back`, `approved` or `closed`) with who and when.

Owner and `branch_manager` have `pos.approve` by default (branch managers hold every permission except staff changes and
`settings.update`, so only the owner edits the cash settings by default).

## What was built and where

| Part | Where |
|---|---|
| Migration (reversible, `qualifiedTable`): `pos_shifts` columns and states, `pos_shift_cash_entry` (append-only trigger, sign and reason CHECKs, RLS), `cash_setting`, one open shift per register, synthetic entries | `apps/sales/src/migrations/1792200000100-cash-shift-session.ts` |
| Entities | `apps/sales/src/infrastructure/persistence/sales.entities.ts` |
| Pure formula, count total, close decision | `apps/sales/src/domain/sales-domain.ts` (end of file) |
| Entry writer, caller's open shift | `apps/sales/src/modules/shifts/cash-ledger.ts` |
| Open, available, count, close, approve, reject, entries, PATCH, list, detail | `apps/sales/src/modules/shifts/shifts.{service,controller,dto}.ts` |
| Settings and shortage report | `cash-settings.service.ts`, `cash-reports.controller.ts` in the same folder |
| POS checkout (shift required, entry), confirm-payment reference | `modules/checkout/checkout.service.ts` |
| Refund request, receive, restock | `modules/returns/returns.service.ts`, `inventory/inventory.client.ts` |
| Screen payment route | `modules/screen/order-actions.service.ts`, `screen.dto.ts` (`shiftId` for a payment) |
| Internal restock route (service identity, idempotent) | `apps/inventory/src/stock/return-receipts.controller.ts` |
| Permission `pos.approve` | `libs/contracts/src/permissions.ts` (43 codes), `docs/guides/permissions.md` |
| `sales.shift.closed` extra fields (additive) | `libs/contracts/src/events.ts` |
| Gateway: nine routes | `krakend/krakend.json` |

## Design choices and deviations

- **Synthetic entries at migration:** one entry per non-zero total (a `CASH_SALE` for the sales total, a `CASH_REFUND` for the
  refunds total), not a single net entry, so `cash_sales_total` and `cash_refunds_total` still equal the entries. Expected
  cash is unchanged. The migration refuses to run (with the register named) if a register already has two `OPEN` shifts: close
  the extra one first.
- **Restock identity (D20):** the simplest safe design is a dedicated internal inventory route (`POST
  /internal/v1/return-receipts`, `x-internal-token`, tenant from the header after the token, `Idempotency-Key` required,
  `sourceType RETURN`, `autoPost`), called by sales with the service identity. Sales has already checked the return, its branch
  scope and the warehouse, so a cashier with `orders.update` receives their branch's return with no inventory permission. The
  old call (`POST /api/v1/stock-receipts` with the user's token) needed `inventory.create` and `inventory.approve`.
- **Row lock across the inventory call:** receive locks the return row `FOR UPDATE`, calls inventory inside that transaction
  and then completes; a second simultaneous receive waits and finds the return completed. The inventory receipt also carries
  the key `return-receipt:{returnId}`.
- **Cash payments need a drawer:** a `cash` payment on the screen route and every cash refund need an open shift
  (`SHIFT_REQUIRED` 409). A manual back-office order paid in cash therefore needs the receiving cashier to have a shift;
  online and manual orders themselves need none.
- **"Own" shift:** the caller's own open shift is one they opened (`staff_id`). A cashier who only sells into a shared drawer
  cannot refund in cash until they open a shift (they can name a shift for a payment, but a refund never takes a shift id).
- **The approver cannot also be the requester** (the person who pressed close), a little stricter than the design (counter only):
  the legacy close (a total in `actualCash`, no count) has the closer as the counter, and the rule must hold there too.
- **Drafts:** `SHIFT_HAS_OPEN_DRAFTS` looks at drafts whose `shift_id` is the shift (active and not expired). Drafts that name
  no shift are not blocked.
- **`planned_end_at`** is set from `maxOpenHours` at open: platform's work schedule is not read from sales.
- **Overdue** = past `plannedEndAt` **or** open longer than `maxOpenHours`; nothing is closed automatically.
- **Shortage staff:** the shortage entry's `staffId` is the person who counted. The report groups by that person, so with a
  shared drawer the report shows who counted, and `staffTotals` of the shift shows who handled the cash.
- **A checkout whose shift closed while it waited for a QR payment:** closing refuses only checkouts in the in-flight states.
  If the shift closed while a checkout was `AWAITING_PAYMENT`, its `confirm-payment` with a cash part answers 409
  `SHIFT_CLOSED` and the checkout can be cancelled; the cash never enters a closed shift.
- **Deadlock avoided:** the checkout's shift re-check (`FOR SHARE`) moved after the workflow row is written: with the cash
  entry now taking the shift `FOR UPDATE` it deadlocked against 20 simultaneous same-key requests.
- **One refund request per return** (the existing `UQ_refund_requests_return`) now answers 409 `REFUND_ALREADY_REQUESTED`
  instead of a unique-index 500.
- **Screen shift** keeps `scheduledEnd: null` (platform's schedule is not read) and gains `plannedEndAt` and `overdue`; it also shows expected, actual and difference while `PENDING_APPROVAL`.

## Known gaps

- **Confirm-payment is still the cashier's word** for non-cash money: it now needs a reference (400
  `PAYMENT_REFERENCE_REQUIRED`) and records who confirmed it, but no gateway or bank verification exists (out of scope).
- Nothing blocks removing a member who has an open shift (D5, workstream B).
- `REVERSAL` is in the entry kinds and the table, but no endpoint writes one yet.
- Finance is untouched: it keeps computing the variance from `openingCash`, `expectedCash` and `actualCash`, so a shift with
  refunds and pay-outs journals the same variance (tested once per shift, even when the event is delivered twice).

## Tests

- Unit: `apps/sales/src/domain/cash-session.spec.ts` (the formula table, split payment, card-only, count, settings).
- Real Postgres: `apps/sales/test/cash-shift.int-spec.ts` (the end-to-end shift of the design, shared drawer, `SHIFT_REQUIRED`,
  one open shift per register on both routes, the lock, concurrency, refunds and returns, append-only entries, tenant
  isolation, branch scope, settings, report, migration); `apps/finance/test/finance.int-spec.ts` "Test M2" (journaled once).
- Permission matrix: `apps/sales/src/permissions.e2e.spec.ts` (65 -> 74 routes).
- **Changed on purpose because behaviour changed:** `permissions.e2e.spec.ts` (nine routes, `getDetail`, `pos.approve`);
  `modules/branch-scope.spec.ts` (the mock entity manager gains a `connection`); `sales.int-spec.ts` and `screen.int-spec.ts`
  (the new migration, a default open shift in `beforeEach` and a `checkout` wrapper that supplies it, because a POS sale now
  needs a shift; `TRUNCATE` of the append-only entries as cleanup; Test P gives its 5,000,000,000 float a note);
  `libs/contracts/src/permissions.spec.ts` (43 codes).
