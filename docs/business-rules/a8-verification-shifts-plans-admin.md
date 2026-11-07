# Verifier B: work shifts (report 4) and plans/limits/admin (report 5)

Method: re-read the code on branch docs/contracts-admin-status. Paths relative to /home/truong/Code/PBL6/pbl-api. Read-only. No tests run.
Verdicts: VERIFIED / PARTLY / WRONG / CANNOT-TELL.

## 1A. Report 4 (work shifts): defects section

| # | Claim | Verdict | Evidence | Severity |
|---|---|---|---|---|
| 1a | Checkout does not compare shift.staff_id to caller | VERIFIED | apps/sales/src/modules/checkout/checkout.service.ts:1767-1769 `SELECT status, branch_id FROM pos_shifts WHERE tenant_id = $1 AND id = $2`; in-tx recheck :279-281 `SELECT status ... FOR SHARE`. staff_id never read. | CRITICAL (cash in a colleague's drawer, variance blamed on the wrong person) |
| 1b | shiftId optional, a POS sale with no shift succeeds, cash lands in no drawer | VERIFIED | checkout.dto.ts:65 `shiftId?: string`; checkout.service.ts:277 `if (dto.shiftId)`, :1600 `if (wf.shiftId && tenderSummary.totalCashSales > 0)`; :100/:328 `dto.shiftId ?? null` | CRITICAL (cash with no drawer) |
| 2 | S022 (open drafts block shift close) not implemented | VERIFIED | `grep -rn S022 apps libs` returns nothing in code; closeShift (shifts.service.ts:~252-340) reads only pos_shifts and checkout_workflow; no "draft" token in shifts.service.ts. pos.service.ts:293 stores `shiftId: dto.shiftId ?? null` on drafts. | MAJOR (recoverable: draft then fails 409 SHIFT_NOT_OPEN or is re-sent with no shift, see 1b) |
| 3 | Cash refund updates a closed shift | VERIFIED | returns.service.ts:583 `const shiftId = dto.shiftId ?? ret.shiftId ?? order.shiftId ?? null;` and :640-647 `UPDATE pos_shifts SET cash_refunds_total = ..., expected_cash = expected_cash - $3 WHERE tenant_id = $1 AND id = $2` (no status filter). Closed shift's stored variance is not recomputed. | CRITICAL (closed books change, today's drawer short) |
| 3+ | (analyst understated) | see Missed #1: dto.shiftId is client-chosen and never validated | |
| 4 | Unique index on open shifts includes staff_id, so two cashiers can share a register code | VERIFIED | migrations/1791900000200-*.ts:275-277 `UQ_pos_shifts_active_staff_register ON (tenant_id, branch_id, staff_id, register_code) WHERE status='OPEN'`; no later migration touches it (grep). Service check shifts.service.ts:~140-163 also includes `staff_id = $3`. The register-wide check (`register_id = $2 AND status='OPEN'`) runs only when dto.registerId is given. | MAJOR (two drawers on one register; reports ambiguous) |
| 5 | Net sales / commission base absent | CANNOT-TELL on code detail; plausible (staff-sales groups by created_by on COMPLETED orders, returns keep COMPLETED per returns.service.ts:~627) | not re-opened in depth | MAJOR if commission is paid on it |
| 6 | No link schedule to POS shift | VERIFIED | openShift has no platform/schedule call; design gap, not a bug | MINOR/design |
| 7 | Shift stays open after employee removal / end of day | VERIFIED | member.service.ts:~205-222 deletes schedules and membership only; no sales event consumer; no scheduler in apps/sales (grep @Cron/setInterval hits only inventory and integration) | MAJOR |
| 8 | Finance posts variance with the opener as actor | VERIFIED | finance reconciliation.service.ts:884 `payload.staffId ?? 'event:sales.shift.closed'`; sales payload carries closedBy in the row (shifts.service.ts:52,479) but event uses staffId | MINOR (audit attribution) |
| 9 | Schedule not checked against member branches | PARTLY | assertMember (staff-schedule.service.ts:~233-239) checks only account_tenant membership, no branch list: true. Real impact small: it is a plan, not a permission. | MINOR |
| 10 | Overlap race on create | PARTLY | comment exists; no exclusion constraint. Admin-driven low rate. | MINOR |
| 11 | Overnight shifts impossible | VERIFIED | staff-schedule.service.ts:~240-246 `toMinutes(start) >= toMinutes(end)` throws V000 | MINOR (business, bars/night shops: major) |
| 12 | Locked member remains in on-duty | VERIFIED | member.service.ts setStatus (~457-466) only updates status; schedule rows remain | MINOR |
| 13-15 | note-only items | not re-checked | | MINOR |

## 1B. Report 4: ENFORCED rules that matter

| Rule | Verdict | Evidence | Note |
|---|---|---|---|
| BR-SH-19 one OPEN shift per registerId | VERIFIED | shifts.service.ts:~118-139 `FOR UPDATE` register row, then `register_id = $2 AND status = 'OPEN'` | only by registerId |
| BR-SH-21 per staff+register code | VERIFIED | same file, advisory lock + index 275 | |
| BR-SH-23 close computes expected/variance server-side | VERIFIED | shifts.service.ts closeShift `calculateShiftCloseSummary({openingCash, cashSalesTotal, cashRefundsTotal, actualCash})` then UPDATE writes expected_cash, variance, closed_by | |
| BR-SH-24 already closed -> 409 | VERIFIED | `if (shift.status === 'CLOSED') throw SHIFT_ALREADY_CLOSED` after `FOR UPDATE` | |
| BR-SH-25 pending checkout blocks close | VERIFIED | `checkout_workflow ... state IN (...)` | |
| BR-SH-27 sale only on OPEN shift of same branch | VERIFIED (when sent) | checkout.service.ts:1775-1790 and :277-290 | close races safe: sale holds FOR SHARE, close holds FOR UPDATE |
| BR-SH-32 cash sale adds to expected | VERIFIED | checkout.service.ts:1599-1608 | |
| BR-SH-33 later payments count only if shift OPEN | VERIFIED | order-actions.service.ts:~433-448 `status = 'OPEN'`, tender gets shift_id NULL otherwise | but cash taken after close is in no shift: MAJOR |
| BR-SH-34 refund rewrites closed shift; two refund routes disagree | VERIFIED | returns route has no status filter, order-actions route requires OPEN (same lines) | |
| BR-SH-35 finance one reconciliation per shift | CANNOT-TELL (not re-read); advisory lock/idempotency claims plausible | | |
| BR-SH-40 draft ownership | not re-read | | |
| BR-SH-05..13 platform schedule rules | VERIFIED at spot-check (assertMember/overlap/ordered/remove deletes schedules) | staff-schedule.service.ts:~233-262, member.service.ts:~205-222 | line numbers in report are +/- 10 |

## 2A. Report 5 (plans, limits, admin): defects section

| # | Claim | Verdict | Evidence | Severity |
|---|---|---|---|---|
| D-01 | Storage counts only UPLOADED; ATTACHED images stop counting | VERIFIED | apps/catalog/src/quota/plan-quota.service.ts storageBytesUsed `.andWhere(\`u.status = 'UPLOADED'\`)`; products.service.ts:286-288 `row.status = 'ATTACHED'` (images must be UPLOADED first, :280-282); imports.service.ts:89 `upload.status = 'ATTACHED'`. announceUsage (:57-63) uses the same function so platform usage is also understated. | CRITICAL for plan limit bypass (storage limit is effectively unenforced; revenue leak) |
| D-02 | Paid expiry never enforced, no scheduler sets expired/past_due | VERIFIED | grep of EXPIRED/PAST_DUE in apps/platform/src shows only enum definitions and SQL filters (admin-subscriptions.service.ts:53,158-159; admin-plans:45; admin-tenants:141,223); @Cron/setInterval/SchedulerRegistry appear only in apps/integration sync-job-worker and apps/inventory reservation-expiry.job.ts. quota.service.ts currentPlan treats expired-by-date rows as current (status only). | CRITICAL (a paid plan never lapses) |
| D-03 | Catalog fails open for stores with no tenant_plan_quota row | VERIFIED (code), impact PARTLY | plan-quota.service.ts `const quota = await this.lockAndLoad(...); if (!quota) return;` in both assertCanAddProducts and assertCanStore. Migration 1792700000000:117-121 inserts a free subscription per existing tenant with no outbox event; catalog migration 1792800000000 creates an empty table; handler onPlanChanged drops events with no row (plan-quota.handler.ts:~58-62). New stores are fine: subscription-core.service.ts:127-146 emits `created` with quotas. Residual window: between store creation and event delivery (async) a new store is unlimited. | MAJOR if any production store pre-dates the migration, else minor |
| D-04 | Payment recordable on any subscription incl. free/closed | VERIFIED | admin-subscriptions.service.ts recordPayment calls lockSubscription (:447-454, find by id only), then `if (!sub.expiresAt \|\| newExpiry > sub.expiresAt) { sub.expiresAt = newExpiry; sub.status = SubscriptionStatus.ACTIVE; ...}`. No status or plan price check. Reopening a cancelled/expired row to active while a current row exists would hit UQ_subscription_current_tenant (entity :37-40) -> unhandled DB error (likely 500, not tested by me). Admin-only action. | MAJOR (data integrity, admin-only) |
| D-05 | Suspension only blocks user tokens | PARTLY | Only audit consumes the event (analyst); I did not re-grep every service. Deny-list is checked by every service: libs/auth/src/access-token.verifier.ts:38-39 `isSessionRevoked`, wired in pbl-auth.module.ts:101 only when REDIS_HOST is set. Report said "not verified"; now confirmed, with the REDIS_HOST caveat. | MAJOR |
| D-06 | Demoting a super_admin keeps powers until access token expires | VERIFIED | libs/auth/src/auth.guard.ts:~67-76 checks `user.roles` from the token; admin-admins.service.ts update: `disabled` computed only from status, `if (result.disabled) await this.sessions.revokeAllOfAdmin(id)`; `demoted` is not used for revocation. Refresh rebuilds from DB (per analyst; I did not re-read platform-admin-auth.service.ts:120). | MAJOR (window = access token lifetime, value of auth.expires not read) |
| D-07 | Trial is dead | VERIFIED | grep: TRIALING referenced only in enum and filters; start() sets ACTIVE (subscription-core.service.ts:~97) | MINOR |
| D-08 | Settings stored not applied | CANNOT-TELL (not re-read); plausible | | MINOR |
| D-09 | changePlan race, expiresAt mandatory | CANNOT-TELL | | MINOR |
| D-10 | free detection by priceMonthly === 0 | VERIFIED | subscription-core.service.ts:~83 `plan.priceMonthly === 0 ? null : ...` | MINOR |
| D-11 | free-form payment amounts | VERIFIED | recordPayment stores dto.amount unchecked | MINOR (but see Missed #6) |
| D-12..14 | no password reset, hard-coded Q001 text, outbox fan-out | not re-checked; plausible | | MINOR |

## 2B. Report 5: ENFORCED / suspicious rules

| Rule | Verdict | Evidence / correction |
|---|---|---|
| BR-PL-02 branch limit | VERIFIED, LINE NUMBERS WRONG | Real code: apps/platform/src/api/subscription/quota.service.ts:29-52 (file is 71 lines, report cites 138-179 which do not exist). `em.count(BranchEntity, {where:{tenantId}})` honours deleted_at (branch.entity.ts:69 DeleteDateColumn). branch.service.ts:109 calls it. |
| BR-PL-03 member limit | VERIFIED | member.service.ts:249; `em.count(AccountTenantEntity)` counts locked members and owner. Only two insert sites for account_tenant: member.service.ts:253 and tenant.service.ts:158. |
| BR-PL-04 product limit | VERIFIED | products.service.ts:575 `await this.quota.assertCanAddProducts(em)` inside createProduct; productsUsed excludes ARCHIVED and soft-deleted. |
| BR-PL-08 advisory lock | VERIFIED | plan-quota.service.ts lockAndLoad `pg_advisory_xact_lock(hashtext('quota:<tenant>:<key>'))` |
| BR-PL-09 ARCHIVED irreversible | VERIFIED | catalog-domain.ts:497-505. Note: this is a plan-limit side effect (archive frees a slot forever). |
| BR-PL-10 free fallback / no plan row = no enforcement | VERIFIED | quota.service.ts:40 `if (!plan) return;`, currentPlan falls back to free |
| BR-PL-17 expiry not enforced | VERIFIED | see D-02. Status is MISSING as the report says. |
| BR-PL-20 payment on any row | VERIFIED | see D-04 |
| BR-PL-24 role split | VERIFIED, and the guard WAS checked by me: libs/auth/src/auth.guard.ts:60-76 `adminRoles = getAllAndOverride(REQUIRED_PLATFORM_ADMIN)`; admin token only on @RequirePlatformAdmin routes (else 403); with roles given, `adminRoles.some(role => user.roles.includes(role))` else 403. Method-level decorator overrides class-level (getAllAndOverride). `@RequirePlatformAdmin('super_admin')` confirmed on: admin-plans.controller.ts:46,59; admin-admins.controller.ts:35,48; admin-settings.controller.ts:24. Everything else is class-level (any admin). Not read by analyst: now resolved. |
| BR-PL-30 admin/store token separation | VERIFIED | same guard lines (`!isAdminToken \|\| adminRoles === undefined` -> 403) |
| BR-PL-33 last super admin | VERIFIED | admin-admins.service.ts update: advisory lock, A011 on self demote/disable and when `otherActiveSuperAdmins` is 0 |
| BR-PL-39 free store cannot add a 2nd branch | VERIFIED (with defaults) | quota used+1 <= limit with free quotaBranches=1 (plan editable by super admin, so "never" = "while free limit is 1"). tenant.service.ts:172 creates CN01. |
| BR-PL-26/27 suspension revokes sessions | partially re-read; deny-list reader confirmed above | |
| BR-PL-12, 14, 19, 21, 22, 23, 25, 28, 31, 32, 34, 36-38 | CANNOT-TELL (not re-read) | plausible; none is money-critical except 19/21/22 already covered |

## 3. Missed by the analysts

1. **Refund shiftId is client-supplied and unvalidated (CRITICAL).** returns.service.ts:583 `dto.shiftId ?? ret.shiftId ?? order.shiftId`; returns.dto.ts:46,91 `shiftId?: string` (no checks on branch, status, owner). Cash refund UPDATE (:640-647) debits whatever shift id is passed: any shift in the tenant (any branch, open or closed, another cashier's). Permission needed is only orders.approve / orders.create (returns.controller.ts:40,86,98), not pos.*. A refund can also be taken with no open shift at all. Lets a user move a drawer shortage onto a colleague.
2. **Draft refund/payment shift id and checkout recheck omit staff and branch scope (minor)**: in-tx recheck (checkout.service.ts:277-281) selects only status; branch is checked only in pre-flight at :1780 (race-free in practice since branch cannot change).
3. **Platform quota counts are not scope-wide for imports/other product insert paths**: only products.service.ts:575 calls assertCanAddProducts; imports go via createProduct (analyst said so, OK). Variants/price lists unlimited by design: a free store gets unlimited SKUs inside 100 products (product-limit semantics worth stating to the owner). MINOR.
4. **Existing stores are all migrated to `free` (migration 1792700000000:117-121)** regardless of what they actually pay. Together with no expiry job and no catalog row, every pre-existing store is "free on platform, unlimited on catalog". Report 5 mentioned the missing event but not that the migration assigns everyone to free. MAJOR for a production rollout.
5. **Deny-list works only if REDIS_HOST is configured** (pbl-auth.module.ts:~101 conditional). Without it, suspension and disable/logout do not cut live access tokens in downstream services. Both analysts treated it as unverified. MAJOR config risk.
6. **Quota check on storage runs before the file is accepted but usage is announced from the same leaky figure** (plan-quota.service.ts:57-63), so S010 (downgrade check) also under-counts storage: a store with 9 GB attached can be downgraded to a 1 GB plan. Covered only in passing under BR-PL-22.
7. **Cash taken after the shift closed has shift_id NULL** (order-actions.service.ts:433-448): analyst noted it, but it also means finance never sees that cash in any reconciliation. MAJOR (rated only a note).
8. **Close-shift variance has no tolerance, reason or approver and any pos.update holder in branch scope can close another's shift** (shifts.controller.ts:56 `pos.update`; screen route requires pos.create + pos.update :55). Analyst covered as BR-SH-30; severity should be MAJOR, not note.
9. Platform admin: `recordPayment` also accepts a period fully in the past or any amount, and sets status ACTIVE regardless of previous status (admin-subscriptions.service.ts recordPayment block). Part of D-04/D-11; no extra defect.

## 4. Reports' errors and corrections

Report 4:
- BR-SH-26 marked CONTRADICTED: correct in substance. Docs claim S022; the code does not. VERIFIED.
- Scenario 8 says a draft checked out after close with the old shift id gives 409 SHIFT_NOT_OPEN: correct (checkout.service.ts:1786-1789).
- Defect 3 fix suggestion ("take the refund from the caller's current open shift") is a business choice, not a correction; but the report missed that dto.shiftId lets the caller pick (Missed #1).
- Severity of defect 5 (net sales) ranked above defect 6/7; for a retail business rank: 1a/1b, 3, Missed #1, 4, 7, then 2.
- Line numbers in the platform schedule section are off by up to ~10 lines (assertMember at :227-236 is really ~:233-240; assertNoOverlap ~:248-262). Substance correct.
- BR-SH-17/39 "MISSING" are design gaps, not defects; MINOR.

Report 5:
- Wrong line numbers for platform quota: cites quota.service.ts:138-161 and :164-179, file has only 71 lines; real: assertCanAdd 29-52, currentPlan ~55-71. Substance correct.
- BR-PL-24: "guard internals not read" -> now read and confirmed (see 2B).
- BR-PL-29/D-05 "not verified deny-list enforcement" -> enforced downstream via libs/auth access-token.verifier.ts:38 but only when REDIS_HOST is set.
- D-04 impact "likely a 500; not verified": still unverified here; the unique index exists (subscription.entity.ts:37-40) so a DB error is plausible.
- D-02/D-01 severity "High" is right; for money/limit bypass I rate both CRITICAL.
- D-03 "High": downgrade to MAJOR unless production stores pre-date the migration (then critical for those stores).
- BR-PL-39 "can never add a second branch": true only while free.quotaBranches = 1; super admin can edit the plan.
- No ENFORCED claim I opened was false. Claims I could not re-open: BR-PL-12,14,19,21-23,25,28,31-32,34,36-38, D-08, D-09, D-12-14.

## 5. Counts
Report 4 defects (15): VERIFIED 9 (1,2,3,4,6,7,8,11,12), PARTLY 3 (9,10 and 13-15 as notes), CANNOT-TELL 1 (5), WRONG 0.
Report 5 defects (14): VERIFIED 8 (D-01,02,03,04,06,07,10,11), PARTLY 1 (D-05), CANNOT-TELL 5 (D-08,09,12,13,14), WRONG 0 (only wrong line numbers on BR-PL-02/10 and the D-05 "not verified" item).
