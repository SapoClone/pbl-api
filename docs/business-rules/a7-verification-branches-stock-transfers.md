# Verification A: reports 1 (branches/tenancy), 2 (warehouses/stock), 3 (transfers/sales stock)

Method: re-read the code on branch docs/contracts-admin-status (read-only, no tests run). Paths relative to /home/truong/Code/PBL6/pbl-api. Verdicts: V = VERIFIED, P = PARTLY, W = WRONG, CT = CANNOT-TELL.
Severity scale: C = critical (data loss / money / cross-branch leak), M = major (wrong but recoverable), m = minor.

## 1. Report 1 (branches and tenancy)

| Item | Claim | Verdict | Evidence | Severity |
|---|---|---|---|---|
| D1 | DELETE of an ACTIVE branch succeeds in one step; B004 does not exist | V | `apps/platform/src/api/branch/branch.service.ts:165-178` `remove()`: `if (branch.status === ACTIVE) { assertNotLastActive; softDelete }`; `constants/error-code.constant.ts:55-56` only B001, B002; contract `01-platform.md:300` lists B004 | M (soft delete, recoverable by DB; but see missed #1: default roles make it owner-only) |
| D2 | No guard on stock/open shifts/orders/transfers when deactivating/deleting | V | `branch.service.ts:121-187` has no cross-service call; only outbox event | C when combined with stock (stock stranded under a branch nobody can address); M if policy decides orphaning is acceptable |
| D3 | Member scope rows not cleaned on branch delete; scoped member left with dead ids | V | `branch.service.ts:170,180` `softDelete` only; `membership.service.ts:103-106` `assigned.length===0 ? ['*'] : assigned` so dead ids stay in token | M |
| D4 | Scope change applies only at next refresh, never revoked | V | `member.service.ts:183,221` revoke only on lock/remove; `replaceBranches` (member.service.ts:~408) does not | M |
| D5 | `platform.branch_settings.updated` event missing | V | grep of `libs/contracts/src` finds no `branch_settings` | m |
| D6 | Self-serve create ignores `defaultBranchName`, no `platform.tenant.created` | V | `tenant.service.ts:102-110` call omits it; DTO `create-tenant.req.dto.ts` has no field; `PLATFORM_TENANT_CREATED` only at `admin-tenants.service.ts:308` | m |
| D7 | Branch code editable and reusable after delete | V | `branch.service.ts:127-129`; unique index `branch.entity.ts:27-30` `WHERE "deleted_at" IS NULL` | M (invoices/reports that print code become ambiguous) |
| D8 | Two code definitions, `BranchCodeVO` unused | CT | I did not re-grep VO usage; DTO regex claim not re-opened | m |
| D9 | Inactive branches and locked members count toward limits | V | `quota.service.ts:44-45` `em.count(BranchEntity,{where:{tenantId}})` / `em.count(AccountTenantEntity,...)` no status filter | m (business choice) |
| D10 | Contract says owner, code uses permission | P | `branch.controller.ts:74,101,118,150` `@RequirePermission('settings.update')` is true, BUT `libs/contracts/src/permissions.ts:111-116` `NOT_FOR_MANAGER` includes `settings.update`, so seeded `branch_manager` lacks it: by default only owner can create/edit/delete branches | m |
| D11 | Branch assignment accepts INACTIVE branches | V | `member.service.ts:388-403` `em.count(BranchEntity,{where:{tenantId,id:In(unique)}})`, no status filter | m |
| D12 | Create not scope-limited, creator not granted new branch | V | `branch.controller.ts:74-83` no `assertInScope`/allowed check; `branch.service.ts:91-119` touches no account_tenant_branch | m (needs custom role with settings.update) |
| D13 | No `deletedBy`; PATCH lost update | V | `branch.service.ts:170,180` `softDelete({id})`; `:126-136` read, mutate whole entity outside transaction, `save` | m |
| D14 | No Q001 unit test / concurrent quota test | CT | not opened | m |
| D15 | Suspension relies on session denial only | V | `admin-tenants.service.ts:371-398` touches tenant row then `sessions.revokeAllOfTenant` after commit; branches untouched | M (revocation after commit; crash leaves tokens live until expiry) |
| D16 | No cap on stores per account | V | `tenant.service.ts:81-119` no count | m |

Rules marked ENFORCED that I re-checked and CONFIRM: BR-BR-03 (single transaction `tenant.service.ts:101` plus outbox in same `em`, lines 195-207), BR-BR-16 (B001 + unique-violation mapping `branch.service.ts:218-222,254-260`), BR-BR-20/21 (tenant row `for_no_key_update` then count, `:225-248`), BR-BR-30 (outbox inside the transaction), BR-BR-42 (`branch.controller.ts:163-167` 404 for out-of-scope; list `1 = 0` for empty scope, `branch.service.ts:51-56`), BR-BR-47/51 (advisory lock before count, `quota.service.ts:35-46`), BR-BR-49 (soft-deleted rows excluded by TypeORM count; `@DeleteDateColumn` at `branch.entity.ts:69`), BR-BR-56 (`membership.service.ts:60-69` filters `tenant.status ACTIVE` and member ACTIVE; `auth.service.ts:361-368` refresh ends session), BR-BR-38 and BR-BR-41 (`membership.service.ts:103-106`).
Resolved unknown: BR-BR-52 "expired plan" - `CURRENT_SUBSCRIPTION_STATUSES` is only TRIALING, ACTIVE, PAST_DUE (`subscription.entity.ts:23-27`), so an expired/cancelled paid subscription silently falls back to `free` limits (1 branch, 3 members): existing extra branches stay, new adds are refused.

## 2. Report 2 (warehouses and stock)

| Item | Claim | Verdict | Evidence | Severity |
|---|---|---|---|---|
| D-01 / BR-WH-03 | POST /warehouses is an upsert; duplicate code overwrites name, branch, kind, default; WAREHOUSE_CODE_CONFLICT never thrown; branch-scoped takeover | V | `apps/inventory/src/modules/warehouses/warehouses.service.ts:111-123` `INSERT ... ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, branch_id = COALESCE(EXCLUDED.branch_id, ...branch_id), kind = EXCLUDED.kind, ... is_default = EXCLUDED.is_default`; controller `warehouses.controller.ts:~51` only `assertBranch(branches, dto.branchId)` | C (cross-branch takeover moves a warehouse WITH its stock and open documents between branches; bypasses the deactivation preconditions and the stock-view branch totals) |
| D-02 / BR-WH-43 | PO receive bumps `received_qty` before the idempotency lookup | V | `procurement.service.ts:~497-512` UPDATE `purchase_order_item SET received_qty = prev + receiveNow`, then `:~525` `createReceiptInTx(..., idempotencyKey)`; `receiving.service.ts:55-72` returns the old receipt when the key exists | C/M (PO says received, shelf did not move; supplier-payable and over-receipt control wrong; recoverable only by hand) |
| D-03 / S6 | Concurrent first receipts of a new (warehouse, SKU) lose quantity (absolute `on_hand_qty = $5` on conflict) | V | `receiving.service.ts:~337-345` `ON CONFLICT ... DO UPDATE SET on_hand_qty = $5::numeric(18,3)`; the preceding `SELECT ... FOR UPDATE` locks nothing when no row exists. Same pattern in stocktake `stocktake.service.ts:~432-440` | C (stock lost silently while the ledger shows both rows); narrow window (first receipt of a SKU) |
| D-04 | `POST /stock-balances/receipts` and legacy branch receive add stock with no document/approval/cost | V (P on detail) | `stock.service.ts:220-303` inserts/adds with no avg_unit_cost, no warehouse-active or SKU check; `stock.controller.ts:~125-143` only `inventory.create` (default `warehouse_staff` has it, `permissions.ts:~145`); legacy `stock.service.ts:~76-113` same | C (inventory inflation without trace/approval; avg cost dilution) |
| D-05 / BR-WH-48 | No check that the reserved warehouse belongs to the order's branch | V | `reservations.service.ts:~596` only `assertActiveWarehouse`; grep of the warehouse reserve path shows no `branch`; sales `checkout.service.ts:99,312` passes `dto.warehouseId`; branch check only at `:1744-1775` | C (cross-branch/central/quarantine stock can be sold) |
| D-06 / BR-WH-51 | below_min emitted only on threshold edit | V | `stock-views.service.ts:557-571` is the only `INVENTORY_STOCK_BELOW_MIN` emitter (grep) | M |
| D-07 / BR-WH-07 | Branch deactivation/deletion has no effect on warehouses | V | handler only upserts projection; `warehouses.service.ts:80-97` is the only status reader | M |
| D-08 / BR-WH-18 | QUARANTINE/CENTRAL warehouse with branch_id counts in branch view | V | `stock-views.service.ts:~118-125` filters `w.branch_id IS NOT NULL`, no kind; DTO allows any kind + branchId | M |
| D-09 / BR-WH-30 | Receipt create route ignores Idempotency-Key; retried autoPost doubles stock | V | `stock.controller.ts:~85-92` `this.receiving.createReceipt(dto)` with no key; `receiveReturnedStock` (`sales/src/inventory/inventory.client.ts:~270-290`) sends none either | C (double stock on retry; includes return restock) |
| D-10 / BR-WH-24 | Ledger immutability not enforced | V | no trigger/REVOKE in `apps/inventory/src/migrations/*` (grep); only `enableTenantRlsPolicy` | M |
| D-11 / BR-WH-39 | `freeze_movement` ignored; stale check on `version` | V | grep: `freeze_movement` only in insert/select `stocktake.service.ts:55,615` and entity; version bumped by reserve `reservations.service.ts:693` | M |
| D-12 / BR-WH-08 | No DB guarantee of one default per branch | V | `1791900000100:26` plain boolean, no partial unique index (grep) | m |
| D-13 / BR-WH-05 | Unknown branch uuid accepted; update never validates branch | V | `warehouses.service.ts:90` `branchRows.length > 0 &&`; `update()` `:~264` no check | m |
| D-14 | No maker-checker | V | no `created_by <>` check anywhere | m (policy) |
| D-15 | Transfer discrepancy leaves no ledger row | V | `transfers.service.ts:~612-640`: ledger insert only inside `if (receiveNowMilli > 0n)`; discrepancy only decrements `in_transit_qty` | M (value vanishes unrecorded) |
| D-16 | Two stock models differ | V | stock.service.ts legacy vs warehouse tables | m |
| BR-WH-14/15 | Hold all-or-nothing, guarded UPDATE | V | `reservations.service.ts:605-651` FOR UPDATE check, `:683-700` UPDATE with `(on_hand_qty - reserved_qty) >= qty` | n/a |
| BR-WH-09 | Deactivate needs zero stock/holds/transfers | V | `warehouses.service.ts:253-262` calls `assertCanDeactivateWarehouse` | n/a (but see missed #5: PATCH can move warehouse with stock) |
| BR-WH-29 | Receipt post locked FOR UPDATE, idempotent | V | `receiving.service.ts:215-244` | n/a |
| BR-WH-34 | Issue needs available >= qty for all lines | V (not re-opened in full; consistent with the same pattern) | issuing.service guarded UPDATE as cited | n/a |

Wrong detail in report 2: BR-WH-12 note says a probing member can tell "exists elsewhere" from "does not exist" by body - plausible and not tested; harmless claim, left as CT. BR-WH-44 says "Destination warehouse is not scope-checked on create": confirmed (`transfers.controller.ts:~54` checks only `fromWarehouseId`).

## 3. Report 3 (transfers, sale stock, returns)

| Item | Claim | Verdict | Evidence | Severity |
|---|---|---|---|---|
| D-01 | `sales.order.completed` also runs legacy `stock_item` commit for warehouse-flow orders | V (P on impact) | `order-completed.handler.ts:15-19` -> `reservations.service.ts:301-378`; no `stock_reservation` row for warehouse flows so `held=false`, reads `stock_item.free`; if no legacy row: writes a zero `sale_shortfall` ledger row and `take===0 continue` (no deduction); if a legacy row for same branch+SKU code exists it IS deducted (real double deduction on the legacy table) | M (ledger noise; double deduction only where legacy stock coexists) |
| D-02a | Omnichannel confirm hold uses default 900 s | V | `m3-orders.service.ts:~600-612` no `ttlSeconds`; `reservations.service.ts:63,545`; sweep `reservation-expiry.job.ts:~30-36` also expires warehouse holds | C/M (confirmed order cannot be fulfilled after 15 min; sales sees 503) |
| D-02b-pos | AWAITING_PAYMENT hold expires before QR payment, checkout auto-cancelled although paid | V | `checkout.service.ts:~429-440` reserve before payment; `confirmCheckoutPayment :534-600` reuses stored reservationId; commit catch -> `cancelExpiredWorkflow` `:~939-985` sets CANCELLED and throws 409; commit itself does not compare `expires_at` (`reservations.service.ts:925-960`), so a hold is committable until the sweep runs | C (money taken, sale cancelled, no refund path in this code) |
| D-02b (report's second D-02b) | Cashier cannot restock returns | V | `permissions.ts:~120-135` `sales_staff` has no `inventory.create`/`inventory.approve`; `stock.controller.ts:~84-91` autoPost needs approve; return receive route needs only `orders.update` (`returns.controller.ts:111-112`) | M. Note two items are both labelled D-02b |
| D-03 | No branch-warehouse binding in a sale | V | same as report 2 D-05 | C |
| D-04 | Legacy `cancelCheckout` has no state guard; release failures swallowed | V | `orders/orders.service.ts:~410-440` only CANCELLED early return, then release + `state = 'CANCELLED'`; `inventory.client.ts:304-326` returns null on error/non-200 (409 swallowed) | M (completed checkout flagged CANCELLED while order and stock stay) |
| D-05 | Dispatched transfer can't be cancelled; dest inactive strands goods | V | `documents.service.ts:215-221` DRAFT only; `transfers.service.ts:394` `assertActiveWarehouse(to)` on receive | M |
| D-06 | Lost-in-transit units leave no ledger row | V | `transfers.service.ts:~612` ledger only when `receiveNowMilli > 0n`; `:~622-640` decrement in_transit only | M |
| D-07 | Fulfilment quantities never validated; partial fulfilment commits whole hold | V | `fulfillment.service.ts:~105-127` `qty: formatQtyMillis(parseQtyMillis(li.qty))` with no bound against ordered/fulfilled; `:219-224` `commitWarehouseReservation(reservationId)` for whole reservation | M |
| D-08 | RESTOCK return with no warehouse completes with no restock | V | `returns.service.ts:~386` `restockLines.length > 0 && warehouseId && !inventoryReceiptId`; then status set COMPLETED `:~407-425` | M |
| D-09 | REQUESTED return can be received without approval | V | `returns.service.ts:368-376` rejects only COMPLETED/RECEIVED/REJECTED; `approvedBy = approvedBy ?? actorId` | M (see missed #3: refund also unguarded) |
| D-10 | Returned goods valued at 0 | V | `returns.service.ts:~394-403` `unitCost: 0`; `inventory.client.ts:~280` `unitCost: item.unitCost ?? 0` | M (cost distortion; avg cost falls) |
| D-11 | 404/409 from inventory mis-mapped | V (not fully re-read) | `inventory.client.ts:~150-171`: any 409 except IDEMPOTENCY_CONFLICT becomes INSUFFICIENT_STOCK with `details` array or `[]` | M |
| D-12 | No idempotency on transfer receive / return receipt | V | transfers.service has no key; `receiveReturnedStock` sends none | M |
| D-13 | Transfer create scope-checks source only; list cap silent | V | `transfers.controller.ts:~54`; cap not re-opened | m |
| D-14 | `GREATEST(0, ...)` hides in_transit drift | V, and it is WORSE than reported: it is what masks missed #2 (stock inflation) | `transfers.service.ts:~629` | see missed #2 |
| D-15 | No scheduler for reconcile | CT | not re-opened | m |
| D-16 | `inventory-domain.spec.ts:229` uses non-existent status | V | `inventory-domain.spec.ts:229` `assertCanDispatchStockTransfer('IN_TRANSIT')` | m |
| BR-RT-01 | "order-status test is a chain of &&, refuses only when ALL fail" flagged as suspicious | W (analyst's worry is unfounded) | `returns.service.ts:~79-85` throws when COMPLETED, FULFILLED, PARTIALLY_FULFILLED and RETURNED are all false, which is exactly "allow if any holds" | n/a |
| BR-TR-07/BR-TR-06 | Dispatch all-or-nothing, header lock | V | `transfers.service.ts:100-216` `FOR UPDATE` header, balances locked in sku order, shortages thrown before any UPDATE | n/a |
| BR-SA-05 | Commit ignores `expires_at` | V | `reservations.service.ts:925-960` checks only `state` | m |

## 4. Missed by the analysts

1. **Transfer receive can be inflated by repeating a SKU in the request body (stock/money, critical).** `apps/inventory/src/modules/transfers/transfers.service.ts:~411-415` builds `itemBySku` once; the loop `for (const reqLine of incomingLines)` (`:~455`) validates each line against that stale snapshot (`dispatchedQty`, `receivedQty`), and `ReceiveStockTransferDto.items` (`transfers.dto.ts:~100-108`) has no `@ArrayUnique`. Body `[{skuId:S,receivedQty:"6"},{skuId:S,receivedQty:"6"}]` on a transfer with 6 in transit passes both over-receipt checks, adds 12 to destination `on_hand_qty` (the destination balance IS re-read per line), `in_transit_qty` is clamped by `GREATEST(0,...)` (`:~629`), and `received_qty` is written as `prevReceived + 6` (stale) so the transfer line shows 6. Result: 6 phantom units with a ledger row for each. Needs `inventory.update` plus destination scope. Fix: merge/reject duplicate skuIds, re-read line rows per iteration, drop the clamp.
2. **Branch-manager default role cannot manage branches (corrects report 1 D10/BR-BR-13).** `libs/contracts/src/permissions.ts:111-116` `NOT_FOR_MANAGER` excludes `settings.update`; branch create/edit/delete/settings-edit is effectively owner-only unless a custom role is granted it.
3. **Refund can be requested and paid in cash before the return is approved or the goods are received.** `returns.service.ts:473-640`: only `REJECTED` is refused; status REQUESTED passes; `method` defaults `CASH` and is `CONFIRMED` immediately (`:~585-601`) and updates shift `cash_refunds_total`. Needs only `orders.approve`. `dto.shiftId` is taken from the request with no branch/open check visible (CT). Severity M/C (cash out before goods back).
4. **POS `confirm-payment` marks every tender CONFIRMED on the caller's word.** `checkout.service.ts:534-575` sets `status:'CONFIRMED'`, `externalRef ?? dto.externalRef ?? 'CONFIRMED-CALLBACK'` then commits stock and finalises; route needs only `orders.update` (`checkout.controller.ts:121-122`, held by `sales_staff`). No gateway verification in this path (CT whether another layer verifies). C if no external check exists.
5. **PATCH /warehouses/:id can move a warehouse that holds stock to another branch, or detach it (`branchId: null`).** `warehouses.service.ts:~250-300` update has no stock precondition for branch change; DTO `branchId?: string | null` with `@IsOptional()` (`warehouses.dto.ts:~64-68`) accepts null; controller `warehouses.controller.ts:~96-98` only asserts scope `if (dto.branchId)`, so null skips it. A branch-scoped member can orphan their own warehouse (vanishes from branch stock views, visible to unrestricted members only). Same effect as D-01 without needing a code clash. M.
6. **Receipt/stock-balance direct receive does not verify the warehouse is ACTIVE or the SKU exists.** `stock.service.ts:220-251` goes straight to INSERT/UPSERT; only `assertWarehouse` scope (a no-op for unrestricted members). M (part of D-04).
7. **Concurrent POS return receives can double-restock.** `returns.service.ts:~379-404` calls inventory BEFORE taking the row lock (lock at `:~407-420`); the guard `!inventoryReceiptId` is read from the earlier snapshot, and the receipt has no key (`inventory.client.ts:~270-290`). Two simultaneous clicks create two posted receipts. M.
8. **Expired subscription falls back to `free` limits** (see section 1, BR-BR-52): a lapsed paid store with 5 branches keeps them but cannot add; downgrade check S010 is not applied on lapse. m.
9. **Dead duplicate upsert**: `stock.service.ts:165-190` `createWarehouse` has the same `ON CONFLICT DO UPDATE` and overwrites `branch_id` unconditionally; grep shows no caller today (hazard if wired). m.
10. **Receive of a transfer into a warehouse whose projection/branch differs is unconstrained, and cross-branch push needs no consent** (reported as BR-TR-22, confirmed), but the report missed that a restricted source-branch member can also CREATE a transfer into ANY branch and dispatch it, instantly debiting source stock and showing `in_transit` at a branch that never asked. Combined with D-05 (no cancel after dispatch) the receiving branch must accept or write off. M.

## 5. Reports' errors and corrections

Report 1
- BR-BR-13 / D10: states permission is held by "a custom role"; omits that seeded `branch_manager` is explicitly denied `settings.update`, so default exposure is owner-only. Corrected in missed #2.
- BR-BR-52 "not verified": now verified (statuses TRIALING/ACTIVE/PAST_DUE only; expired falls to `free`).
- BR-BR-23 severity wording "one click deletes a live trading branch" is true but reachable only by owner (default roles); lower to M, not top-ranked.
- D8, D14 not re-verified by me (CT).
- Line cites are approximate but resolvable; `branch.service.ts` cites (BS:165-177, 225-248, 254-260) are correct.

Report 2
- BR-WH-02 and BR-WH-03 are the same defect listed twice (PARTIAL and CONTRADICTED); treat as one.
- D-04 rated "High": confirm, and it additionally lacks active-warehouse/SKU checks (missed #6).
- BR-WH-08 / S9: correct that nothing refuses `isDefault:false`.
- Report did not read `transfers.service.ts` receive in detail ("Only partially read", BR-WH-44), hence missed #1.
- BR-WH-23 gap (b) "transfer discrepancy leaves no write-off row" is correct.
- Line numbers cited with `~` are within about 10 lines of the real code; the file:line for `warehouses.service.ts:116-123` upsert is correct (actual `111-123`).

Report 3
- Two different defects are both numbered D-02b (return restock permission and POS AWAITING_PAYMENT expiry is D-02 part b): renumber.
- BR-RT-01 "chain of && ... verify" is a false alarm; the check is correct (section 3).
- D-01 impact overstated if read as "double deduction": with no legacy `stock_item` row nothing is deducted, only a zero `sale_shortfall` ledger row is written (`reservations.service.ts:~339-351`); real double deduction needs legacy stock for the same branch/SKU code.
- BR-TR-14 and D-14 (clamp) missed that the clamp plus unvalidated duplicate lines allows inflation (missed #1); BR-TR-17 "ENFORCED" is therefore not safe against crafted bodies.
- BR-TR-03 "regex allows 0": the receive path additionally rejects `<= 0` totals except when `resolveDiscrepancy` is true (`transfers.service.ts:~486-491`); create path not re-opened.
- Severity re-rank: D-02b-pos (paid QR sale cancelled) and the missed duplicate-line inflation outrank D-01.
