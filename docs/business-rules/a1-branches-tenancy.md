# Business rules: Branches and tenancy (platform service)

Analyst 1 of 5. Read-only analysis of branch `docs/contracts-admin-status`. Date 2026-11-06.
Paths below are relative to `/home/truong/Code/PBL6/pbl-api`. "BS" = `apps/platform/src/api/branch/branch.service.ts`, "TS" = `apps/platform/src/api/tenant/tenant.service.ts`, "MS" = `apps/platform/src/api/tenant/member.service.ts`, "QS" = `apps/platform/src/api/subscription/quota.service.ts`.
No test was executed; evidence is by reading code and specs. Unit specs mock the database (`branch.service.spec.ts` mocks QuotaService), so concurrency and SQL behaviour are only proven by `apps/platform/test/quota.int-spec.ts` (Postgres, not run here).

## 1. Scope and sources read

- `CLAUDE.md`
- `apps/platform/src/api/branch/`: `branch.service.ts`, `branch-setting.service.ts`, `branch.controller.ts`, `entities/branch.entity.ts`, `entities/branch-setting.entity.ts`, `dto/create-branch.req.dto.ts`, `dto/update-branch.req.dto.ts`, `dto/update-branch-setting.req.dto.ts`, specs (`branch.service.spec.ts`, `branch.controller.spec.ts`, `branch-setting.service.spec.ts`)
- `apps/platform/src/api/tenant/`: `tenant.service.ts`, `member.service.ts`, `membership.service.ts`, `entities/account-tenant-branch.entity.ts`, specs (`tenant.service.spec.ts`, `membership.service.spec.ts`, `member.service.spec.ts` grep only)
- `apps/platform/src/api/subscription/quota.service.ts`, `usage.ts`, `default-plans.ts`; `apps/platform/test/quota.int-spec.ts`
- `apps/platform/src/domain/platform-domain.ts`
- `apps/platform/src/api/platform-admin/admin-tenants.service.ts` (suspend / reactivate / create), `admin-subscriptions.service.ts` (grep: S010 downgrade check)
- `apps/platform/src/api/auth/access-token.service.ts`, `auth.service.ts` (grep: refresh / login use `MembershipService`)
- `libs/auth/src/auth.helpers.ts`, `access-token.verifier.ts`, `auth.decorators.ts`
- `libs/contracts/src/events.ts` (BranchEventPayload), `apps/inventory/src/branches/branch-projection.handler.ts`, `apps/sales/src/branches/branch-projection.handler.ts`, consumer sites in sales (`m3-orders.service.ts:170`, `checkout.service.ts:1754`, `shifts.service.ts:87`, `orders.service.ts:746`) and inventory (`stock.service.ts:77`, `warehouses.service.ts:90`)
- `docs/specs/2026-10-28-api-contracts/01-platform.md` (lines 205-320), `docs/specs/2026-10-31-rbac/platform.md`

Not verified: insight consumer behaviour for branch events, catalog's branch usage, KrakenD routing, DB migrations, the `roles` / `permission` controllers beyond seeding.

## 2. Rules table

Status legend: ENFORCED (read the enforcing code), PARTIAL, MISSING (no code), CONTRADICTED (code disagrees with the contract/spec).

### 2.1 Store (tenant) creation

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-01 | Only an ACTIVE account may open a store; any other account status is answered 401. | ENFORCED | TS:86-92. Test: none found for the 401 branch (not verified in `tenant.service.spec.ts`). | |
| BR-BR-02 | A store subdomain is unique; a duplicate is answered 400 `T001`, also when two creations race (unique index `UQ_tenant_subdomain` is mapped to T001). | ENFORCED | TS:93-99, 112-118. Test: `tenant.service.spec.ts:195`, `:205`. | Pre-check uses `exists`, which skips soft-deleted tenants; whether a deleted store's subdomain can be reused depends on the index definition (not verified). |
| BR-BR-03 | Opening a store is atomic: the store, its 5 seeded roles, the owner membership, the default branch, the first subscription and the `platform.branch.created` event all commit together or not at all. | ENFORCED | TS:101, 126-209 (single `dataSource.transaction`). Test: `tenant.service.spec.ts:90`, `:127`, `:168`, `:160` (seeds nothing when subdomain taken). | Unit test uses mocks; rollback is not proven against Postgres by a platform test I read. |
| BR-BR-04 | The creator becomes the store owner (role code `owner`, status active, member code `NV001`-style from `formatMemberCode(1)`); the owner has permission `*` and branch `*` in every token. | ENFORCED | TS:155-166; `membership.service.ts:100-106`. Test: `membership.service.spec.ts:143`. | Exact member code format not verified (`member-code.ts` not read). |
| BR-BR-05 | A new store gets exactly one branch: code `CN01`, name "Chi nhánh chính", `isWarehouse = true`, status active. | ENFORCED | TS:171-181; `entities/branch.entity.ts:21-24`. Test: `tenant.service.spec.ts:90`. | |
| BR-BR-06 | Self-serve store creation takes the default branch name from the request body (`defaultBranchName`, optional). | CONTRADICTED | Contract `01-platform.md:211-219` says so; `CreateTenantReqDto` has only `name`, `subdomain`, phone, email, address (`tenant/dto/create-tenant.req.dto.ts:27`); `TS.create` never passes it (TS:102-110). Only the admin create path passes it (`admin-tenants.service.ts:303`). | Self-serve owners always get "Chi nhánh chính" and must rename afterwards. |
| BR-BR-07 | Opening a store seeds five roles (owner, branch_manager, sales_staff and two others from `SEEDED_ROLES`) before the owner joins. | ENFORCED | TS:155; `role/role-seeding.ts`. Test: `tenant.service.spec.ts:127`, `role-seeding.spec.ts`. | The exact five names were not re-listed here; see analyst for roles. |
| BR-BR-08 | A self-serve store starts on the `free` plan (1 branch, 3 members, 100 products, 1024 MB); an admin-created store starts on the chosen plan. | ENFORCED | TS:182-191; `subscription/default-plans.ts:9-12`. Test: `quota.int-spec.ts:73` (first plan announced). | |
| BR-BR-09 | The default branch creation is not subject to the branch quota. | ENFORCED (by omission) | TS:171 uses raw `em.save`, no `QuotaService` call. | A plan with `quotaBranches = 0` is not guarded; not an issue with seeded plans (min 1). |
| BR-BR-10 | Creating a store emits `platform.tenant.created`. | CONTRADICTED | Contract `01-platform.md:222` lists it as new. Emitted only by the admin path (`admin-tenants.service.ts:308`); self-serve `openStore` emits only `platform.branch.created` (TS:195-207). | Consumers of tenant.created (insight, catalog) never learn of self-serve stores that way. Whether they need it: not verified. |
| BR-BR-11 | No limit exists on how many stores one account may create. | MISSING | TS:81-119 has no count of the account's memberships. | Strict reader asks if intended. |
| BR-BR-12 | A branch settings row is not created at store creation; it is created with defaults on first read. | ENFORCED | `branch-setting.service.ts:56-77`. Test: `branch-setting.service.spec.ts:25`, `:92`. | Downstream services that need the invoice prefix before anyone opens settings cannot read it from an event (see BR-BR-35). |

### 2.2 Branch create / update / deactivate / delete

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-13 | Creating, updating, deleting a branch and changing its settings need permission `settings.update`; reading settings needs `settings.view`; listing and reading branches needs only a store-selected token. | ENFORCED | `branch.controller.ts:74,101,118,134,150`. Test: `branch.controller.spec.ts:185-290`. | Contract says "owner" (`01-platform.md:273`); code uses a permission, so a custom role holding `settings.update` can do it. Owner-only is not enforced. |
| BR-BR-14 | A token with no selected store gets 403 on every branch route. | ENFORCED | `@CurrentTenant()` on every route (`branch.controller.ts:62-153`). Test: pinned in `branch.controller.spec.ts` (per comment line 45; not re-read line by line). | |
| BR-BR-15 | A branch `code` is trimmed, upper-cased, 1-20 characters of A-Z, 0-9, `_`, `-`. | ENFORCED | `dto/create-branch.req.dto.ts:11-17`, `update-branch.req.dto.ts:10-15`; column `varchar(20)` (`entities/branch.entity.ts:54`). | `BranchCodeVO` in `domain/platform-domain.ts:44` says 2-32 chars and starts alphanumeric; it is not used by any service (grep), so the two definitions disagree. A one-character code or one starting with `_` / `-` is accepted by the API. |
| BR-BR-16 | A branch code is unique among the store's live branches (case-insensitive by upper-casing); a duplicate is 400 `B001`, also under a race. | ENFORCED | BS:95, 127-129, 218-222, 254-260; partial unique index `UQ_branch_tenant_code ... WHERE deleted_at IS NULL` (`branch.entity.ts:27-30`). Test: `branch.service.spec.ts:218`, `:311`, `:331`. | Code of a deleted branch is free for reuse, so the same code can map to two branch ids over time (history, reports, invoices that print the code). |
| BR-BR-17 | A branch code can be changed by PATCH, and nothing blocks it when the branch has stock, orders or invoices. | PARTIAL | BS:127-129, 131-136. Contract PATCH body lists `name, address, phone, isWarehouse, status` only (`01-platform.md:289`). | Contradicts the contract (code is not patchable there). Consumers see the new code through `platform.branch.updated` (BR-BR-31). |
| BR-BR-18 | `isWarehouse` defaults to true on create and can be toggled on update at any time, including when stock exists in the branch. | PARTIAL | BS:100; `update-branch.req.dto.ts:38`. No check against inventory. | Business meaning of the flag is not enforced anywhere in platform. Inventory/sales usage of `isWarehouse`: not found in grep of their services (only stored in the projection). A strict reader asks what the flag changes. |
| BR-BR-19 | A new branch is ACTIVE. `address` and `phone` are optional; `phone` is 8-15 digits with an optional `+`; `name` max 150. | ENFORCED | BS:97-106; DTOs above. | |
| BR-BR-20 | A store cannot deactivate its last ACTIVE branch (400 `B002`). Concurrent deactivations are serialised by locking the store row `FOR NO KEY UPDATE` before counting. | ENFORCED | BS:138-151, 224-248; `domain/platform-domain.ts:175-181`. Test: `branch.service.spec.ts:236`, `:286` (mock-level lock assertion). | Lock is only taken when `status` goes active to inactive in this request. Second concurrent request counts after the first commits (new statement under READ COMMITTED), so the invariant holds. Not proven on a real DB. |
| BR-BR-21 | A store cannot delete its last ACTIVE branch (400 `B002`), same lock. | ENFORCED | BS:165-177. Test: `branch.service.spec.ts:226`, `:263`. | |
| BR-BR-22 | An inactive branch can always be deleted: the delete path for an inactive branch runs no last-branch count. | ENFORCED | BS:179-186. Test: `branch.service.spec.ts:247`. | With one active and several inactive branches the store keeps its invariant; the rule is "an inactive branch may always be deleted". |
| BR-BR-23 | A branch must be inactive before it can be deleted (400 `B004`). | CONTRADICTED | Contract `01-platform.md:300`. `B004` does not exist in `constants/error-code.constant.ts` (only B001, B002 at lines 55-56); BS:165-177 deletes an ACTIVE branch directly when others remain. | Highest-impact mismatch of this domain: one click deletes a live trading branch. |
| BR-BR-24 | Deleting a branch is a soft delete (row kept, `deleted_at` set), frees its code, and is announced as `platform.branch.updated` with `status: "deleted"`. | ENFORCED | BS:170-175, 181-186, 201-205. Test: `branch.service.spec.ts:201`. | `deletedBy` is not recorded (`softDelete` by id only). |
| BR-BR-25 | A branch with stock, open register shifts, unfinished orders, pending transfers or staff schedules cannot be deactivated or deleted. | MISSING | No call or event to inventory/sales in BS:121-187. | Platform is the only gate; downstream just starts refusing new work (BR-BR-32). Stock in a deleted branch stays in inventory with no owner. |
| BR-BR-26 | Staff schedules of a deleted branch are removed or flagged. | MISSING | BS:165-187 touches nothing else; `staff-schedule` not read for branch deletion (not verified for FK behaviour). | |
| BR-BR-27 | A branch's settings row is kept when the branch is soft-deleted (orphan), and 404s afterwards. | ENFORCED (as behaviour) | `branch-setting.service.ts:56-60` checks the branch exists first. Test: `branch-setting.service.spec.ts:56`. | |
| BR-BR-28 | A branch of another store, or a deleted one, is 404 on get/update/delete/settings. | ENFORCED | `TenantScopedRepository` (BS:208-216), soft-delete excluded by default. Test: `branch.service.spec.ts:141`, `:151`. | |
| BR-BR-29 | Reactivating an inactive branch needs no quota check (inactive branches already count). | ENFORCED (by design) | QS:44 counts every non-deleted branch regardless of status. | See BR-BR-38 for the business question. |

### 2.3 Events and projections

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-30 | Branch create, update and delete write their event in the same transaction as the change (outbox), so both or neither commit. | ENFORCED | BS:108-117, 141-150, 153-161, 168-186. Test: `branch.service.spec.ts:176`, `:191`. | |
| BR-BR-31 | Event payload carries `id, code, name, isWarehouse, status, updatedAt` only (no address, phone, settings). | ENFORCED | BS:190-206; `libs/contracts/src/events.ts:114-122`. | Address/phone are not projected, so downstream documents (receipts) that print them must call platform. |
| BR-BR-32 | Sales and inventory accept new work only for branches whose projected status is exactly `active`; unknown, `inactive`, or `deleted` is refused (sales: 400 UNKNOWN_BRANCH). | ENFORCED (downstream) | `apps/sales/src/modules/orders/m3-orders.service.ts:170-176`, `checkout.service.ts:1754-1762`, `shifts.service.ts:87-96`, `orders.service.ts:746`; `apps/inventory/src/stock/stock.service.ts:77`. | Inventory warehouses tolerate a missing projection row (`warehouses.service.ts:90`: refuses only if row exists and is not active). No test read. Reading existing data of a deleted branch is not blocked (not verified). |
| BR-BR-33 | A consumer ignores an event older than the row it holds (`sourceUpdatedAt`), and writes under the event's tenant. | ENFORCED | `inventory/.../branch-projection.handler.ts:38-68`, same in sales. | Delete events use `new Date()` as `updatedAt` (BS:201-204), so a delete outranks an earlier update. A clock-skewed later update could resurrect a deleted branch (edge, low). |
| BR-BR-34 | A projection lag exists: between commit and consumption a deactivated branch may still accept an order in sales. | PARTIAL | Outbox is asynchronous; no synchronous check. | Acceptable only if the business tolerates seconds of lag. |
| BR-BR-35 | Branch settings changes emit `platform.branch_settings.updated` so POS reads payment methods. | MISSING | Contract `01-platform.md:317`; no such event in `libs/contracts/src/events.ts` or grep of apps. | POS must call platform to read allowed payment methods, invoice prefix, tax rate. |

### 2.4 Branch settings

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-36 | Defaults of a branch's settings: invoice prefix `HD`, template none, default tax 0 %, payment methods cash + transfer + card. | ENFORCED | `entities/branch-setting.entity.ts:100-109`; `branch-setting.service.ts:63-75`. Test: `branch-setting.service.spec.ts:25`. | Contract example shows `Q3-` prefix (with hyphen) and `e_wallet`. |
| BR-BR-37 | Invoice prefix: trimmed, upper-cased, 1-20 of A-Z 0-9 `_` `-`; tax rate 0-100 (2 decimals); payment methods: at least 1, no duplicates, only `cash, transfer, card, e_wallet, cod, marketplace`; template `receipt_80mm` or `receipt_58mm` or null. | ENFORCED | `dto/update-branch-setting.req.dto.ts:11-39`; `entities/branch-setting.entity.ts:86-98,155-167`. | Nothing stops two branches sharing the same invoice prefix (no unique index; sales uses its own `HD` document code, `m3-orders.service.ts:178`, so the setting may not even be used: not verified). Changing the prefix mid-year has no stated effect on numbering. |

### 2.5 Branch scope (member to branches, token, 404)

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-38 | A member with no assigned branch rows may act in every branch (`['*']`); the owner always may. | ENFORCED | `membership.service.ts:103-106`; `entities/account-tenant-branch.entity.ts:12-15`. Test: `membership.service.spec.ts:107,143`. | Default of "no rows = all branches" means a forgotten assignment grants full scope (fail-open). RBAC doc decision 4 accepts it. |
| BR-BR-39 | Assigned branch ids must all be live branches of the store, else 400 `T023`; duplicates are collapsed; the owner's branches cannot be changed (`T003`). | ENFORCED | MS:388-403, 313-327. Test: `member.service.spec.ts` (T023 not re-read; assumed from RBAC doc test list, not verified). | `assertBranches` counts branches of any status, so an INACTIVE branch can be assigned. |
| BR-BR-40 | Assigning `branchIds: []` (PATCH) resets the member to every branch. | ENFORCED | MS:350-357, 411-417. | |
| BR-BR-41 | The token claim `branches` lists the member's branch ids (sorted) or `['*']`; it is written only when the token has a store. A token whose verifier finds no `branches` claim is read as every branch. | ENFORCED | `access-token.service.ts:92-101`; `libs/auth/src/access-token.verifier.ts:82-91`. Test: `libs/auth/src/auth.helpers.spec.ts:17-29`. | Fail-open on a missing claim. Tokens are RS256-signed, so only a platform bug could omit it. |
| BR-BR-42 | An out-of-scope branch is answered 404 (never 403) on get, update, delete and settings; the list shows only allowed branches; an empty scope returns an empty list (not everything). | ENFORCED | `branch.controller.ts:163-167`; BS:56-61. Test: `branch.service.spec.ts:430-447`, `branch.controller.spec.ts:219-285`. | Create is not scope-restricted: a scoped member with `settings.update` can create a new branch, which they themselves cannot then see. |
| BR-BR-43 | A branch assignment, role change or branch deletion reaches the member only at the next refresh or sign-in (up to the access-token life, 1 day); no revocation. | ENFORCED (documented behaviour) | `docs/specs/2026-10-31-rbac/platform.md:29`; `auth.service.ts:359-365` (refresh re-reads membership). | Removing a branch from a member leaves up to 24 h of access. Only lock/remove of the member revokes sessions (`MS:183,221`). |
| BR-BR-44 | A member whose assigned branches were all deleted sees nothing (scope is the dead ids, not `*`); only an owner PATCH with `[]` restores all. | ENFORCED (documented) | RBAC doc decision 4 (`platform.md:53`); stale rows are kept (no cascade for soft delete; `account_tenant_branch` FK to branch is not triggered). | Member can still sign in, gets an empty branch list, no notice to the owner. |
| BR-BR-45 | `GET /tenants/current/context` lists only ACTIVE branches within scope and `branchCount` counts only those; `GET /branches` lists every status within scope. | ENFORCED | `tenant.service.ts:257-264`, 289; BS:48-85. Test: `tenant.service.spec.ts:465-495`. | The two screens can show different counts. |
| BR-BR-46 | Creating a branch does not add it to any scoped member; only owners and "all branches" members see it. | ENFORCED (by omission) | BS:91-119 touches no `account_tenant_branch`. | Strict reader may expect the creator to get access. |

### 2.6 Plan limits

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-47 | Adding a branch over the plan's `quotaBranches` is refused 409 `Q001` with `details {key, used, limit, planCode}`. Free = 1, Basic = 2, Pro = 5. | ENFORCED | QS:29-52, BS:108-117, `default-plans.ts:9,20,31`. Test: `quota.int-spec.ts:30` (real Postgres, not run), `branch.service.spec.ts` mocks quota (no Q001 unit case). | |
| BR-BR-48 | Adding a member (existing account added to the store) over `quotaUsers` is refused 409 `Q001`. Free = 3, Basic = 10, Pro = 30. | ENFORCED | MS:249; QS:41-46. Test: `quota.int-spec.ts:40`. | |
| BR-BR-49 | What counts toward the branch limit: every non-deleted branch, ACTIVE or INACTIVE. Deleted branches do not count. | ENFORCED | QS:44 (TypeORM `count` excludes soft-deleted); `subscription/usage.ts:42` agrees. | Deactivating a branch does not free a slot; only deleting does. |
| BR-BR-50 | What counts toward the member limit: every membership row of the store, including LOCKED members and the owner. | ENFORCED | QS:45; `usage.ts:43`. | Locking a member frees no slot; only removal does. No pending-invite concept exists (invites are not built, see memory notes). |
| BR-BR-51 | Two concurrent adds at the limit cannot both succeed: a per-store, per-key transaction advisory lock (`pg_advisory_xact_lock(hashtext('quota:<tenant>:<key>'))`) serialises the count and the insert. | ENFORCED (by reading) | QS:35-37, called inside the insert transaction (BS:108-110, MS:242-249). | Not proven by a concurrent test (`quota.int-spec.ts` is sequential). `hashtext` is 32-bit: a collision between two stores only adds waiting. |
| BR-BR-52 | The plan used is the store's current subscription (statuses in `CURRENT_SUBSCRIPTION_STATUSES`), else `free`; with no plan row at all nothing is enforced. | ENFORCED | QS:54-70. | Includes expired or past-due states only if listed in `CURRENT_SUBSCRIPTION_STATUSES` (not read). Whether an expired paid plan falls back to free limits: not verified. |
| BR-BR-53 | A plan change that would leave the store over the new plan's limit (branches included) is refused (S010); a downgrade cannot strand extra branches. | ENFORCED | `admin-subscriptions.service.ts:353,385,470-475`; `usage.ts:64-76` (`used <= limit`). | The check uses the same counting as BR-BR-49, so inactive branches block a downgrade. |
| BR-BR-54 | Adding members through the admin path or a future invitation flow also passes through `assertCanAdd`. | PARTIAL | Only `MS.add` calls it. Invitations are not built. | Any new path must call it. |
| BR-BR-55 | Order of checks on branch create: code uniqueness (B001) first, then quota (Q001). | ENFORCED | BS:95 then 109. | A store at its limit with a duplicate code sees B001, not Q001. Harmless. |

### 2.7 Suspended / locked store

| ID | Rule | Status | Evidence | Notes |
|---|---|---|---|---|
| BR-BR-56 | Suspending a store sets its status, records reason and time, emits a status-changed event, then revokes every session of the store; its members cannot sign in, refresh or switch into it. | ENFORCED | `admin-tenants.service.ts:371-398`; sign-in/refresh use `findActiveMemberships` with `tenant.status = ACTIVE` (`membership.service.ts:60-69`, `auth.service.ts:128,165,361`). Test: `membership.service.spec.ts:99`. | Revocation happens after the commit (Redis), so a crash in between leaves live tokens until expiry (1 day). |
| BR-BR-57 | A suspended store's branches stay `active` in their own table and in every projection; no branch event is emitted. | ENFORCED (as behaviour) | `suspend()` touches only the tenant row. | Blocking relies on token denial only. Whether sales/inventory/integration also look at tenant status (API keys, webhooks, scheduled jobs): not verified. |
| BR-BR-58 | Reactivating a store does not restore sessions; members must sign in again. Reactivation emits status-changed. | ENFORCED | `admin-tenants.service.ts:400-430`. | |
| BR-BR-59 | A suspended store keeps counting its branches and members for usage and reports. | ENFORCED | `usage.ts:42-47` filters only `t.deleted_at IS NULL`. | |

## 3. Scenarios walked through the code

1. **Deactivate the last active branch.** PATCH `{status:"inactive"}` on the only active branch: `isBranchDeactivating` true (BS:130), transaction locks the tenant row, counts 1 active, `assertNotLastActiveBranch(1)` throws, mapped to 400 `B002`, nothing saved, no event (BS:138-148, 237-247). With a second branch already inactive it is still B002.
2. **Delete the last active branch.** DELETE: status active, same lock and count, 400 `B002`.
3. **Delete an active branch while another is active.** Succeeds immediately, 204 (BS:167-177); soft delete, `branch.updated` with `status:"deleted"`. The contract's B004 ("must be inactive first") is never raised. Sales and inventory then refuse new work for it (BR-BR-32), but nothing checks the branch's stock, open shifts, orders or schedules. The stock stays in inventory under a branch that can no longer be addressed by platform (404).
4. **Delete a branch that has stock.** Same as 3: allowed. Platform has no query to inventory. Result: orphaned stock lines; inventory only learns through the projection.
5. **Two concurrent branch creates at the plan limit** (Basic: 1 branch used, limit 2, two requests with different codes). Both pass `assertCodeFree`, both open a transaction; the first takes the advisory lock `quota:<tenant>:branches`, counts 1, inserts; the second blocks on the lock until commit, then counts 2 (the lock call precedes the count, new statement snapshot) and gets 409 `Q001` (QS:35-46). Correct by reading; no concurrency test exists. Two requests with the same code: one gets B001 via the unique index (BS:254-258).
6. **Member assigned to a deleted branch.** Rows in `account_tenant_branch` stay (no cascade on soft delete). Next login/refresh the token holds the dead id (not `*`). The member can sign in; `GET /branches` returns an empty list (`branch.id IN (dead)` matches nothing), `GET /branches/{dead}` is 404, context shows `branchCount 0`. Until the member's token refreshes (up to 1 day) the old token holds the same ids. Only an owner PATCH `branchIds: []` or a reassignment fixes it. If the member had 2 branches and one was deleted, they keep the other.
7. **Owner with no branch rows.** Owner always maps to `['*']` regardless of rows (`membership.service.ts:104`). Sees all branches, can create, edit, delete. Also true for a non-owner with zero rows (fail-open).
8. **Rename a branch code.** PATCH `{code:"CN02"}`: checked for uniqueness among live branches (B001 if taken), saved, `branch.updated` carries the new code to sales/inventory projections. No restriction when the branch has history; contract does not list `code` as patchable. Renaming to a deleted branch's old code works (the deleted row is outside the unique index).
9. **Plan downgrade below the current branch count** (Pro with 4 branches to Basic, limit 2). The admin dry run and the actual change are refused with S010 (`admin-subscriptions.service.ts:385,470-475`). To downgrade, the owner must delete (not just deactivate) branches down to 2, because inactive branches count. If a store somehow is over limit (e.g. expiry fallback to `free` by `currentPlan`, not verified), existing branches stay; only new adds are refused (`used + 1 <= limit` false).
10. **Suspended store.** Admin suspends: tenant status `suspended`, sessions of the store revoked after commit. Members' next login or refresh omits that store (`findActive*` returns nothing), switch-tenant fails. Branches remain `active` in every projection, no branch event. A request using an access token issued before the suspension is rejected because its session id is on the Redis deny list; the store data is otherwise untouched. On reactivation members must sign in again.
11. **Deactivate a branch with staff assigned.** Allowed after the last-branch check. Members keep the inactive branch id in their token (assertBranches/membership do not look at status); they can read it (`GET /branches/{id}` returns it with status inactive), but sales/inventory refuse new orders/stock there. Context list hides it.
12. **Scoped member creates a branch.** A member with `settings.update` and `branches:[A]` creates branch B: allowed (no scope check on create), B is not added to their rows, so they cannot read it (404) until an owner assigns it. Quota is checked as normal.
13. **Reactivate an inactive branch at the plan limit.** PATCH `{status:"active"}`: no quota check, succeeds (inactive branches already counted). Event `updated` with status `active`.
14. **Create branch in a store at 1/1 (free).** 409 `Q001`, `details {key:"branches", used:1, limit:1, planCode:"free"}` (proven by `quota.int-spec.ts:30`). The free plan therefore never allows a second branch, so on free the deactivate/delete B002 case is the only branch operation that matters.
15. **Self-serve create sends `defaultBranchName`.** Ignored by validation whitelist or accepted silently, depending on the global pipe (not verified); the branch is named "Chi nhánh chính" (BR-BR-06).
16. **Delete event versus late update event.** Sales receives `updated(status:deleted, updatedAt:now)` then a delayed older `updated(status:active)`; the older one is ignored (`sourceUpdatedAt` comparison). Good. Reverse order (delete lost, delayed): row stays `active` until redelivery; outbox retries eventually fix it (outbox semantics not verified).

## 4. Defects and gaps found (ranked by business impact)

1. **Delete does not require the branch to be inactive; B004 does not exist.** BS:165-177 vs contract `01-platform.md:300`. A single DELETE kills an active branch. Fix: in `remove`, throw a new `B004` (400) when `branch.status === ACTIVE`; add the code to `error-code.constant.ts` and i18n; keep B002 for the last-branch case.
2. **No downstream guard on deactivate/delete (stock, open shifts, unfinished orders, pending transfers).** BS:121-187. Fix: either ask inventory/sales through a synchronous check (REST) before the commit, or define a business policy that deletion is allowed and the stock is orphaned, and document it. Needs the owner's decision (Q1, Q2).
3. **Member scope not cleaned when a branch is deleted or deactivated; member left with an empty scope; no event.** BS:170, MS:388-418, `platform.md:53`. Fix: on branch delete, delete the `account_tenant_branch` rows of that branch and (if a member ends with none) either block the delete or tell the owner; emit `platform.membership.branches_changed` (contract lists it, `01-platform.md:369`, not built).
4. **Branch scope takes up to 1 day to apply and is never revoked on change.** `platform.md:29`. Fix: on branch assignment change or branch delete, call `sessions.revokeAll(accountId,{tenantId})` as `lock()` does (MS:183), or shorten the access token.
5. **`platform.branch_settings.updated` event missing.** Contract `01-platform.md:317`; `branch-setting.service.ts:296-310` writes nothing to the outbox. Fix: inject `EventOutbox`, emit after save in a transaction; add the contract type.
6. **Self-serve store creation ignores `defaultBranchName` and does not emit `platform.tenant.created`.** `tenant/dto/create-tenant.req.dto.ts:27`, TS:102-110, TS:195. Fix: add the optional field to the DTO and pass it; emit `PLATFORM_TENANT_CREATED` inside `openStore` (and drop it from the admin path to avoid a double).
7. **Branch code editable and reusable after delete.** BS:127-129, `branch.entity.ts:27-30`. Fix: either forbid `code` in `UpdateBranchReqDto` as the contract implies, or forbid reuse of a deleted branch's code (drop the `WHERE deleted_at IS NULL` or check against deleted rows).
8. **Two definitions of a valid branch code.** `domain/platform-domain.ts:44` (2-32, alnum first) vs DTO regex 1-20, and `BranchCodeVO` is unused. Fix: make the DTO call the VO, or delete the VO; pick one rule.
9. **Deactivated branches and locked members keep counting toward plan limits.** QS:44-45. If the business wants "pay only for active", change the counts to `status = 'active'`; either way, say so on the upgrade message.
10. **Owner-only in the contract, permission-based in code.** `branch.controller.ts:74,101,118,150` vs contract `01-platform.md:273,290,297,316`. Fix: update the contract to "settings.update" (the RBAC doc already says so), or add an owner guard.
11. **Branch assignment accepts INACTIVE branches.** MS:396-402. Fix: filter `status = 'active'` in `assertBranches` (or document).
12. **Create is not scope-limited and does not grant the creator the new branch.** BS:91-119. Fix: restrict create to unscoped members, or add the new branch to the creator's rows.
13. **Delete records no `deletedBy`; PATCH has no optimistic lock (lost update on concurrent edits).** BS:170,181 (`softDelete`), BS:126-136 (read, mutate, save whole entity). Fix: `update({deletedBy})` before soft delete; add a version column or re-read inside the transaction.
14. **No test for Q001 in `BranchService`/`MemberService` unit specs and no concurrent-quota test.** `branch.service.spec.ts:131`, `quota.int-spec.ts:30-60`. Fix: add an integration test with two parallel `Promise.all` creates at limit - 1.
15. **Suspension depends only on session denial; downstream services' own tenant status checks are not verified.** `admin-tenants.service.ts:398`. Fix: confirm each service (sales, inventory, integration webhooks, scheduled jobs) rejects a suspended tenant, or have them consume `platform.tenant.status_changed`.
16. **No cap on stores per account.** TS:81-119. Fix: decide a limit (Q10).

## 5. Open questions for the business owner

1. Can an ACTIVE branch be deleted in one step? Recommended default: no; it must be deactivated first (contract B004).
2. May a branch with stock on hand be deactivated or deleted? Recommended default: deactivate yes (stock stays visible read-only), delete no while any stock is greater than 0.
3. May a branch with an open register shift or an unfinished order be deactivated? Recommended default: no.
4. Should deleting a branch also remove it from every member's branch list? Recommended default: yes, and block the delete if it would leave a member with no branch.
5. When a member loses a branch (or the branch is deleted), must access end immediately rather than within 24 h? Recommended default: yes, revoke their sessions.
6. Should deactivated branches count toward the plan's branch limit? Recommended default: yes (as today), only deleted ones free a slot.
7. Should locked members count toward the member limit? Recommended default: no (they cannot work), i.e. count only ACTIVE members.
8. Can a branch code be renamed after creation? Recommended default: no, name is editable, code is fixed.
9. May a deleted branch's code be reused by a new branch? Recommended default: no.
10. Is the number of stores one account may create limited? Recommended default: yes, 3 per account (or number the business names).
11. Can a member who sees only branch A create new branches? Recommended default: no, only members with all branches (or owners).
12. When a store is suspended, must its branches be projected as inactive so POS and inventory stop even for API-key or background flows? Recommended default: yes.
13. Should a new branch be added automatically to the creator's branch list when the creator is scoped? Recommended default: yes.
14. Is a one-character branch code, or one starting with `_` / `-`, acceptable? Recommended default: no, 2-20 chars, starts with a letter or digit.
15. Must two branches of the same store have different invoice prefixes? Recommended default: yes.
16. After a downgrade where inactive branches exceed the new plan, may the owner keep the inactive ones? Recommended default: no, the limit counts them (current behaviour), and the error names how many to delete.
17. Does changing `isWarehouse` on a branch that holds stock need a block or a warning? Recommended default: warning only, and state what the flag controls.
