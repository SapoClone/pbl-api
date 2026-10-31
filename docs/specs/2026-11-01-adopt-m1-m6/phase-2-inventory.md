# Phase 2: inventory (their M2) under permissions, branch scope and hardening

Scope: `apps/inventory/**` only. Rules: `phase-2-rules.md`. No git state changed.

## Built

Route -> permission (any one passes; owner `*` passes all). Old role names no longer appear in code or tests.

| Route | Permission |
|---|---|
| GET `/api/v1/stock`, `/stocks`, `/stocks/:skuId`, `/stock-balances` (stock lookup) | `inventory.view`, `pos.create`, `orders.create` |
| POST `/stock-receipts` (M2 `warehouseId` or legacy `branchId`), POST `/stock-balances/receipts` | `inventory.create` |
| GET `/stock-receipts`, `/stock-receipts/:id`, `/stock-movements`, `/stock-thresholds` | `inventory.view` |
| POST `/stock-receipts/:id/post` | `inventory.approve` |
| `/warehouses`: GET list, GET id / POST / PATCH | `inventory.view` / `.create` / `.update` |
| PUT `/stock-thresholds` | `inventory.update` |
| POST `/stocks/reconcile` | `inventory.approve` |
| `/stock-issues`: POST / GET list, GET id / POST `:id/post` | `inventory.create` / `.view` / `.approve` |
| `/stock-transfers`: POST / GET / dispatch / receive | `.create` / `.view` / `.update` / `.update` |
| `/stocktakes`: POST / GET / `:id/counts` / `:id/approve` | `.create` / `.view` / `.update` / `.approve` |
| `/suppliers`: POST / GET / PATCH | `purchasing.create` / `.view` / `.update` |
| `/purchase-orders`: POST / GET / `:id/approve` / `:id/receive` | `purchasing.create` / `.view` / `.approve` / `inventory.create` (only; receiving writes stock) |
| POST/DELETE `/internal/reservations` (legacy, bearer forwarded) | `pos.create`, `orders.create`, `orders.update` + service token |
| `/internal/v1/reservations*` | no permission; service token only |

`autoPost: true` on a receipt or an issue posts stock at once, so it also needs `inventory.approve` (403 otherwise).
There is no supplier-payment or PO-payment route in their M2 (nothing to map).

Branch scope. Link found: `warehouse.branch_id` (nullable, ADR-0014; set by the create/update warehouse API, FK-less, checked against
`branch_projection` on create). Their code consumes `platform.branch.*` only into `branch_projection`; it does not create warehouses.
No schema change was needed. `scope/warehouse-scope.ts` (`WarehouseScopeService`, `applyWarehouseScope`):
- restricted member sees/acts on warehouses whose `branch_id` is in `branches`; a warehouse with `branch_id` NULL (central, quarantine)
  is for unrestricted members only. Out of scope answers 404 (`NOT_FOUND`); a missing row stays the service's own 404.
- lists (warehouses, stock-balances, stocks, movements, thresholds, receipts, issues, stocktakes, transfers, purchase orders) filter in SQL
  (`warehouse_id = ANY(...)`); naming a `warehouseId`/`branchId` out of scope is 404. `GET /stocks/:skuId` and reconcile only count in-scope warehouses.
- documents by id (receipt, issue, stocktake, PO) resolve through their warehouse; create needs the warehouse in scope (PO, receipt, issue, stocktake, threshold, balance receipt).
- transfers: create needs the source in scope; dispatch the source; receive the destination; read either end; list shows a transfer when either end is in scope.
- warehouse create/PATCH: a restricted member needs a `branchId` in scope (none given on create = 404) and cannot move a warehouse out of scope.
- legacy `branchId` routes (`GET /stock`, POST `/stock-receipts` with `branchId`, legacy `POST /internal/reservations`): `branchId` checked directly.
- suppliers are tenant-wide (no branch).

## Hardening done (rule 6)

Guard: `src/internal/internal-token.guard.ts` (`InternalTokenGuard`), applied at class level to both internal controllers
(`internal/v1/reservations`, which stays `@Public()`, and legacy `internal/reservations`). Header **`x-internal-token`** must equal env
**`INTERNAL_S2S_TOKEN`** (sha256 + `timingSafeEqual`); missing/wrong -> 401. Unset env -> 401 (fail closed) unless `NODE_ENV=test`.
The guard runs before any handler reads `X-Tenant-Id`, so the tenant header counts only for a caller holding the token.
Their code had no token check under another header name.
**Caller change (other worker, sales saga):** send `x-internal-token: $INTERNAL_S2S_TOKEN` on every call to `/internal/v1/reservations*`
(create, list, by-key, by id, commit, release) and on legacy `/internal/reservations` (which also still needs the forwarded bearer). The inventory
container needs `INTERNAL_S2S_TOKEN` set (compose, parent's job).

## Deferred

- Legacy `DELETE /internal/reservations/:orderId` and the reservation expiry/event handlers are not branch-scoped (system paths, keyed by order).
- `/internal/v1/reservations` takes any `warehouseId` for the tenant; no per-branch check (service-to-service).
- Dead code `StockService.createWarehouse` (no controller) left untouched.

## Decisions to review

1. Warehouse with no branch = unrestricted members only (reconciliation report suggested the same).
2. Receipt post, issue post, stocktake approve, reconcile, PO approve = `.approve`. PO receive = `inventory.create` ONLY (coordinator decision: it writes stock, so warehouse_staff can receive and accountant cannot; was `purchasing.update`). A `warehouse_staff` still cannot post receipts (`inventory.approve`).
3. Stocktake `:id/counts` was open to cashiers: now `inventory.update` (warehouse_staff has it, sales_staff does not).
4. Stock lookup open to `pos.create`/`orders.create` = the four stock-level reads (`/stock`, `/stocks`, `/stocks/:skuId`, `/stock-balances`); `/warehouses` and movements are not.
5. Legacy internal route keeps the bearer + permissions and additionally needs the token; transfer create requires only the source in scope.

## Needs from shared files

- `docker-compose.yml`: `INTERNAL_S2S_TOKEN` for inventory (and sales, as caller). No `libs/**` change needed.
- Sales (`apps/sales/src/inventory/inventory.client.ts`): send the header, see above. `krakend.json` unchanged (internal routes not routed).
- Stale statements in `docs/progress-report/M2_*` (not edited): API_REFERENCE lists `inventory.warehouse.write`, `inventory.stock.write`,
  `inventory.receiving.write`, `inventory.issuing.write`... (code now uses `inventory.*`/`purchasing.*`; before it used `RequireRoles`); it says internal routes use only
  `X-Tenant-Id` (now also `x-internal-token`); TEST_RESULTS test counts (now 248 unit/e2e); ADR-0012/M2 docs call the v1 API trusting network isolation.

## How verified

- `pnpm exec tsc -p apps/inventory/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest apps/inventory/src --maxWorkers=2 --silent`: 4 suites, 248 tests pass (per-route matrix of 39 routes: 401, 403 no store, 403 wrong
  permission, each code passes, owner passes; branch-scope tests with an in-memory scope; token guard tests incl. fail-closed).
- `pnpm exec eslint apps/inventory` and `prettier --check apps/inventory`: clean.
- Integration: throwaway `pgvector/pgvector:pg17` on port 25499 (removed): `inventory.int-spec.ts` and the new `inventory-scope.int-spec.ts`
  (scope SQL for warehouses, documents, transfers, lists, reconcile): 47 tests pass.
