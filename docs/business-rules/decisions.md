# Decision log

Every decision of [the business rules review](README.md#5-decisions-for-you) and how it was settled. **Owner** means the
business owner answered it; **Default** means the owner told me (6 November 2026) to use the review's recommended default.
Anything the owner answered replaces the default. Built in the workstream shown (see [the build plan](#build-plan)).

## Owner answers of 6 November 2026

1. A new branch gets a default warehouse, and a sale always uses its own branch's warehouse.
2. Every POS sale belongs to an open shift, and there must be a place to manage shifts. There is no default cashier (access
   is by permission, not by role name). When selling, the cashier picks from the shifts that are open and available.
   **The cashier of the order is the user who is signed in and using the cashier feature**, not the person who opened the shift.
3. A paid plan past its end date: 7 days of grace, then `free` limits.
4. A branch cannot be deleted while it has stock, an open shift or a pending transfer; the refusal lists every reason.
5. The cash-drawer rules ([design](../specs/2026-11-06-cash-shift-design.md)): the tolerance and the other numbers are
   **configurable**; the approver's role and process are written down; the planned times of a shift can be edited so the
   rules can be shown in a demo; the other settings keep their defaults (shortage responsibility `none`, 16 hours open,
   nine VND notes); **there is no offline POS feature**.
6. All other open decisions: use the recommended default.

## All decisions

| # | Decision | Settled as | Status | Workstream |
|---|---|---|---|---|
| D1 | A new branch (and a store's first branch) automatically gets one default `BRANCH` warehouse, code from the branch code. | **Owner:** yes. Inventory creates one default `BRANCH` warehouse per branch from the branch event (idempotent by branch id) and backfills branches that have none. | Owner | A |
| D2 | What does `isWarehouse` mean? | **Default:** **Remove it** (or keep it only as "depot, no POS" and enforce it) | Default | A |
| D3 | A POS sale must use the sale's own branch warehouse, resolved automatically; never central or quarantine. | **Owner:** yes. A sale resolves its warehouse from its own branch; the client no longer chooses it; never central or quarantine. | Owner | A |
| D4 | Block deactivating or deleting a branch while it has stock above 0, an open shift, an unfinished order, a pending transfer or a live channel connection. Delete only after deactivate (`B004`). | **Owner:** blocked while the branch has stock, an open shift or a pending transfer, and the refusal lists every reason. Default adds unfinished orders and live channel connections. Delete only after deactivate (`B004`). | Owner | B |
| D5 | Block removing a member who has an open POS shift. (Locking: allow, and flag the shift.) | **Default:** **Yes** for removal | Default | B |
| D6 | Inactive branches count toward the plan limit; locked members do not. | **Default:** **Inactive branches yes, locked members no** | Default | B (member count) and D (the rest) |
| D7 | A store older than the plan limits gets its current plan applied to catalog now, with a warning period. | **Default:** **Yes**, backfill | Default | D |
| D8 | Branch code is fixed after creation and never reused; name stays editable. | **Default:** **Yes** | Default | B |
| D9 | A scoped member (sees only branch A) may create branches. | **Default:** **No** | Default | B |
| D10 | Self-serve store creation accepts a default branch name. | **Default:** **Yes** | Default | B |
| D11 | Limit the stores one account may create. | **Default:** **3** | Default | B |
| D12 | Invoice prefix unique per branch. | **Default:** **Yes** | Default | B |
| D13 | Warehouse code clash is an error (409); `POST` never overwrites; `PATCH` cannot move a stock-holding warehouse, and cannot detach it. | **Default:** **Yes** | Default | A |
| D14 | Only `BRANCH` warehouses belong to a branch, and only they count in branch stock. One default warehouse per branch, mandatory. | **Default:** **Yes** | Default | A |
| D15 | Remove the direct "add stock with no document" endpoint, or require document, cost and approval. | **Default:** **Remove** | Default | F |
| D16 | Retire the older branch-and-SKU-code stock model and its sale-completed deduction. | **Default:** **Yes**, after sales finishes moving | Default | F (partial) |
| D17 | Cancel a transfer after dispatch (stock returns to the source, reverse entry). Lost units: branch manager writes off at dispatch cost. Alert on a transfer still open after N days. | **Default:** **Yes; manager; 7 days** | Default | F |
| D18 | A transfer is confirmed by the receiving branch (or an admin), not pushed by the sender alone. Quarantine only to a branch, with manager approval. | **Default:** **Yes** | Default | F |
| D19 | Hold lifetime for a confirmed order not yet shipped. A bank or QR payment arriving after the hold expired. | **Default:** **Hold until fulfilled or cancelled; re-reserve, refund if now short** | Default | F, and C1 for the POS payment wait |
| D20 | Returns: approved before received and before a refund; restock to the original branch; at the original cost; a cashier may receive their own branch's return. | **Default:** **Yes to all four** | Default | C1 |
| D21 | Stock minimum alert on every crossing below the minimum. Stock take freezes sales: no. Receipt, stock take and PO need a second person to approve: not by default. | **Default:** **Yes; no; no** | Default | F |
| D22 | Every POS sale belongs to an open shift, and only to the caller's own shift (a manager may override). | **Owner:** yes. A POS sale belongs to an open shift, picked from the shifts open and available at the branch (a shared drawer). The **cashier of the order is the signed-in user**, never the shift opener. A place to manage shifts is required; there is no default cashier (access is by permission). | Owner | C1 |
| D23 | One person per register code, never two. | **Default:** **Yes** | Default | C1 |
| D24 | Closing a shift with open drafts is blocked (`S022`). | **Default:** **Block** | Default | C1 |
| D25 | Who may close another's shift; what happens to a shift whose employee left. | **Default:** **Opener or a manager; manager closes it and the variance goes to the closer, the opener stays the accountable cashier** | Default | C1 |
| D26 | A cash refund comes out of today's drawer, needs the refunding cashier's own open shift, and the shift is chosen by the server, never the client. | **Default:** **Yes** | Default | C1 |
| D27 | Cash shortage: who is responsible, tolerance, and the amount above which a note is required. | **Owner:** configurable per store: the tolerance, the approval threshold, who bears a shortage, the open-too-long limit. Defaults: 10,000đ; same as tolerance; `none`; 16 hours. | Owner | C1 |
| D28 | Scheduling: support shifts that cross midnight; warn (do not block) when a register is opened by someone not scheduled; a shift only in a branch the member belongs to; a locked member leaves the on-duty list at once. | **Default:** **Yes; warn; yes; yes** | Default | C2 (queued) |
| D29 | Revenue for managers and for commission: net of returns and refunds, gross shown beside it, one definition everywhere. May a salesperson see their own rows. | **Default:** **Net; yes, own rows only** | Default | C2 (queued) |
| D30 | Keep a name snapshot of staff so past sales still show who sold. | **Default:** **Yes**, a small member list fed by member events | Default | C2 (queued) |
| D31 | A paid plan past its end date: grace days, then drop to `free` limits (data kept, new adds blocked). | **Owner:** 7 days of grace, then `free` limits (data kept, new adds blocked). | Owner | D |
| D32 | Trial: yes or no, how long. | **Default:** **No trial now; hide the tab** | Default | D |
| D33 | Recording a payment: not on `free` or a closed subscription; any amount of 0 or more, a note when it differs from price × months. | **Default:** **Yes** | Default | D |
| D34 | Storage counts every file kept (attached images and imports too). | **Default:** **Yes** | Default | D |
| D35 | Suspending a store also stops marketplace webhooks, sync jobs and internal order creation; other services learn the store status and plan from an event. | **Default:** **Yes** | Default | D |
| D36 | Demoting or disabling an admin ends their sessions at once; the lockout numbers in settings take effect; minimum 3 attempts. | **Default:** **Yes** | Default | D |
| D37 | Audit log: who may read it and whether it is branch-filtered; which actions are recorded (branch changes, member lock, remove, role edits, shift open and close, stock adjustments, stock take approval, refunds, plan, suspension); a clear actor type (account, admin, system). | **Default:** **Owner only; branch managers see their branches; all listed; actor type** | Default | G (queued) |
| D38 | Member scope changes and branch deletion take effect immediately (sessions ended). | **Default:** **Immediately for removals, at expiry for additions** | Default | B |

## Build plan

Wave 1 is being built in parallel (6 workstreams, each its own pull request, each updating the API contracts it touches and
writing `built-<letter>.md` in this folder with decision, code, tests and deviations). Wave 2 is queued.

| Workstream | Content | Decisions | Wave |
|---|---|---|---|
| A | A store can trade: default warehouse per branch, sale from its own branch's warehouse, warehouse create and update fixed | D1, D2, D3, D13, D14 | 1 |
| B | Branch lifecycle: block delete and deactivate with every reason, delete only after deactivate, scope and session rules, member removal block, locked members do not count | D4, D5, D6 (members), D8 to D12, D38 | 1 |
| C1 | The cash session in sales: entries, count, tolerance and approval, locked shifts, shift management, refunds from the current drawer, returns | D20, D22 to D27 | 1 |
| D | Plans: expiry with 7 days of grace, no trial, payment rules, storage counting, quota resync, suspension honoured, admin sessions and lockout | D6, D7, D31 to D36 | 1 |
| E | Image uploads to S3 with presigned URLs from the API (catalog and pbl-infra) | not in the review | 1 |
| F | Stock integrity: transfer receive, idempotency, direct add-stock, cancel after dispatch, losses, minimum alerts, holds | D15 to D19, D21 | 1 |
| C2 | Shifts and people: overnight schedules, who is on duty, staff names kept, net revenue, own rows | D28 to D30 | 2 |
| G | Audit log and identity: more audited actions, actor type, branch filter | D37 | 2 |
