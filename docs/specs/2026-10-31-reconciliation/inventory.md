# Reconciliation: inventory service

THEIRS = `WT/apps/inventory` (WT = scratchpad `wt17`, dhtphu05, M2). MINE = `apps/inventory` (feat/rbac-permissions). Read-only comparison; nothing was built or run. Test counts are from grep of static `it(`/`test(` lines (misses `it.each` and loops) plus each side's own claims.

## 1. Scope and size

| Item | Theirs | Mine |
|---|---|---|
| Route handlers (grep `@Get/@Post/...`) | 47: 39 public `/api/v1`, 8 internal (2 legacy `/internal/reservations`, 6 `/internal/v1/reservations`) | 41: 39 public, 2 internal (`/internal/reservations` POST, DELETE) |
| Non-test source lines (`wc -l`) | 11,214 | 5,678 |
| Tables created (CREATE TABLE in migrations) | 23 over 3 migrations (5 legacy P1 incl. `branch_projection`, 5 warehouse stock, 13 M2 incl. `catalog_sku_projection`) | 17 over 2 migrations (5 legacy + 12 new: `code_sequence`, `stock_threshold`, `supplier`, `purchase_order`, `purchase_order_line`, `supplier_payment`, `stock_transfer`+line, `stock_take`+line, `stock_issue`+line) |
| Migrations | 3 (`1791900000000`, `...100`, `...200`); first two are the legacy base | 2 (`1791900000000`, `1792100000000`) |
| Test files | 5 (3 unit/arch/e2e specs + `domain` spec + 1 int-spec) plus a benchmark script | 9 (7 unit/e2e, 2 int-specs) |
| Static cases | unit/arch/e2e 33 (domain 8, e2e 15, stock-lines 6, architecture 4), int 43 | unit/e2e 39, int 64 (23 + 41) |
| Own claims | `M2_INVENTORY_TEST_RESULTS.md`: 63 unit/e2e + 43 int (the 63 is not reproducible by grep: 33; unverified) | rbac report: 153 jest + 64 int (unverified) |

Only theirs: warehouses (BRANCH/CENTRAL/QUARANTINE, `is_default`), per-warehouse `stock_balance` with `in_transit_qty`, weighted-average cost and `valuation_amount` (ADR-0014), stock reservations with state HELD/COMMITTED/RELEASED/EXPIRED plus idempotency key + payload SHA-256 + advisory lock (ADR-0020), `/stocks/reconcile`, PO receiving against a PO with over-receipt guard, stocktake stale-snapshot check, catalog SKU projection (consumes `catalog.variant.*`), outbox events (11 inventory event types), RLS, architecture guard spec, benchmark.
Only mine: contract-shaped screens API (stock summary/lookup/export, PO summary/export, PO submit/cancel/payments, supplier debt and soft delete, supplier phone mask), readable codes (`NCC0001`, `PO00001`, `DC`, `KK`, `PX`), VAT per PO line, optimistic `version` on every document (409 `I014`), CSV export with formula-injection guard, `inventory.*`/`purchasing.*` permissions and branch scope with 404 (`common/branch-guard.ts`, `common/sql.ts`), `I0xx` error codes, `{data, pagination}` lists with `q`/`sort`/`order`.
Neither has: lots/expiry, FEFO, per-lot tracking (contract open question 4).

## 2. Contract coverage (inventory part of `02-catalog-inventory.md`: 46 endpoints)

Same path and identical shape: 0 for theirs. Mine: 39 present (shape gaps: no `variantId`/`name`/`barcode`, `stockValue` null, ledger `refCode`/`actor` null), 7 missing (receipt approval flow).

| Group (contract count) | Theirs: covered differently | Theirs: missing | Mine |
|---|---|---|---|
| Stock + thresholds + ledger (6) | `GET /stocks` (warehouseId/skuId UUID, `onHandQty` etc. strings), `PUT /stock-thresholds` (warehouse, sku), `GET /stock-movements` (3) | `/stock/summary`, `/stock/lookup`, `/stock/export` (3) | 6 present (`/stock`, summary, lookup, export, thresholds, ledger-entries) |
| Stock receipts (8) | POST (needs `warehouseId`, DRAFT or `autoPost`), GET list, GET id, approve = `POST /:id/post` (4) | PATCH, submit, reject, cancel (4); no `pending_approval` state | 1 present (POST applies stock at once, old behaviour), 7 missing (list, get, patch, submit, approve, reject, cancel) |
| Stock issues (5) | POST, list, get, approve = `/:id/post` (4) | cancel (1) | 5 present (status `draft`, no `submit`) |
| Transfers (6) | POST, list, get, ship = `/dispatch`, receive (5); partial receive + discrepancy | cancel (1) | 6 present |
| Stock takes (6) | path `/stocktakes` not `/stock-takes`; POST, list, get, items = `POST /:id/counts`, complete = `/approve` (5) | cancel (1) | 6 present (path as contract) |
| Suppliers (5) | list, POST, PATCH (3) | GET id, DELETE (2) | 5 present |
| Purchase orders (10) | list, POST, get, approve (4); lines `orderedQty`, no VAT | summary, export, PATCH, submit, cancel, payments (6) | 10 present |
| Total (46) | 28 covered differently | 18 missing | 39 present, 7 missing |

Theirs, no contract endpoint needs: `/warehouses` (4), `/stocks/:skuId`, `/stocks/reconcile`, `GET /stock-thresholds`, `POST /stock-balances/receipts`, `GET /stock-balances`, `POST /purchase-orders/:id/receive`, 6 `/internal/v1/reservations*`, legacy `GET /stock` and `/internal/reservations`. Mine, not in contract: `GET /stock-thresholds`.
Contract features absent on BOTH: `variantId` keying and `variant_projection` backfill, `inventory.variant_cost.updated`, `stock.below_min`, `purchase_order.created|submitted|cancelled`, `supplier_payment.recorded`, ledger `actor`/`refCode`.

## 3. Data model and compatibility

| Topic | Theirs | Mine |
|---|---|---|
| Stock key | `stock_balance` (tenant, `warehouse_id`, `sku_id` UUID); legacy `stock_item` (branch, sku text, int) still live and separate | `stock_item` (tenant, `branch_id`, `sku` text); no warehouse concept |
| Branch link | `warehouse.branch_id` nullable (central/quarantine have none), `is_default`; branch via `branch_projection` | branch is the stock location |
| Quantity type | `NUMERIC(18,3)` as strings ("2.000"); legacy int | integer |
| Money | `NUMERIC(18,2)` decimal strings (`formatCentsToMoney`); contract wants integer VND | integer VND |
| Ledger | `stock_balance_ledger` append-only: `qty_before`, `unit_cost`, `avg_cost_after`, `actor_id`, `correlation_id`, `reversal_of_ledger_id`; types RECEIPT_IN, SALE_COMMIT, TRANSFER_OUT... | `inventory_ledger` (`ref_type` varchar(20): receipt, issue, transfer_out/in, stock_take, sale...); no actor, no cost |
| Receipts | DRAFT -> POSTED (`/post`); no approval/reject; `autoPost` | none stored (applied at once) |
| PO | statuses DRAFT, APPROVED, PARTIALLY_RECEIVED, RECEIVED; `total_amount`; no VAT, no payments, no supplier debt (grep of migration 0200 for vat/payment/debt: none) | draft, pending_approval, approved, (partially_)received (never entered), cancelled; `vat = round(sub*rate/100)` per line (`purchasing/po-rules.ts`); 14,200,000 + 1,136,000 = 15,336,000 tested; payments lower supplier debt |
| Codes | UUID + `code` on warehouse/supplier/PO (format not checked) | per-tenant sequences `code_sequence`: NCC, PO, DC, KK, PX |
| Concurrency token | stock `version` for stocktake | `version` on all documents, 409 `I014` |

Conflicts if both lived in schema `inventory`: both migrate `1791900000000` (same name, same DDL: ok if treated as one) but then diverge on `stock_threshold`, `supplier`, `purchase_order`, `stock_transfer`, `stock_take`, `stock_issue` and their item/line tables (theirs `*_item`, mine `*_line`; different columns and key types, same table names for 6 headers). `CREATE TABLE` would fail on the second. `ref_type`, status vocab and quantity types differ. Mine also lacks their warehouse `ALTER`s. Two stock models (branch/sku text vs warehouse/sku UUID) cannot share `stock_item`/`stock_balance` without a data migration.

## 4. Reservation and cross-service

| Aspect | Theirs | Mine |
|---|---|---|
| Reserve call | `POST /internal/v1/reservations`, headers `X-Tenant-Id` + `Idempotency-Key` (`sales:order:<id>:reserve`), body `{callerService, sourceRefType, sourceRefId, ttlSeconds, lines[{warehouseId, skuId, qty}]}`; controller is `@Public()` (`stock/reservations.controller.ts:221-224`) and trusts the header | `POST /internal/reservations` `{orderId, branchId, lines[{sku, quantity}]}`, user's token forwarded, `@RequirePermission('pos.create','orders.create','orders.update')` (`stock/reservations.controller.ts:41`), idempotent by (tenant, orderId) |
| Lifecycle | HELD, COMMIT, RELEASE, EXPIRED; commit and release are explicit HTTP calls; recovery by `GET .../by-key/:key` and `?orderId=` | held, committed, released, expired; commit by consuming `sales.order.completed` (`stock/order-completed.handler.ts`); release `DELETE /internal/reservations/:orderId`; expiry job (`reservation-expiry.job.ts`) |
| Sales side | ADR-0020: `checkout_workflow` saga (`PENDING_STOCK`, `RESERVING`, `STOCK_RESERVED`, `CONFIRMED`, `RECOVERY_PENDING`...) in `apps/sales/src/orders`; client `apps/sales/src/inventory/inventory.client.ts:105-212` calls v1 (and still the legacy path at :44/:71) | my sales calls only `/internal/reservations` with the user token |
| Events published | `inventory.reservation.confirmed {reservationId, sourceRefType, sourceRefId, state, expiresAt, lines[{warehouseId, skuId, qty}]}`, `.committed`, `.released`, `.expired`, `inventory.stock.changed {warehouseId, skuId, movementType, qtyDelta, onHandAfter, reservedAfter, unitCost, avgCostAfter, referenceType, referenceId, occurredAt}`, `.stock.received`, `.stock.issued`, `.transfer.dispatched|received`, `.stocktake.adjusted`, `.purchase_order.approved {purchaseOrderId, code, supplierId, warehouseId, totalAmount, approvedAt}` (`libs/contracts/src/events.ts:250-316`) | none (first-wave report: "Events: none produced") |
| Events consumed | `platform.branch.created|updated`, `catalog.variant.created|updated|deactivated`, `catalog.product.deactivated`, `sales.order.completed` | `platform.branch.*`, `sales.order.completed` |
| Downstream expectations | their finance (`payables.service.ts`) consumes `purchase_order.approved` + `stock.received`; their integration consumes `stock.changed` (`integration-events.consumer.ts`) | contract wants `stock.changed` (catalog availability projection), `stock.below_min` (insight); nothing emitted yet |

Breaks: my sales + their inventory: my `/internal/reservations` still exists in theirs but is `RequireRoles(OWNER, MANAGER, CASHIER)` (legacy roles), so RBAC tokens (`branch_manager`, `sales_staff`) get 403, and it only touches legacy `stock_item`, not `stock_balance`. Their sales + my inventory: `/internal/v1/reservations` and its commit/release/by-key do not exist, so checkout saga fails (404). Their finance/integration get no events from mine. Insight on my side would still get none from either (no `below_min`).

## 5. Tenancy and authorization

| Topic | Theirs | Mine |
|---|---|---|
| Tenant | ADR-0019: `ENABLE`+`FORCE ROW LEVEL SECURITY` via `enableTenantRlsPolicy` (8 call sites in migrations), `runInTenantTransaction` sets `app.tenant_id` per tx, runtime role NOBYPASSRLS; `TenantScopedRepository` only in `stock.service.ts` and `branch-projection.handler.ts` | no RLS (ADR-0008 app-level); raw SQL with explicit `tenant_id` filter (first-wave decision 1); scoped repo only for branch projection |
| Auth | 40 `@RequireRoles(ROLES.OWNER, ROLES.MANAGER[, CASHIER])` and 0 `@RequirePermission` in code (grep). `M2_INVENTORY_API_REFERENCE.md` lists `inventory.warehouse.write` etc., which the code does not use (doc/code mismatch; the e2e spec was not read in full, unverified) | `@RequirePermission` everywhere: `inventory.view|create|update|approve`, `purchasing.view|create|update|approve|delete`; 40-route matrix test |
| Branch scope | none; warehouse ids, no `@AllowedBranches()` | 404 on foreign branch, `Scope`/`assertBranchInScope` in services |

To move theirs onto my catalog: replace 40 decorators (mechanical map: read -> `inventory.view`, write -> `.create`/`.update`, post/approve -> `.approve`, PO/supplier -> `purchasing.*`); rename strings to match contract verbs; branch scope needs a warehouse -> branch resolution (warehouse.branch_id; central/quarantine with null branch need a rule: store-wide visible only to unrestricted users), apply on locked rows as mine does, add `scope` parameter to ~35 service methods. Their internal v1 routes would need a service-token decision (they are `@Public()`).

## 6. Quality signals

| Check | Theirs | Mine |
|---|---|---|
| Error shape | `{errorCode, code, message, details}` mapped from `InventoryDomainError` (`presentation/inventory-http-error.ts:12-20`): named codes (`INSUFFICIENT_STOCK`), not contract `I0xx`; 422 for validation | contract `I0xx` codes, 409 for conflicts |
| Pagination | `{data, pagination{totalRecords, totalPages...}}` (`stock-query.service.ts:114-121`), default 20 (mine 10) | `{data, pagination}`, default 10, max 100 |
| Concurrency | deterministic `(warehouse, sku)` lock order, advisory lock on idempotency key, DB CHECKs, 29 `FOR UPDATE`, 100-parallel retry tests (claimed) | SKU-order locking, 8 `FOR UPDATE`, concurrent ship/payment int tests |
| Domain purity | `domain/` framework-free, guarded by architecture spec | rules in `po-rules.ts`, `stock-movement.ts` pure |
| Risks seen | (a) `@Public()` internal reservation API (`reservations.controller.ts:221-224`) relies on network isolation; (b) two parallel stock models (legacy `stock_item` and `stock_balance`) kept "for compatibility", `POST /stock-receipts` is polymorphic on `warehouseId` presence (`stock.controller.ts:62-70`); (c) 5 `Number(...)` casts of counts only, no money floats seen; (d) `reservations.service.ts` is ~1,300 lines; (e) ADR numbers 0011/0012 collide with my RBAC ADRs | (a) no receipt approval flow, no valuation; (b) ledger `actor`/`refCode` null (`stock/ledger.service.ts:27,71`); (c) no events; (d) `/internal/reservations` has no branch scope (my report, deferred); (e) quantities are JS numbers (`po-rules.ts`), fine for integers |

## 7. Assessment

| | Adopting THEIRS costs me | Adopting MINE costs them |
|---|---|---|
| Work | Rewrite ~28 screen endpoints to contract paths/shapes (summary, lookup, export, PO summary/export/PATCH/submit/cancel/payments, supplier id/delete, transfer/take/issue cancel, receipt submit/approve/reject/cancel); add VAT, payments, debt, codes, versions, error codes, permissions, branch scope; reconcile decimal-string money/quantity with integer VND; key by variant. Roughly their 11k lines to touch | Rebuild warehouse/valuation/cost on top of branch/sku-text model: no `warehouse`, cost, in-transit, idempotent v1 reservations or events; their sales saga would have to be rewritten onto `/internal/reservations` |
| Unique value | Warehouses, weighted-average cost (answers contract Q1 and `stockValue`), in-transit transfers with partial receive, hardened reservations (idempotency, recovery, saga), event set feeding finance and integration, RLS, catalog projection | Contract-complete screens API, PO money maths and payments/debt, codes, optimistic locking, RBAC and branch scope, CSV export |

Recommendation: keep MINE as the HTTP surface and port THEIRS selectively. Reasons: the contract (Figma) is the target and theirs covers 28 of 46 endpoints under different paths and has no RBAC, VAT, payments or branch scope; mine lacks the receipt approval flow and valuation, which are THEIR strengths. Concrete plan: (1) take their `stock_balance` + weighted-average cost + ledger columns as the stock core, mapping `warehouse` to branch (one default `BRANCH` warehouse per branch); (2) take their receipt posting and PO receiving logic behind my contract routes (`submit/approve/reject/cancel`); (3) take their outbox events (`stock.changed`, `purchase_order.approved`, `stock.received`) and add the contract's missing ones; (4) keep my `PO`, supplier, codes, version, permission and scope code; (5) decide on one reservation API (their v1 contract is stronger; protect it with a service token instead of `@Public()`). Unverified: runtime behaviour of either side, gateway routes, their sales saga end to end.
