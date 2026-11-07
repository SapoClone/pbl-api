# Business rules review: branches, warehouses, stock moves, work shifts, plans and admin

- **Date:** 6 November 2026
- **Written for:** the business owner reviewing how the system behaves today, and the decisions it still needs.
- **Code state:** the unmerged stack on top of `main` (pbl-api #35 to #39: platform admin API, plan limits, work shifts, contracts). Read from the code, not run.

## 1. How this was produced

Five analysts each read one domain's code end to end and wrote a strict rules report (a rule per row, marked
ENFORCED, PARTIAL, MISSING or CONTRADICTED, with the file and line that enforces it, ten or more edge cases walked
through the code, ranked defects, and questions). Three independent verifiers then re-read the code without trusting
those reports: two re-checked every defect and every important "enforced" claim, one traced seven flows **across**
services, which no single analyst could see.

| Domain | Rules | Report | Verified by |
|---|---|---|---|
| Branches and tenancy (platform) | 59 | [a1](a1-branches-tenancy.md) | [a7](a7-verification-branches-stock-transfers.md) |
| Warehouses and stock per branch (inventory) | 51 | [a2](a2-warehouses-stock.md) | [a7](a7-verification-branches-stock-transfers.md) |
| Moving items between branches, and how a sale uses stock | 44 | [a3](a3-transfers-sales-stock.md) | [a7](a7-verification-branches-stock-transfers.md) |
| Work shifts, who is in charge, who sold what | 49 | [a4](a4-work-shifts.md) | [a8](a8-verification-shifts-plans-admin.md) |
| Plans, plan limits, platform admin | 39 | [a5](a5-plans-limits-admin.md) | [a8](a8-verification-shifts-plans-admin.md) |
| Flows across services, and a shared glossary | 14 defects | [a6](a6-cross-domain.md) | |

**What the verifiers found.** Of the 80 claims they re-opened, 63 were confirmed, 7 were partly right, 9 they could not
settle, and one was a false alarm (a worry about return eligibility in sales; the code is correct). Nearly every line
number the analysts gave was within about ten lines (one set of platform quota citations pointed at lines that do not
exist; see section 7). The verifiers also found things **all five analysts missed**: they are marked
*(missed)* below.

**What this is not.** Nothing was run: no tests, servers or databases. A finding means "the code says this", and the two
most serious ones should be reproduced with a test before the fix. Limits of each report are in its own section 1.

## 2. The short verdict

**Solid today:** the rules that protect stock integrity inside one warehouse (no negative stock, no reserving more than is
on hand, last-unit races, all-or-nothing holds, weighted-average cost, integer VND), the transfer lifecycle up to
dispatch, the "a store always keeps one active branch" rule, branch scope (a branch outside your scope answers 404 and
lists are filtered), the plan-limit check for branches, members, products and files (409 `Q001`, serialised so two
requests cannot both slip through at the limit), the separation of admin and store tokens, and the admin rules (last
super admin, no self-demotion, lockout).

**Not solid:** the **edges between the pieces**. A branch, its warehouse, its register shift, its staff and its plan are
five separate records owned by five services, and most of the rules that should tie them together do not exist. The
result is below.

## 3. What must be fixed first (all confirmed against the code)

Severity is for a retail business: **Critical** = money, stock or another branch's data, or the store cannot trade.
**Major** = wrong but recoverable. Each item says which decision in section 5 it needs.

### A. A new store cannot trade out of the box · Critical · D1, D2, D3

1. **A new branch gets no warehouse.** Inventory only copies the branch; nothing creates a warehouse for `CN01`. The
   POS checkout requires a `warehouseId` and sales has no way to find one, so the owner sees a bare 404
   `WAREHOUSE_NOT_FOUND` or "warehouseId must be a UUID" on their first sale, and cannot receive stock either.
2. **A sale can draw from any warehouse**: another branch's, the central one, or quarantine. Neither sales nor inventory
   checks that the warehouse belongs to the sale's branch or is a normal branch warehouse. Nothing anywhere reads the
   warehouse `kind`, so transfers to and from quarantine are also open.
3. **`isWarehouse` on a branch means nothing.** It is copied into three services and read by none.

### B. Cash and work shifts · Critical · D22 to D27

4. **A sale needs no open shift** (`shiftId` is optional on POS checkout). Its cash lands in no drawer.
5. **Any open shift will do**: checkout never compares the shift's cashier to the caller, so cashier B can sell into
   cashier A's drawer and A's variance then includes B's cash.
6. **A cash refund can debit any shift of the store** *(missed)*. The refund request carries a `shiftId` chosen by the
   client and never checked (any branch, any cashier, open or closed), with only `orders.approve` or `orders.create`.
7. **A cash refund changes a closed shift's expected cash** after its variance was calculated and finance was told. The
   other refund route only touches an open shift, so the two routes disagree. A cash movement made after a shift closes
   belongs to no shift and finance never sees it.
8. **A cash refund can be paid before the return is approved or the goods are received**, and is confirmed at once
   *(missed)*.
9. **Two cashiers can hold the same register code open**: the "one open shift" index includes the cashier, so only the
   route that opens by register id keeps one person per register.
10. **Closing a shift with open draft invoices is not blocked.** The contract says it fails with `S022`; the code never
    reads the drafts and `S022` exists only in the documents.
11. **Nothing ties the schedule to the register.** Anyone with `pos.create` can open a register at any hour. Anyone with
    `pos.update` in scope can close any shift. A shortage is booked to whoever **opened** the shift, even when someone
    else closed it. A member who leaves while their shift is open leaves the shift open and the register blocked.
12. **POS "payment confirmed" is taken on the caller's word** *(missed)*: it marks every tender confirmed and commits stock,
    needing only `orders.update`, which cashiers hold. Whether another layer verifies the payment was not established.

### C. Stock integrity · Critical · D13, D15, D16, D17, D20

13. **Receiving a transfer can inflate stock** *(missed, confirmed by reading)*. The receive request is checked line by
    line against a snapshot taken before any line is applied, and the request is not required to have unique SKUs.
    Sending the same SKU twice can put twice the quantity on hand while the transfer line shows it once.
14. **`POST /warehouses` is an upsert.** Posting a code that already exists overwrites that warehouse, including its
    branch. A manager restricted to branch A who posts branch B's code takes B's warehouse and its stock. The "code
    already exists" error is declared and never thrown. `PATCH /warehouses/{id}` can also move a warehouse that holds
    stock to another branch, or detach it from any branch *(missed)*.
15. **Two simultaneous first receipts of a new SKU lose stock**: the lock has no row to hold, and the second writes its own
    absolute value over the first.
16. **A purchase-order receive retried with the same key counts twice** on the order without moving stock, and
    **creating a receipt ignores the idempotency key**, so a retried auto-posted receipt doubles stock.
17. **Stock can be added with no document, approval or cost** through the direct stock-balance receive (needs only
    `inventory.create`); average cost stays 0 and dilutes the next real receipt.
18. **A transfer cannot be cancelled once dispatched** and goods lost in transit leave no write-off, no value and no
    event. A cross-branch transfer can be created and dispatched by the source side alone, instantly debiting its stock
    and showing "in transit" at a branch that never asked *(missed)*.
19. **Two stock models coexist** (the older branch-and-SKU-code one and the warehouse one), give different numbers, and
    every completed sale triggers the older one's deduction even for warehouse sales.
20. **Returns:** a return can be marked completed with no restock when no warehouse resolves; goods re-enter stock at cost
    0; a restock needs `inventory.create` and `inventory.approve`, which cashiers lack, so their 403 surfaces as a 503;
    two simultaneous receives can restock twice *(missed)*.
21. **Stock holds last 15 minutes everywhere.** A confirmed online order shipped later cannot commit its stock, and a POS
    sale awaiting a bank or QR payment past 15 minutes is cancelled even if the customer already paid.

### D. Branch lifecycle · Major to Critical · D4, D5, D8, D38

22. **Deleting or deactivating a branch is ignored by inventory, integration and finance.** Warehouses stay active and keep
    accepting stock moves; marketplace orders keep queueing and then fail in sales; there is no check for stock, open
    shifts, unfinished orders or pending transfers.
23. **An active branch is deleted in one step** if another active branch exists. The contract says deactivate first
    (`B004`), but `B004` does not exist in the code. By default only the owner can do it (the seeded branch-manager role
    is denied `settings.update`) *(corrected by the verifier)*.
24. **A deleted branch stays in members' branch lists**, so a member whose branches were all deleted sees an empty scope,
    not "everything". Scope changes reach the member only at their next sign-in or refresh (up to a day), and no session
    is ended.
25. **Self-serve store creation** ignores the default branch name and does not announce the store; only the admin path
    does either.

### E. Plans, limits and suspension · Critical to Major · D6, D7, D31 to D36

26. **A paid plan never expires.** No scheduler sets `expired` or `past_due`; after the date the store keeps its paid limits
    for ever. (If it did lapse, it would fall back to `free` limits with no downgrade check.)
27. **There is no trial**: nothing creates one, so the admin's "trial" tab can never have rows.
28. **The storage limit is close to unenforced**: only files not yet attached count. An image attached to a product and an
    import file stop counting, and the downgrade check uses the same figure.
29. **Stores that existed before plan limits are unlimited in catalog** (no limit row, never created). New stores are fine.
30. **Suspending a store only ends logins.** No service other than platform checks store status or plan, so marketplace
    webhooks, sync jobs, internal order creation and event consumers keep writing for a suspended store. The
    session cut-off also depends on Redis being configured.
31. **A payment can be recorded on any subscription row**, including `free` and closed ones.
32. **Demoting a super admin does not end their sessions**, so they keep super powers for one access-token lifetime
    (15 minutes). Settings are stored and validated but the lockout still uses 5 attempts and 15 minutes.
33. **A free store has exactly one branch, and it is the default one**, which it cannot delete or deactivate. That is
    consistent, but the owner needs to be told.

### F. Visibility, audit and identity · Major · D29, D30, D37, D38

34. **A branch-restricted manager can read other branches' data**: the audit log is store-wide for anyone with
    `reports.view` (which managers hold) and shows other branches' order amounts and member emails.
35. **The audit log cannot answer "who did what"**: it records 8 event types. Branch changes, member lock or removal,
    shift open and close, stock adjustments and refunds are not recorded. Its actor column mixes account ids and admin
    ids without saying which.
36. **A removed employee's name is lost**: staff-sales and the stock ledger show raw ids. The membership row is deleted
    and no service keeps a name.
37. **Revenue does not reconcile**: the staff list sums the order grand total, the product drill-down sums line totals
    after discount, and everything is gross of returns, so a fully returned order still counts for its seller.
38. Plan limits count inactive branches and locked members, so only deleting or removing frees a slot.

## 4. The rules as they stand today (the parts that work)

These are enforced and tested unless marked otherwise. They are the baseline the decisions below change.

**Branches and store.** Branch code is unique per store. A store keeps at least one active branch (`B002`, under a row
lock). A new store gets branch `CN01`, five roles and a `free` plan. Branch scope answers 404, never 403; a list without
a branch filter shows only your branches. A new branch is refused over the plan (409 `Q001`, `details: key, used,
limit, planCode`), with a per-store lock so two simultaneous creates cannot both pass. Branch create, edit, delete and
settings need `settings.update`.

**Warehouses and stock.** Quantities have three decimals and money is whole VND. The database refuses negative stock and
reserved above on-hand. A hold is all-or-nothing and two buyers of the last unit cannot both win. Average cost is
weighted. Receipts and issues are state machines and a second post answers 409. A warehouse cannot be deactivated while
it holds stock, holds or transfers. A branch's stock view sums its warehouses and leaves out central and quarantine ones
(by "has no branch", not by kind: see item 2).

**Transfers.** Same-warehouse is refused. Every line is checked for stock before anything moves. Dispatch takes stock
from the source (in-transit units cannot be sold) and a second dispatch is refused. Receive supports partial receipt and
discrepancies and refuses over-receipt (but see item 13). Only a draft can be cancelled. Dispatch and cancel need scope on
the source, receive needs it on the destination.

**Shifts.** A member's scheduled shifts cannot overlap, in any branch (`S001`); two that only touch at 16:00 are fine. The
on-duty answer excludes the end minute. A branch outside your scope is 404. A POS shift records opening cash, expected
cash, counted cash and variance, and who closed it. Orders record who rang them up and which shift; completed POS orders
only count in who-sold-what.

**Plans and admin.** Plan limits are checked at the exact limit (the 101st on a 100 plan is refused). Downgrading below
current usage is refused (`S010`); a plan edit over-quotas nothing and reports how many stores it puts over. Archived and
deleted products do not count. Admin and store tokens cannot cross. Admin sign-in is one error for every failure, then a
5-attempt, 15-minute lockout. A super admin cannot demote or disable themselves or the last super admin (`A011`),
serialised by a lock. Disabling an admin ends their sessions.

## 5. Decisions for you

The answers given so far are in the [decision log](decisions.md); the cash-drawer rules have their own [design](../specs/2026-11-06-cash-shift-design.md).

Answer **yes/no, a number, or "use your default"**. The default is what I would build. Where a number is asked, my
suggestion is in the default. The left column is the item in section 3 it settles. Source ids point into the reports.

### Branches and the store

| # | Decision | Default |
|---|---|---|
| D1 | A new branch (and a store's first branch) automatically gets one default `BRANCH` warehouse, code from the branch code. | **Yes**, created by the branch event, once per branch |
| D2 | What does `isWarehouse` mean? | **Remove it** (or keep it only as "depot, no POS" and enforce it) |
| D3 | A POS sale must use the sale's own branch warehouse, resolved automatically; never central or quarantine. | **Yes** |
| D4 | Block deactivating or deleting a branch while it has stock above 0, an open shift, an unfinished order, a pending transfer or a live channel connection. Delete only after deactivate (`B004`). | **Yes**, with a 409 listing what blocks it |
| D5 | Block removing a member who has an open POS shift. (Locking: allow, and flag the shift.) | **Yes** for removal |
| D6 | Inactive branches count toward the plan limit; locked members do not. | **Inactive branches yes, locked members no** |
| D7 | A store older than the plan limits gets its current plan applied to catalog now, with a warning period. | **Yes**, backfill |
| D8 | Branch code is fixed after creation and never reused; name stays editable. | **Yes** |
| D9 | A scoped member (sees only branch A) may create branches. | **No** |
| D10 | Self-serve store creation accepts a default branch name. | **Yes** |
| D11 | Limit the stores one account may create. | **3** |
| D12 | Invoice prefix unique per branch. | **Yes** |

### Warehouses, stock and transfers

| # | Decision | Default |
|---|---|---|
| D13 | Warehouse code clash is an error (409); `POST` never overwrites; `PATCH` cannot move a stock-holding warehouse, and cannot detach it. | **Yes** |
| D14 | Only `BRANCH` warehouses belong to a branch, and only they count in branch stock. One default warehouse per branch, mandatory. | **Yes** |
| D15 | Remove the direct "add stock with no document" endpoint, or require document, cost and approval. | **Remove** |
| D16 | Retire the older branch-and-SKU-code stock model and its sale-completed deduction. | **Yes**, after sales finishes moving |
| D17 | Cancel a transfer after dispatch (stock returns to the source, reverse entry). Lost units: branch manager writes off at dispatch cost. Alert on a transfer still open after N days. | **Yes; manager; 7 days** |
| D18 | A transfer is confirmed by the receiving branch (or an admin), not pushed by the sender alone. Quarantine only to a branch, with manager approval. | **Yes** |
| D19 | Hold lifetime for a confirmed order not yet shipped. A bank or QR payment arriving after the hold expired. | **Hold until fulfilled or cancelled; re-reserve, refund if now short** |
| D20 | Returns: approved before received and before a refund; restock to the original branch; at the original cost; a cashier may receive their own branch's return. | **Yes to all four** |
| D21 | Stock minimum alert on every crossing below the minimum. Stock take freezes sales: no. Receipt, stock take and PO need a second person to approve: not by default. | **Yes; no; no** |

### Cash and work shifts

| # | Decision | Default |
|---|---|---|
| D22 | Every POS sale belongs to an open shift, and only to the caller's own shift (a manager may override). | **Yes, both** |
| D23 | One person per register code, never two. | **Yes** |
| D24 | Closing a shift with open drafts is blocked (`S022`). | **Block** |
| D25 | Who may close another's shift; what happens to a shift whose employee left. | **Opener or a manager; manager closes it and the variance goes to the closer, the opener stays the accountable cashier** |
| D26 | A cash refund comes out of today's drawer, needs the refunding cashier's own open shift, and the shift is chosen by the server, never the client. | **Yes** |
| D27 | Cash shortage: who is responsible, tolerance, and the amount above which a note is required. | **The opener; 0 VND tolerance; note above 50,000 VND** |
| D28 | Scheduling: support shifts that cross midnight; warn (do not block) when a register is opened by someone not scheduled; a shift only in a branch the member belongs to; a locked member leaves the on-duty list at once. | **Yes; warn; yes; yes** |
| D29 | Revenue for managers and for commission: net of returns and refunds, gross shown beside it, one definition everywhere. May a salesperson see their own rows. | **Net; yes, own rows only** |
| D30 | Keep a name snapshot of staff so past sales still show who sold. | **Yes**, a small member list fed by member events |

### Plans, suspension, admin and audit

| # | Decision | Default |
|---|---|---|
| D31 | A paid plan past its end date: grace days, then drop to `free` limits (data kept, new adds blocked). | **7 days** |
| D32 | Trial: yes or no, how long. | **No trial now; hide the tab** |
| D33 | Recording a payment: not on `free` or a closed subscription; any amount of 0 or more, a note when it differs from price × months. | **Yes** |
| D34 | Storage counts every file kept (attached images and imports too). | **Yes** |
| D35 | Suspending a store also stops marketplace webhooks, sync jobs and internal order creation; other services learn the store status and plan from an event. | **Yes** |
| D36 | Demoting or disabling an admin ends their sessions at once; the lockout numbers in settings take effect; minimum 3 attempts. | **Yes** |
| D37 | Audit log: who may read it and whether it is branch-filtered; which actions are recorded (branch changes, member lock, remove, role edits, shift open and close, stock adjustments, stock take approval, refunds, plan, suspension); a clear actor type (account, admin, system). | **Owner only; branch managers see their branches; all listed; actor type** |
| D38 | Member scope changes and branch deletion take effect immediately (sessions ended). | **Immediately for removals, at expiry for additions** |

## 6. Suggested order of work, once the decisions are in

1. **Make a new store able to trade** (D1, D3, D13): default warehouse per branch, sale warehouse resolved from the branch,
   `POST /warehouses` becomes an insert with a conflict error, `PATCH` guarded.
2. **Close the cash holes** (D22 to D27): require an open shift and the caller's own shift, derive the refund's shift on the
   server, `S022`, one person per register code, approved-before-refund.
3. **Protect stock** (D15, D16, D17, D20): unique SKUs on a transfer receive (reproduce the inflation with a test first),
   idempotency on receipts and PO receive, the first-receipt race, retire the direct add-stock path.
4. **Branch lifecycle guards** (D4, D5, D8, D38): the block list, `B004`, member and session handling, projection of branch
   status into inventory, integration and finance.
5. **Plans** (D6, D7, D31 to D36): expiry job with grace, storage counting, backfill of limit rows, tenant status and plan
   projected into the services, suspension honoured by integration and internal paths.
6. **Audit and identity** (D29, D30, D37): more audited actions with an actor type, a staff name snapshot, one definition of
   revenue.

Each step is one pull request with tests that reproduce the defect first.

## 7. Corrections to the reports

The verifiers found these errors in the analysts' work; the reports in the appendices are kept as written, so read them
with this list.

- **Wrong:** a worry in the transfers-and-sales report that the return-eligibility condition in sales is buggy. It is correct.
- **Overstated:** the claim that every completed sale double-deducts stock. It only deducts when older-model stock rows exist
  for that branch and SKU; otherwise it writes a zero-quantity shortfall row.
- **Corrected:** deleting an active branch is reachable only by the owner by default; the platform quota check cited lines
  that do not exist (the code is in `quota.service.ts`, lines 29 to 71); "a free store can never add a second branch" holds
  only while the free plan's branch limit is 1, which a super admin can edit; the catalog fail-open is a large risk only for
  stores that existed before the limits.
- **Duplicates and numbering:** two rules about the same warehouse defect in the warehouses report; two defects both
  numbered D-02b in the transfers report.
- **Not re-opened by the verifiers:** a few rules in the shifts and admin reports, the finance cash-book posting detail, and
  how the integration sync worker retries a refused branch.
- **Not established anywhere:** whether any screen still reads the older stock table, whether another layer verifies a
  POS payment, and which seeded roles hold `pos.update`.

## 8. Appendices

| File | What it holds |
|---|---|
| [a1](a1-branches-tenancy.md) | Branches and tenancy: 59 rules, 16 scenarios, 16 defects, 17 questions |
| [a2](a2-warehouses-stock.md) | Warehouses and stock: 51 rules, 16 scenarios, 16 defects, 14 questions |
| [a3](a3-transfers-sales-stock.md) | Transfers, sale stock, returns: 44 rules, 16 scenarios, 17 defects, 15 questions |
| [a4](a4-work-shifts.md) | Work shifts and attribution: 49 rules, 20 scenarios, 15 defects, 14 questions |
| [a5](a5-plans-limits-admin.md) | Plans, limits, admin: 39 rules, 16 scenarios, 14 defects, 15 questions |
| [a6](a6-cross-domain.md) | Seven cross-service flows, 14 defects, the glossary, 20 decisions |
| [a7](a7-verification-branches-stock-transfers.md) | Verification of a1 to a3, and what they missed |
| [a8](a8-verification-shifts-plans-admin.md) | Verification of a4 and a5, and what they missed |

The glossary proposed in a6 (branch, warehouse, register, shift, staff, member, account, store, tenant) is worth reading
before the decisions: several of the defects above come from one word meaning two things in two services.

## 9. Status after wave 1 (7 November 2026)

What happened to each finding of section 3. Wave 1 is built and tested together; the numbers are those of section 3.
"Fixed" means the code now enforces it and a test proves it. Details: [decisions.md](decisions.md) and `built-a.md` to
`built-f.md`.

| # | Finding | Now |
|---|---|---|
| 1, 2 | A new branch gets no warehouse; a sale can use any warehouse | **Fixed** (A): default warehouse per branch, backfilled; a sale resolves its own branch's warehouse |
| 3 | `isWarehouse` means nothing | **Settled**: the flag stays, documented as informational |
| 4, 5 | A sale needs no shift; any open shift will do | **Fixed** (C1), as decided: a POS sale needs an open shift picked from the branch's open shifts, and the cashier of the order is the signed-in user |
| 6, 7, 8 | Refund shift chosen by the client; a refund changes a closed shift; a refund before the return is approved | **Fixed** (C1) |
| 9, 10 | Two cashiers on one register code; closing with open drafts | **Fixed** (C1) |
| 11 | Schedule not tied to the register; shortage booked to the opener; orphaned shift | **Partly**: responsibility is a store setting, a member with an open shift cannot be removed (B), overdue shifts are flagged; the weekly schedule is still not read when a shift opens |
| 12 | A POS payment confirmed on the caller's word | **Partly**: a non-cash tender needs a reference and records who confirmed it; there is no gateway verification |
| 13 | Transfer receive can inflate stock | **Fixed** (F), reproduced with a failing test first |
| 14 | Warehouse create overwrites; update moves a stock-holding warehouse | **Fixed** (A) |
| 15, 16, 17 | Lost stock on first receipts; replayed receipts count twice; stock added with no document | **Fixed** (F): advisory lock, idempotency keys, the direct add-stock route removed |
| 18 | No cancel after dispatch, no write-off, a transfer pushed by the sender alone | **Fixed** (F) |
| 19 | Two stock models | **Partly** (F): the spurious deduction is skipped for warehouse orders; the older model is not retired |
| 20 | Returns: no approval before refund, restock at cost 0, cashiers cannot restock | **Fixed** (C1) |
| 21 | Holds last 15 minutes | **Partly** (F): confirmed orders hold without expiry; a POS payment arriving after the hold expired is not handled yet |
| 22, 23, 24 | Branch delete and deactivate ignored downstream; an active branch deleted in one step; members keep deleted branches | **Fixed** (B), except old assignment rows pointing at already-deleted branches, which need an owner decision |
| 25 | Self-serve store creation ignores the default branch name | **Fixed** (B) |
| 26, 27 | A paid plan never expires; no trial | **Fixed** (D): 7 days of grace, then `free`; trials are not offered |
| 28 | The storage limit does not count attached files | **Fixed** (D) |
| 29 | Older stores unlimited in catalog | **Partly** (D): a resync (admin endpoint and script) closes the gap; it is a deploy step |
| 30 | Suspension only ends logins | **Fixed** for sales and integration (D); a service without Redis logs an error at start |
| 31, 32 | Payment on any row; demotion keeps sessions; lockout settings unused | **Fixed** (D) |
| 33 | A free store has one branch | **Documented**, unchanged |
| 34, 35 | Audit log not branch-limited; it cannot answer "who did what" | **Open**: wave 2 (D37) |
| 36, 37 | A removed employee's name is lost; revenue does not reconcile | **Open**: wave 2 (D28 to D30) |
| 38 | Inactive branches and locked members count toward plan limits | **Fixed** (B): locked members no longer count; inactive branches still do, as decided |
