# Cash shifts: the drawer, the count and the shortage (design)

- **Date:** 6 November 2026
- **Status:** Proposed. The rules come from the business owner (6 November 2026); the code state is the unmerged stack on `main`.
- **Written for:** the business owner and the people who will build it. Plain language first, then the data and the API.
- **Settles:** decisions D22 to D27 of [the business rules review](../business-rules/README.md) and defects 4 to 12 in it.

## 1. The rule in one paragraph

When nothing is paid online, the only truth is the shop's own records. So every cash movement in a shift is written down as
its own entry, the system computes what the drawer should hold, the cashier counts what it does hold, and any difference is
recorded as its own entry, never by editing a sale. A difference above a tolerance needs a reason and a manager's approval
before the shift can close, and a closed shift is locked.

```
expected = opening float + cash sales - cash refunds + pay-ins - pay-outs
variance = counted - expected          negative = shortage (thiếu tiền), positive = overage (thừa tiền)
```

Only the **cash part** of a payment enters the formula. Card, QR and bank transfer never do, and in a split payment (part
cash, part QR) only the cash part counts.

## 2. Decisions taken by the business owner

| # | Decision |
|---|---|
| 1 | A new branch automatically gets one default warehouse, and a sale always uses its own branch's warehouse. |
| 2 | Every POS sale belongs to an open shift. There is a place to manage shifts. There is no default cashier (access is by permission, not by role name): when selling, the cashier picks from the shifts that are open and available. |
| 3 | A paid plan past its end date gets 7 days of grace, then drops to `free` limits (data kept, new adds blocked). |
| 4 | A branch cannot be deleted or deactivated while it has stock, an open shift or a pending transfer, and the refusal must list **every** reason. |
| 5 | The cash-drawer rules below. |

## 3. What exists today, and the gap

The shift (`pos_shifts`) already stores the opening cash, running totals of cash sales and cash refunds, the expected cash,
the counted cash, the variance, who closed it and when. Finance posts a journal for a non-zero variance when a shift
closes. What is missing is everything that makes it a *session you can audit*:

| Need | Today |
|---|---|
| Every cash movement is an entry with amount, reason, staff and time | Only running totals; no entries |
| Pay-in and pay-out (owner adds change, buys ice, pays a supplier) | None |
| Count by denomination | One number |
| States `OPEN`, `PENDING_CLOSE`, `PENDING_APPROVAL`, `CLOSED` | `OPEN`, `CLOSED` |
| Tolerance, reason and manager approval above it | None: any variance closes |
| Shortage recorded as its own entry, linked to the shift | A journal in finance only |
| A closed shift is locked | A cash refund can still change it; late cash lands in no shift |
| A sale must be in an open shift | Optional |
| A refund comes out of the **current** drawer | Comes out of the original sale's shift, even when closed |
| Who bears a shortage | Booked to whoever opened the shift |
| Shortage reports; open-too-long flag | None |
| A place to manage shifts | Open and close only |

## 4. The model

### 4.1 The shift (cash session)

`pos_shifts` keeps its columns and gains:

| Column | Meaning |
|---|---|
| `status` | `OPEN`, `PENDING_CLOSE`, `PENDING_APPROVAL`, `CLOSED` |
| `counted_by_denomination` | JSON, e.g. `{ "500000": 1, "200000": 2, "100000": 3 }`; the counted total is computed from it |
| `variance_reason`, `variance_note` | A code from a list (miscounted change, unrecorded sale, refund not recorded, theft suspected, other) and free text |
| `close_requested_by`, `close_requested_at` | Who started the close |
| `approved_by`, `approved_at` | The manager who approved an out-of-tolerance close |
| `responsibility` | Who bears a shortage, copied from the store setting at close: `none`, `cashier_deduction`, `store_loss` |

`expected_cash`, `cash_sales_total` and `cash_refunds_total` stay, as totals that are **derived from the entries** and
checked against them, so old readers keep working.

### 4.2 The cash entries (`pos_shift_cash_entry`)

One row per cash movement. Append-only: a mistake is a reversing entry, never an edit or delete.

| Column | Meaning |
|---|---|
| `shift_id` | The drawer the cash went into or out of |
| `kind` | `CASH_SALE`, `CASH_REFUND`, `PAY_IN`, `PAY_OUT`, `CASH_SHORTAGE`, `CASH_OVERAGE`, `REVERSAL` |
| `amount` | Signed integer VND: positive in, negative out |
| `reason` | Required for pay-in, pay-out, refund and shortage; a code plus text |
| `order_id`, `return_id`, `tender_id` | The source, when there is one |
| `staff_id` | Who handled the cash (the seller, the refunding cashier, the person who put money in) |
| `occurred_at`, `recorded_at` | When it happened and when it reached the server (they differ for an offline sale) |
| `source_key` | Unique per tenant: makes a retried sale or refund write exactly one entry |

`expected = opening float + sum(entry.amount)` over the shift's entries except the shortage and overage entries, which
close the gap rather than open it.

### 4.3 Tenant settings (per store)

| Setting | Default | Meaning |
|---|---|---|
| `cash.toleranceVnd` | 10,000 | A variance within ± this closes at once with a note |
| `cash.approvalAboveVnd` | the tolerance | Above this, a manager must approve; between the two a reason is enough |
| `cash.responsibility` | `none` | `none`, `cashier_deduction` or `store_loss`: who bears a shortage |
| `cash.maxOpenHours` | 16 | A shift open longer is flagged to the manager |
| `cash.denominations` | 500k, 200k, 100k, 50k, 20k, 10k, 5k, 2k, 1k | The count form |

## 5. The life of a shift

```
OPEN ──(cashier counts)──► PENDING_CLOSE ──► CLOSED                 variance within tolerance: note, auto-accept
                                  │
                                  └────────► PENDING_APPROVAL ──► CLOSED     over tolerance: reason + manager approves
```

1. **Open.** The cashier enters the opening float (e.g. 1,000,000đ) and the register. One open shift per register, whoever
   opens it, on both routes (opening by register code is closed too).
2. **During.** Every cash sale, cash refund, pay-in and pay-out is an entry. Pay-in and pay-out need a reason.
3. **Count.** The cashier counts by denomination; the system totals it and shows expected and variance.
4. **Close.** If the variance is within tolerance the shift closes, with a note. Otherwise a reason is required and, above the
   approval threshold, the shift waits in `PENDING_APPROVAL` for a manager (permission `pos.approve`, new, held by
   `branch_manager` and the owner). The approver cannot be the person who counted.
5. **The shortage entry.** On close, a non-zero variance writes a `CASH_SHORTAGE` (negative) or `CASH_OVERAGE` (positive)
   entry linked to the shift, with the reason, and `sales.shift.closed` carries it so finance posts its journal as today.
   Sales and orders are never edited.
6. **Locked.** Nothing can be written to a closed shift: a late entry answers 409 `SHIFT_CLOSED`.

### Who can sell into which shift

A POS sale **must** carry a shift (400 `SHIFT_REQUIRED` otherwise). The cashier picks from the shifts that are open at their
branch; the list is `GET /pos/shifts/available`. Permission decides who may sell, not a "default cashier" and not the weekly
schedule. A shared drawer is allowed, because each entry carries the staff who handled the cash: the variance is one number
for the drawer, and the shift report shows each person's cash in and out, so a shortage can be traced.

## 6. Edge cases, and the rule for each

| Case | Rule |
|---|---|
| Refund of an order paid in an earlier shift | The cash leaves the current drawer: the entry goes in the **refunding cashier's open shift**, chosen by the server (never by the client). With no open shift the cash refund is refused (409 `SHIFT_REQUIRED`). A refund is paid only after the return is approved. |
| Split payment (cash and QR) | One `CASH_SALE` entry for the cash part (tendered minus change). The QR part is not an entry. |
| Offline POS | The app queues sales with a client-generated `source_key` and `occurred_at`, and syncs later. **Close waits** for them: the app must flush its queue before it asks to close, and the server answers `PENDING_CLOSE` and refuses to compute until the app confirms the queue is empty. A sale that reaches the server after the close is refused for that shift and the app files it in the current open shift marked `lateSync`. |
| Cashier forgets to close | A shift open longer than `cash.maxOpenHours` is flagged to the manager. It is never auto-closed. A manager may close it, with the variance recorded against the shift. |
| Overage | The same flow with a positive variance. It is flagged separately, because it often means a sale was not recorded. |
| Employee leaves with a shift open | The member cannot be removed while they have an open shift. |
| Retry of the same sale or refund | The same `source_key` writes one entry. |
| Large opening float | An opening float above a limit needs a note (the limit is a setting). |

## 7. API (sketch)

| Method and path | Purpose | Permission |
|---|---|---|
| `GET /sales/api/v1/pos/shifts/available?branchId=` | Open shifts the cashier may sell into | `pos.view` |
| `GET /sales/api/v1/pos/shifts/{id}` | The shift with its entries, counts and per-staff totals | `pos.view` |
| `POST /sales/api/v1/pos/shifts/{id}/cash-entries` | A pay-in or pay-out, with reason | `pos.update` |
| `POST /sales/api/v1/pos/shifts/{id}/count` | Submit the count by denomination; returns expected and variance | `pos.update` |
| `POST /sales/api/v1/pos/shifts/{id}/close` | Close, or move to `PENDING_APPROVAL` | `pos.update` |
| `POST /sales/api/v1/pos/shifts/{id}/approve-close` | A manager approves an out-of-tolerance close | `pos.approve` |
| `GET /sales/api/v1/pos/shifts?status=&overdue=` | The shift list, including the open-too-long flag | `pos.view` |
| `GET /sales/api/v1/cash-shortages?groupBy=staff\|branch\|day&from=&to=` | Shortage and overage report, repeated shortages per cashier | `reports.view` |

Errors: `SHIFT_REQUIRED` (400), `SHIFT_NOT_OPEN` (409), `SHIFT_CLOSED` (409), `SHIFT_ALREADY_OPEN` (409, also by register
code), `SHIFT_HAS_OPEN_DRAFTS` (400, the contract's `S022`), `VARIANCE_REASON_REQUIRED` (400), `APPROVAL_REQUIRED` (409).

## 8. How this fixes what the review found

| Review defect | Fixed by |
|---|---|
| 4. A sale needs no shift | A sale must carry an open shift (`SHIFT_REQUIRED`) |
| 5. Any open shift will do | The cashier picks an available shift; each entry records who handled the cash |
| 6. Refund `shiftId` chosen by the client | The server picks the refunding cashier's open shift |
| 7. A refund changes a closed shift; cash after close is in no shift | Closed shifts are locked; late cash goes to the current shift |
| 8. A refund before the return is approved | A refund waits for an approved return |
| 9. Two cashiers on one register code | One open shift per register on both routes |
| 10. Closing with open drafts | `SHIFT_HAS_OPEN_DRAFTS` |
| 11. Shortage booked to the opener, shift left open | Responsibility is a store setting; a shift cannot be orphaned (no member removal while open; overdue flag) |

## 9. Tests

- **The formula, as a table** (unit): exact match; a small shortage within tolerance; a large shortage needing approval; an
  overage; a refund of an order from an earlier shift; a split payment where only the cash part counts; a pay-in and a
  pay-out; a card-only sale (no entry).
- **End to end** (real Postgres): open with 1,000,000, three cash sales, one refund, one pay-out, count 50,000 short; check
  that the close is refused until a reason is given, that it waits for a manager's approval, that the approver cannot be the
  counter, that a `CASH_SHORTAGE` entry of -50,000 exists and is linked to the shift, that finance journals it once, and that
  a late entry and a second close answer 409.
- **Concurrency**: two refunds or two closes at once write one result; a retried sale writes one entry.
- **Offline**: queued sales that sync before the close count; one that arrives after it goes to the current shift as `lateSync`.
- **Migration**: a shift open at upgrade time gets one synthetic entry for its existing totals, so its expected cash is unchanged.

## 10. Open questions

1. **Shared drawer.** The rule above lets a cashier sell into a shift a colleague opened, and traces the cash by staff. Do you
   want that, or must a cashier sell only into a shift they opened themselves?
2. **Tolerance numbers.** I used ±10,000đ as the tolerance and the same figure for approval. Do you want a lower band where a
   reason is enough but approval is not needed (for example 10,000 to 50,000)?
3. **Who approves.** A new permission `pos.approve`, held by the owner and the branch manager. Correct?
4. **Responsibility default.** `none` (just recorded), unless the store chooses cashier deduction or store loss. Correct?
5. **Open-too-long limit.** 16 hours. Right for your shops?
6. **Offline.** Is the mobile POS going to sell offline in the first release? If not, the offline rules wait.
7. **Denominations.** The nine VND notes listed above, no coins. Correct?
