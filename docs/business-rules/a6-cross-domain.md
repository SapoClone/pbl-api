# Cross-domain audit: contradictions and gaps between services

Read-only audit of branch `docs/contracts-admin-status`, 2026-11-06. Paths relative to `/home/truong/Code/PBL6/pbl-api/apps` unless absolute. Built on the five domain reports (`rules/1..5`); I re-read the code for each flow. Nothing was executed. "Verdict" = WORKS / BREAKS / UNSPECIFIED. Where I did not verify something I say so.

Legend: PL = platform, INV = inventory, SAL = sales, INS = insight, FIN = finance, INT = integration, CAT = catalog.

---

## 1. Flow walkthroughs

### Flow 1. New store -> product -> stock -> sale -> shift -> staff-sales

Steps and evidence

| # | Step | Evidence | Verdict |
|---|---|---|---|
| 1a | Self-serve and admin create share `openStore`: store, owner member, branch `CN01` with `isWarehouse: true`, free subscription, `platform.branch.created` in the outbox | PL `api/tenant/tenant.service.ts:171-205` (`isWarehouse: true` at :176) | WORKS |
| 1b | Free plan = 1 branch, 3 users, 100 products, 1024 MB | PL `api/subscription/default-plans.ts:4-13` | WORKS |
| 1c | INV and SAL project the branch (`branch_projection`); INS caches it as a dimension. `isWarehouse` is copied into every projection and **read by nobody** | INV `branches/branch-projection.handler.ts:63`; SAL `branches/branch-projection.handler.ts:63`; grep of `isWarehouse` in INV/SAL/INS finds only the entity, the handler and the INS dimension metadata | UNSPECIFIED |
| 2 | Create product: CAT checks `tenant_plan_quota`. The row arrives by event after the subscription is created. Until it arrives, or if the event was lost, `lockAndLoad` returns null and the check **passes (fail-open)** | CAT `quota/plan-quota.service.ts:29-31,80-86` | WORKS in the normal case; BREAKS silently for a store without a row (rules/5 D-03) |
| 3 | Receive stock. **No warehouse exists.** Nothing creates one on `branch.created`: the only handlers are projections. Warehouses come only from `POST /inventory/api/v1/warehouses` (or the legacy `createWarehouse`). A receipt on an unknown warehouse answers `404 WAREHOUSE_NOT_FOUND` "Warehouse &lt;uuid> not found" | INV `modules/warehouses/warehouses.service.ts:68-147`; `:55-59`; INV `stock/stock.service.ts:165-200` | **BREAKS** (first failing step) |
| 4 | Sell at the POS. `PosCheckoutDto.warehouseId` is a mandatory UUID; SAL has no endpoint that lists warehouses or derives the branch's default. An owner who never created a warehouse cannot build a valid request: `400 warehouseId must be a UUID`. If the owner did create one, inventory only checks "exists and ACTIVE", not "belongs to this branch" | SAL `modules/checkout/checkout.dto.ts:60-61`; `grep warehouse` in SAL `modules/reference`, `modules/pos` finds nothing | **BREAKS** (no warehouse) / WORKS but unbound (with one) |
| 5 | Open a cashier shift. Branch must be `active` in the projection (else `400 UNKNOWN_BRANCH`). `registerId` is optional; the default `REG-01` register is lazily created only when `GET /branches/:id/registers` is called first | SAL `modules/shifts/shifts.service.ts:78-95`; `modules/reference/reference.service.ts:196-228` | WORKS |
| 6 | Sale with a shift: shift must be OPEN and in the same branch. It is optional, and the owner of the shift is not compared with the cashier | SAL `modules/checkout/checkout.service.ts:1741-1790` | WORKS, unbound (rules/4 #1) |
| 7 | Staff-sales: POS orders grouped by `orders.created_by`; rows carry ids only. Needs `reports.view`: **`sales_staff` does not have it**, so a cashier cannot see their own sales; manager/owner/accountant can | SAL `modules/staff-sales/staff-sales.controller.ts:25,38`; `/home/truong/Code/PBL6/pbl-api/libs/contracts/src/permissions.ts:120-135` | WORKS (permission gap) |

What the owner sees at step 3/4: a bare `404 WAREHOUSE_NOT_FOUND` from inventory or a validation error from sales. Neither tells them "create a warehouse for CN01". The branch looks ready (`isWarehouse: true`) but the flag is cosmetic.

Wrinkles on the free plan: the only branch cannot be deactivated or deleted (`B002`, `assertNotLastActive`, PL `api/branch/branch.service.ts:142,169`) and a second branch is refused by Q001, so the single branch can only be renamed. Q001 message is Vietnamese in PL and English in CAT.

Rule the owner must decide: D1 (auto-create a default warehouse per branch) and D2 (what `isWarehouse` means).

### Flow 2. Branch deactivated or deleted

Platform emits `platform.branch.updated` with `status: 'inactive'` or `'deleted'` (delete is a soft delete, event carries a fresh `updatedAt`). There is no `branch.deleted` event type (PL `api/branch/branch.service.ts:165-205`). Consumers of branch events: INV, SAL, INS only (`/home/truong/Code/PBL6/pbl-api/libs/contracts/src/topology.ts:210-262`). FIN, INT and CUSTOMER do not consume them.

| Layer | What happens | Evidence | Verdict |
|---|---|---|---|
| PL branch | Delete allowed while ACTIVE (contract's B004 not built); last active branch protected (B002) | `branch.service.ts:165-187` | WORKS, no downstream guard |
| PL member scope | `account_tenant_branch` rows stay. A member whose only branch is deleted keeps a token `branches=[deadId]`: sees nothing (safe), but the owner sees no signal. Scope is baked into the token, up to 1 day | `tenant/membership.service.ts:72-103` | UNSPECIFIED |
| PL staff schedule | Rows stay (FK to a soft-deleted branch). `branchName` resolves to null in on-duty views; inactive branches are accepted for new shifts | `staff-schedule/staff-schedule.service.ts:79,277-288` | UNSPECIFIED |
| INV warehouses | Stay ACTIVE. Receipts, issues, stocktakes, transfers (`assertActiveWarehouse` checks the warehouse only, never the branch) and reservations keep working. Only `POST /warehouses` rejects an inactive branch, and only if the projection row exists; PATCH does not check | INV `warehouses.service.ts:79-96`; `transfers/transfers.service.ts:49-50`; no `branch_projection` read in receiving/issuing/transfers | **BREAKS** (ignored) |
| INV stock | Stock of the dead branch stays in `stock_balance`, still in stock views (`branch_name` null after a delete is not guaranteed; the join reads the projection) | `stock-views/stock-views.service.ts:266-270` | UNSPECIFIED |
| SAL checkout / omnichannel / register | Refuse: `400 UNKNOWN_BRANCH` (POS checkout, shift open, omnichannel including the internal route) or 404 (registers) | `checkout.service.ts:1754-1763`; `shifts.service.ts:87-95`; `m3-orders.service.ts:169-177`; `reference.service.ts:196-228,252-265` | WORKS (refuses) |
| SAL open shift | Stays OPEN. `closeShift` does not read the branch, so it can be closed afterwards. Draft carts, open registers: no reaction | `shifts.service.ts:262-330` | WORKS (closable) |
| SAL orders in flight / returns / fulfilment | Not checked against branch status (only scope) | `returns.service.ts`, `fulfillment.service.ts` use `branchAllowed` only | UNSPECIFIED |
| INT connections | Each channel connection has a `branch_id`. No branch consumer, so the connection stays CONNECTED; webhooks are accepted and stored, then order import fails in SAL with `400 UNKNOWN_BRANCH`. How the job retries was not traced | INT `modules/webhooks/webhooks.service.ts:128-140` (checks only DISCONNECTED/PAUSED); `order-sync` passes `connection.branchId` (:402) | **BREAKS** (marketplace orders pile up) |
| INS | Dimension cache updated; reports keep the dead branch (name from the cache) | `consumers/insight-events.consumer.ts:123-148` | WORKS |
| FIN | No branch knowledge at all: journals, cashbook, shift variance are accepted for any branch id | no `branch_projection` in `finance/src` | UNSPECIFIED |

Impact: deleting a branch with stock, an open shift, pending transfers or live marketplace connections leaves orphans that nobody is told about, and inventory keeps accepting stock moves for it.

### Flow 3. Member removed or locked

| Aspect | Locked | Removed | Evidence |
|---|---|---|---|
| Tokens | Sessions of that store revoked via Redis deny-list; effective in every service that has `REDIS_HOST` (all do in `docker-compose.yml`; without the var there is **no check**, `libs/auth/src/pbl-auth.module.ts:62-103`) | same | PL `tenant/member.service.ts:171-189,221`; `session.service.ts:54-96` |
| Scheduled shifts | kept; locked member stays in on-duty (rules/4 BR-SH-14) | `staff_schedule` rows hard-deleted in the same transaction | `member.service.ts:215-216` |
| Branch scope | kept | membership and branch rows deleted | `member.service.ts:217` |
| Open POS shift | stays OPEN, no event, no notice. Register stays "busy" (a new open on that `registerId` gets `409 SHIFT_ALREADY_OPEN`). Anyone with `pos.update` in scope can close it (no owner check), so there is a manual way out; finance books the variance to the opener | SAL `shifts.service.ts:117-130,262-330`; FIN `reconciliation.service.ts:884` | **BREAKS** (silent orphan) |
| Past sales | `orders.created_by` keeps the account id; sales are not affected | SAL staff-sales | WORKS |
| Name resolution | Locked: still in `GET /members` (name visible). **Removed: the membership row is gone, `findMembership` answers 404; no projection of names exists in SAL/INV/INS/FIN** (grep for staff/member/account projection, `staffName`, `display_name` finds nothing). The account row survives but no endpoint serves it | `member.service.ts:110-121,438-452` | **BREAKS** (staff-sales and ledgers show raw ids for ex-staff) |
| Events | none emitted for lock, unlock, remove, branch reassignment | no outbox call in `member.service.ts` except granted (:263) and role_changed (:341) | UNSPECIFIED |
| Re-add | same account id comes back; history re-attaches | `member.service.ts:228-290` | WORKS |

Rule the owner must decide: D5 (block removal with an open shift?) and D6 (keep a name snapshot of staff).

### Flow 4. Store suspended, or plan lowered / expired

Suspend: PL sets status, emits `platform.tenant.status_changed`, then (after commit) denies every session family of the store (`api/platform-admin/admin-tenants.service.ts:380-397`). Only INS consumes the event (audit). No other service stores or checks tenant status or plan, except CAT's quota row.

| Path that survives suspension | Why | Evidence |
|---|---|---|
| Access tokens in services with no `REDIS_HOST`, or when the Redis write after commit failed | deny-list only | `pbl-auth.module.ts:62-103`; `admin-tenants.service.ts:396-397` |
| INT public webhooks `POST /:provider/:connectionKey` | `@Public`; checks connection status only; binds tenant from the connection row | INT `modules/webhooks/webhooks.controller.ts:21-22`; `webhooks.service.ts:104-140` |
| INT sync-job worker | polls every tenant with due jobs; no status check | INT `modules/sync-jobs/sync-job-worker.ts:51-89` |
| INT -> SAL internal order create | service token + `X-Tenant-Id`; every branch allowed; actor = zero UUID | SAL `internal/internal-orders.controller.ts:24,55-73` |
| Event consumers everywhere (stock, finance journals, loyalty, insight) | tenant context restored from the envelope; no status read | `libs/events/src/event-consumer.service.ts:78` |
| Reservation-expiry and reconcile jobs | per-tenant, no status read (not traced in detail) | `inventory/src/stock/reservation-expiry.job.ts` |

So a suspended store keeps taking marketplace orders, deducting stock and posting journals; it only loses interactive logins. Verdict: UNSPECIFIED, effectively "suspension = login ban".

Plan lowered or expired: PL refuses a downgrade when usage exceeds the new plan (S010, `admin-subscriptions.service.ts`), but a paid plan never expires (rules/5 D-02), and over-limit data created earlier is never trimmed. INV, SAL, INT, FIN never read plan limits (branches/members: PL; products/files: CAT). Quota event lag or loss = unlimited products (fail-open). Storage quota counts only `UPLOADED` files (rules/5 D-01).

### Flow 5. Identity of "who"

| Where | Column / value | Source | Survives member removal? | Evidence |
|---|---|---|---|---|
| SAL `orders.created_by`, `checkout_workflow.created_by`, shifts `staff_id` | account uuid (`NOT NULL uuid` in the base table; `varchar(64)` in the M3 tables) | token `user.id` | id yes, name no | SAL `checkout.service.ts:336`; migrations `1791800000000:23`, `1791900000200:522` |
| SAL omnichannel orders | **zero UUID** `00000000-...` | `SERVICE_ACTOR_ID` | n/a | `internal/internal-orders.controller.ts:24,69` |
| INV ledger `actor_id`, document `created_by` | `varchar(64)`: account id, or the literal `'system'` | `RequestContext.actor.id ?? 'system'` | id yes | INV `receiving.service.ts:264`, `issuing.service.ts:257`, `transfers.service.ts:216,450`, `stocktake.service.ts:321`, `procurement.service.ts:360` |
| INV sale commit / reservation ledger rows | **no actor** (`SALE_COMMIT` insert has no actor column) | n/a | trace only via `reference_id` = order | `stock/reservations.service.ts:1038-1075` |
| INV ledger view | `actor: {id, name: null}` always | n/a | name never resolved | `stock-views/stock-views.service.ts:489` |
| FIN journals `posted_by` | `varchar(64)`: account id, `'system'`, or the string `event:sales.shift.closed`; shift variance is posted by `staffId` (the opener), not the closer | `finance.entities.ts:129,413`; `reconciliation.service.ts:884-886` | id yes | FIN controllers `user.id ?? 'system'` |
| Events `actor` | `{id, type}` where type is `account` or `platform_admin`; `platform.branch.*` payload has **no actor at all** | `libs/common/src/propagation/event-envelope.ts:20`; `libs/contracts/src/events.ts:114` | n/a | |
| INS `audit_log.actor_id` | `uuid`, **no actor-type column**: account ids and platform-admin ids share one column | `insight/src/audit/audit-log.entity.ts:22`; handler `audit.handler.ts:70-110` | id yes | |
| PL `staff_schedule.account_id` | account uuid, FK, hard-deleted on removal | `member.service.ts:215` | no (by design) | |

Same account id is used everywhere (good), but the type differs (uuid vs varchar(64)), three non-account sentinels exist (`system`, zero UUID, `event:...`), and no service can show a name.

"Who did what" reports that exist: staff-sales (sales only, gross, ids), INV ledger (ids), audit log. The audit log records only 8 event types: login, membership granted, role changed, tenant created/updated/status changed, order completed, PO approved (`audit.handler.ts`, `@OnEvent` lines 26-127). It does **not** record branch create/update/delete, member lock/unlock/remove, branch reassignment, role permission edits, shift open/close, stock adjustments, refunds. PO approval is recorded with actor `null` (`:127-137`).

### Flow 6. Branch scope consistency

Rule "outside scope = 404, lists filtered" is implemented in PL (`BranchService`, schedules), INV (`WarehouseScopeService`, `scope/warehouse-scope.ts:1-60`), SAL (`branchAllowed` / `assertBranchAllowed` / `branchFilter`), INS (`common/branch-scope.ts`), FIN (`presentation/branch-scope.ts`) and INT (`modules/branch-scope`). Exceptions found:

| Where a restricted member still sees or changes other branches | Evidence | Severity |
|---|---|---|
| INS `GET /audit-logs`: tenant-wide on purpose; requires only `reports.view`, which `branch_manager` has. Summaries include "Order X completed for N VND" of every branch, owner logins, member emails and roles | INS `modules/screens/screens.controller.ts:38-41`; `audit/audit-query.service.ts:9-18`; `audit.handler.ts:113-125` | High |
| INV `POST /warehouses` is an upsert on `(tenant_id, code)`: a manager scoped to branch A posts the code of branch B's warehouse with `branchId=A` and rewrites its name/branch/default (`branch_id = COALESCE(EXCLUDED, old)`). The scope check only looks at the **new** branchId | `warehouses.service.ts:111-147`; controller `warehouses.controller.ts:53-57` | High |
| INV transfer create checks only the source warehouse; destination can be any branch/central/quarantine | `transfers.controller.ts:50-54` (rules/3 D-13) | Medium |
| SAL sale warehouse not tied to the sale's branch (cashier of A sells from B or central stock) | `reservations.service.ts:582-584` (rules/3 D-03) | High |
| SAL staff-sales `productsOf`: staff id is not scope-checked but the branch filter is applied, so it is safe (verified `filters()` pushes `o.branch_id = ANY`) | `staff-sales.service.ts:75-100` | OK |
| PL create branch: not scope-limited, but needs `settings.update`, which `branch_manager` lacks (`permissions.ts:111-122`); only custom roles are exposed | `branch.controller.ts:74` | Low |
| INS exports: job stores `allowed_branch_ids`, and a scoped user cannot read a tenant-wide export | `insight-export.service.ts:420-440` | OK |
| INT: connections/jobs/mappings 404 outside scope; webhooks and worker deliberately unscoped | `branch-scope.service.ts` | OK |
| Scope is a token claim, up to 1 day stale; branch reassignment emits no revoke or event | PL `member.service.ts:300-366` (rules/1 #4) | Medium |

A member with no branch rows means every branch, so a branch created later is visible to unscoped members and invisible to scoped ones until assigned.

### Flow 7. Money and units

| Aspect | State | Evidence |
|---|---|---|
| Money is integer VND in SAL, FIN (`parseVnd`), events (`OrderCompletedPayload` documents integer VND); INV `unit_cost`/`avg_cost` are `bigint` | consistent | `libs/contracts/src/events.ts:242-260`; INV `reservations.service.ts:1038-1075` |
| Quantities: legacy `stock_item.quantity_on_hand integer` (by branch + sku string) vs `stock_balance` and `order_items.base_qty numeric(18,3)` (warehouse + variant). Two stock stores; `GET /stock` and `GET /stock-levels` can disagree; every `order.completed` also hits the legacy handler | INV `migrations/1791900000000:16`; SAL `migrations/1791900000200:119`; rules/3 D-01, rules/2 D-16 | BREAKS (dual model) |
| Revenue basis differs per view: staff-sales list = `SUM(grand_total)` (after order discount, includes tax if any); per-product drill-down = `SUM(line_net)` (before the order-level discount). The totals of the two views will not add up when an order discount exists | SAL `staff-sales.service.ts:57-66` vs `:100-106` | BREAKS |
| Gross vs net of returns: staff-sales is gross (comment says so); INS dashboard/sales summaries sum `sales_order_facts.grand_total` with no reference to `sales_return_facts` in `screen-reports.service.ts` (return facts are written, `projections.service.ts:1575-1625`, but I found no screen query reading them); FIN books refunds. Net sales exist nowhere as one number | | UNSPECIFIED |
| `itemsSold` = base units; product rows = base units; order-completed event items carry `quantity` with no stated unit; INS apportions COGS by `qty * unitPrice` | `consumers/insight-events.consumer.ts:85-104` | UNSPECIFIED |
| Commission base for staff: undefined (rules/4 Q6) | | UNSPECIFIED |

---

## 2. Cross-domain defects ranked by business impact

| # | Defect | Domains | Evidence | Impact |
|---|---|---|---|---|
| X-01 | A new store cannot sell or receive: no warehouse is created for CN01 and sales has no way to discover one. `isWarehouse` is ignored by every consumer | PL, INV, SAL | `tenant.service.ts:176`; `warehouses.service.ts:68-147`; `checkout.dto.ts:60-61` | First-run failure for every store; support load |
| X-02 | Branch deletion/deactivation is ignored by inventory (stock moves continue), integration (connections stay live, orders queue and fail), finance (no knowledge); no guard on open shifts, stock, transfers | PL, INV, INT, FIN, SAL | Flow 2 | Orphaned stock and money; silent order loss from marketplaces |
| X-03 | Suspension = login ban only. Webhooks, sync worker, internal order create, event consumers, expiry jobs keep writing for a suspended store. No service stores tenant status | PL, INT, SAL, INV, FIN | Flow 4 | The business tool for non-payment or abuse does not stop data writes |
| X-04 | Sales are not bound to a branch's warehouse or to the cashier's own open shift; central/quarantine/other branch stock can be sold from the POS | SAL, INV | `reservations.service.ts:582-584`; `checkout.service.ts:1741-1790` | Wrong stock, untraceable cash drawer |
| X-05 | Audit log is tenant-wide for any `reports.view` holder (all branch managers) and exposes other branches' sales amounts, emails and roles; it records only 8 event types (nothing on branch changes, member lock/remove, shifts, stock, refunds); actor column mixes account and admin ids with no type | INS, PL | Flow 5, 6 | Privacy break between branches; cannot answer "who did what" for most actions |
| X-06 | Ex-staff names cannot be resolved anywhere (removal deletes the membership; no name projection or snapshot); ledger view returns `name: null` always | PL, SAL, INV, FIN | `member.service.ts:438-452`; `stock-views.service.ts:489` | Staff-sales, ledger and finance history show raw ids after a person leaves |
| X-07 | Member removal/lock leaves their open POS shift OPEN, the register busy, no event; schedule hard-deleted; no link between schedule and POS shift | PL, SAL, FIN | Flow 3; rules/4 #7 | Cash drawer stuck until a manager notices; variance attributed to the departed opener |
| X-08 | Inventory warehouse upsert lets a branch-scoped member take over another branch's warehouse | INV, PL scope | `warehouses.service.ts:111-147` | Cross-branch tamper by a normal manager |
| X-09 | Plan limits are enforced only for branches/members (PL) and products/files (CAT, fail-open when the quota row is missing); storage counts only unattached files; paid plans never expire | PL, CAT | rules/5 D-01..D-03 | Free-plan bypass; revenue leakage |
| X-10 | Two stock stores and two revenue bases: gross vs net of returns is not unified; staff-sales list and drill-down use different bases | SAL, INV, INS | Flow 7 | Reports that do not reconcile; commission disputes |
| X-11 | Identity sentinels and types are inconsistent (uuid vs varchar(64); `system`, zero UUID, `event:sales.shift.closed`); sale stock commits carry no actor; finance books shift variance to the opener not the closer | SAL, INV, FIN, INS | Flow 5 | Weak accountability; joins by id need case handling |
| X-12 | Token carries scope, role and tenant for up to 1 day; scope or role changes and branch deletion emit no revoke or event; branch events have no actor | PL, all | rules/1 #4; `events.ts:114` | Slow propagation of permission changes |
| X-13 | Sales-staff cannot restock returns (needs `inventory.create`); error maps to 503 `S005`; inventory 4xx mis-mapped | SAL, INV | rules/3 D-02b, D-11 | Cashier flow fails with a misleading error |
| X-14 | Q001 error text is Vietnamese in PL and English in CAT; the web reads `details` | PL, CAT | rules/5 D-13 | Inconsistent UX only |

---

## 3. Glossary (proposed single definitions)

| Term | How it is used today | Proposed single definition |
|---|---|---|
| Store / tenant | "store" in UI and PL entity `tenant`; `tid` in tokens; INS says "store"; admin area says "tenant" | **Store** (UI, docs) = **tenant** (code, ids): one customer business, the unit of plan, isolation and suspension. Never use "store" for a physical outlet. |
| Branch | PL entity with `isWarehouse` flag; INV uses `branch_id` on warehouses and on legacy `stock_item`; SAL `branch_id` on orders, shifts, registers | **Branch** = a physical or logical place of business of a store (shop, depot, kiosk); owns registers, staff assignment and warehouses; has status active/inactive/deleted; carries the branch scope. |
| Warehouse | INV stock location with `kind` BRANCH/CENTRAL/QUARANTINE and optional `branch_id`; PL `isWarehouse` marks a branch as a warehouse-type branch; legacy stock keyed by branch | **Warehouse** = an INV stock location. Exactly one default warehouse of kind BRANCH per sellable branch. `branch.isWarehouse` should be renamed or dropped: it is a branch **type**, not a warehouse record. |
| Register | SAL `registers` row (lazily created `REG-01`); `registerCode` string on shifts; "counter" in UI | **Register** = a physical till of a branch (code unique per branch). A POS shift is always opened on a register, one open shift per register. |
| Shift | Two unrelated things: POS cashier shift (SAL `pos_shifts`, cash drawer) and work shift (PL `staff_schedule`, weekly roster) | **POS shift** = one cashier's cash session on a register (open to close, counted cash). **Work shift** (roster slot) = scheduled weekly working time of a member in a branch. Use these two names everywhere; the API may keep paths but docs must not say bare "shift". |
| Staff / member / account | `account` (PL identity, can belong to many stores), `account_tenant` = member / membership, "staff" in schedule and staff-sales, `created_by`/`actorId` in data | **Account** = a person's login across stores. **Member** = an account's membership in one store (role, branch scope, status). **Staff** = UI word for a member who works shifts. Stored attribution ("who") always holds the **account id**, with a name snapshot (D6). |
| Actor | token `user.id` with type `account` / `platform_admin` / `system` | **Actor** = account id plus actor type; service-initiated writes use type `system` with a null id (not the zero UUID, not the string `system`). |
| Sale / order | SAL `orders` for POS and omnichannel; `channel_type` POS vs others | **Order** = any sales document; **sale** = a COMPLETED order. Staff-sales counts POS only by default. |
| Revenue | `grand_total` (staff-sales list, INS) vs `line_net` (drill-down) vs gross vs net of returns | **Revenue** = `grand_total` (after all discounts), shown as **gross**; **net revenue** = gross minus refunded amount. Always label which. |
| Quantity | base units vs sell units vs integer legacy qty | **Quantity** is stored in base units (numeric(18,3)); display units are a presentation concern. |

---

## 4. Decisions the business owner must make

| # | Question | Answer form | Recommended default |
|---|---|---|---|
| D1 | Should creating a branch (and the store's first branch) automatically create one default BRANCH warehouse (code = branch code)? | yes/no | Yes: inventory consumes `branch.created` and inserts it; sales resolves `warehouseId` from the branch when the client omits it |
| D2 | What does `isWarehouse` mean? | meaning, or "remove" | Remove from the contract; or keep only as "depot branch: no POS registers" and enforce it |
| D3 | Must a POS sale use a warehouse that belongs to the sale's branch and has kind BRANCH? | yes/no | Yes |
| D4 | Branch delete/deactivate rule: block while the branch has stock > 0, open POS shifts, unfinished orders, pending transfers or live channel connections? | yes/no | Yes block (409 with the list); delete only when INACTIVE (build B004) |
| D5 | Block removing or locking a member who has an open POS shift? | yes/no | Yes block removal; for lock, allow and flag the shift in the manager's list |
| D6 | Keep a name snapshot of staff (in orders, ledger, journals, or a projection of members that survives removal)? | yes/no | Yes: a `member_projection` (id, name, status, removedAt) fed by member events; show it for removed staff |
| D7 | Must a suspended store stop: marketplace webhooks, sync jobs, internal order create, consumers? | yes/no per path | Yes for webhooks, sync worker, S2S create (reject 403 `TENANT_SUSPENDED`); consumers keep draining (data in flight) |
| D8 | How should services learn tenant status and plan? | project via event / call platform | Project `tenant.status` and plan into each service the way CAT projects quotas, with a backfill |
| D9 | Paid plan past `expiresAt`: grace days before downgrade to free (number), and trim or block over-limit usage? | days; trim/block | 7 days grace, then downgrade to free; existing data kept read-only, new adds blocked (Q001) |
| D10 | Do deactivated branches and locked members still count against plan limits? | yes/no | Yes for locked members; no for deactivated branches (or tell the owner explicitly on the upgrade message) |
| D11 | Who may read the audit log, and must it be branch-filtered? | permission + yes/no | A dedicated `audit.view` for owner only; branch managers see events of their branches only |
| D12 | Which actions must be audited? | list | Branch create/update/delete, member lock/unlock/remove/branch change, role edits, shift open/close, stock adjustment and stocktake approve, refunds, plan/suspension |
| D13 | May a cashier ring a sale without an open POS shift, or into another cashier's shift? | yes/no each | No for both (POS channel); manager override permission allowed |
| D14 | Who closes an orphaned POS shift (opener left)? | role | Branch manager, with the variance posted to the **closer** and the opener kept as accountable cashier |
| D15 | Revenue shown to managers and for staff commission: gross or net of returns? | gross/net | Net, with gross shown beside it; one definition across SAL, INS and FIN |
| D16 | Should staff-sales be visible to `sales_staff` for their own rows? | yes/no | Yes, own rows only (new permission or filter by caller) |
| D17 | May a branch-scoped manager create or overwrite warehouses outside their branch? | yes/no | No; make `POST /warehouses` a plain insert (409 on duplicate code) and check scope on the existing row for PATCH |
| D18 | Should member scope changes and branch deletion take effect immediately (revoke sessions) or at token expiry (up to 1 day)? | immediate / expiry | Immediate for removal of branches from a member and for branch delete; expiry for additions |
| D19 | Should service-created writes record an actor type `system` (null id) instead of the zero UUID and free strings? | yes/no | Yes; migrate columns to one shape |
| D20 | Cap on the number of stores one account can own (number) | number | 3 |

Not verified in this audit: runtime behaviour (no tests or servers run); retry policy of the INT sync worker on `UNKNOWN_BRANCH`; whether any screen still reads legacy `stock_item`; exact SAL reaction to deleted-branch orders already in flight.
