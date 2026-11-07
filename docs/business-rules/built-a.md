# Built: workstream A, a store can trade

Branch `feat/branch-default-warehouse`. Settles D1, D2, D3, D13 and D14 of [the decision log](decisions.md). Evidence for the defects is in [a2](a2-warehouses-stock.md), [a3](a3-transfers-sales-stock.md), [a6](a6-cross-domain.md) (X-01) and [a7](a7-verification-branches-stock-transfers.md). Contracts: `02-catalog-inventory.md` ("Inventory: warehouses"), `03-sales-channels-customers.md` (warehouse of a sale), `01-platform.md` (`isWarehouse`).

## Rules, as built

| Id | Rule | Where | Tests |
|---|---|---|---|
| D1 | A branch event (`platform.branch.created` or `.updated`) for an **active** branch gives the branch exactly one default `BRANCH` warehouse, in the same transaction as the projection upsert. Code = branch code upper-cased (`-2`, `-3` when the store already uses it); name = branch name; `is_default` true; `branch_id` set. Idempotent by branch id; events of one branch are serialised by an advisory lock; the partial unique index `UQ_warehouse_default_per_branch` is the backstop. | `apps/inventory/src/branches/branch-projection.handler.ts`, `default-warehouse.ts`, migration `1792700000000-default-branch-warehouse.ts` | `branch-warehouse.int-spec.ts` (one warehouse, redelivery, 8 concurrent events, code clash, tenants apart), `default-warehouse.spec.ts` |
| D1 | An `inactive` or `deleted` branch creates nothing. When a branch stops being active its `BRANCH` warehouses with zero on-hand, reserved and in-transit stock become `INACTIVE`; those with stock are left alone (workstream B's platform guard prevents that case). A branch that becomes active again re-activates its default warehouse (only on that transition, so a manager's own deactivation of an active branch's warehouse is not undone). | same | int: switch off, keep one with stock, re-activate |
| D1 | Backfill: every active branch of `branch_projection` with no `BRANCH` warehouse gets one default warehouse. The same migration first repairs data: two defaults in a branch keep the oldest, `BRANCH` warehouses with no default promote the oldest active one. | migration | int: bare, inactive, no-default and two-default branches; the index refuses a second default; `down` then `up` again |
| D2/D3 | A sale uses **its own branch's** `BRANCH` warehouse. Inventory resolves it (`GET /internal/v1/branches/{id}/sale-warehouse`, and in `POST /internal/v1/reservations` through `branchId`). A named `warehouseId` must be an active `BRANCH` warehouse of that branch, else 409 `WAREHOUSE_NOT_IN_BRANCH` (central, quarantine and another branch's alike). A branch with no active default: 409 `BRANCH_HAS_NO_WAREHOUSE`. `branchId` is required for `callerService: sales` (400 `BRANCH_REQUIRED`). | `apps/inventory/src/branches/branch-warehouse*.ts`, `stock/reservations.service.ts` | int: default resolved, own warehouse accepted, foreign/central/quarantine refused, no-warehouse branch, replay by key |
| D2/D3 | Sales stops requiring `warehouseId` (POS checkout, `/orders/checkouts`, omnichannel and manual orders, confirm, draft PATCH). It asks inventory first, **before** any coupon, loyalty or credit claim, stores the resolved id on the workflow and the order, and sends `branchId` in the reservation. Inventory's 409 codes pass through unchanged. A fulfillment must ship from the order's reserved warehouse. `autoConfirm` no longer needs a `warehouseId`. | `apps/sales/src/inventory/inventory.client.ts`, `modules/checkout/checkout.service.ts`, `orders/orders.service.ts`, `modules/orders/m3-orders.service.ts`, `modules/fulfillment/fulfillment.service.ts` | `apps/sales/test/sales.int-spec.ts` ("a sale uses its own branch warehouse"), `inventory.client.spec.ts`, `test/system` |
| D2 | `isWarehouse` is not used by anything. The field stays in the branch API and `branch_projection.is_warehouse` stays; the contract says it is informational. | contracts | none needed |
| D13 | `POST /warehouses` is a plain insert; a code clash is 409 `WAREHOUSE_CODE_CONFLICT` and nothing is overwritten (the takeover by a branch-limited manager is closed). The dead duplicate upsert `StockService.createWarehouse` is deleted. | `modules/warehouses/warehouses.service.ts`, `stock/stock.service.ts` | int: conflict keeps the original |
| D13 | Branch scope is checked on create and on the existing row on PATCH, and on the target branch **including `null`** (a limited member never owns a null branch): 404. | `warehouses.controller.ts` | int: scoped manager cannot create, patch, move or detach another branch's warehouse, nor make a central one |
| D13 | PATCH cannot change `branchId` or `kind` of a warehouse holding stock, holds or open transfers (409 `WAREHOUSE_BRANCH_LOCKED`, `details.reasons` lists all) and cannot detach a `BRANCH` warehouse. | service | int: stock + transfer reasons, detach, re-kind, an empty one may move |
| D14 | `BRANCH` needs an active branch known to inventory (404 `BRANCH_NOT_FOUND`, 409 `BRANCH_NOT_ACTIVE`); `CENTRAL` and `QUARANTINE` must have none (400 `WAREHOUSE_BRANCH_INVALID`). | service | int |
| D14 | One default per branch, mandatory: the first `BRANCH` warehouse becomes the default; `isDefault: true` moves it; `isDefault: false` on the default is refused (409 `WAREHOUSE_IS_DEFAULT`), as is deactivating or moving it while the branch is active; an `INACTIVE` warehouse cannot be the default. | service | int |
| D14 | Branch stock views count `kind = 'BRANCH'` warehouses, not "`branch_id` is not null". | `modules/stock-views/stock-views.service.ts` | int: central and quarantine rows that still carry a `branch_id` do not count |

## Deviations and interpretations

- **`isWarehouse` kept, not deleted.** The brief says to remove it from the contract and keep the column. The platform field stays in the branch request and response (removing it from platform's API is platform's workstream and would break clients); the contracts now call it informational and say nothing may depend on it.
- **Resolution has two steps.** Sales calls the new internal `sale-warehouse` route before claiming anything, so a refusal needs no compensation, and inventory validates again inside the reservation (defence in depth, and other callers). The reservation hash covers `branchId` and the lines as sent, so an idempotent replay survives a change of the default warehouse; a request without a branch hashes exactly as before.
- **Deactivating the default warehouse of an active branch is refused** (my reading of "the default cannot be unset without naming another"). A branch that is inactive may lose it (the event handler does this itself).
- **Legacy branch-and-SKU hold** (`POST /internal/reservations`, used by `POST /orders`) is not changed: it has no warehouses and retires with D16 (workstream F).
- **Returns restock** (`returns.service.ts`) still takes `warehouseId` from the request or the order; not a sale, so not part of D3.
- **Backfill `down`** only drops the index. The repaired defaults and created warehouses are indistinguishable from later data and may hold stock.
- The branch projection row and the default warehouse share one advisory lock key (`branch_default_wh:<tenant>:<branch>`), also taken by warehouse create and PATCH.

## Tests changed because they relied on the old behaviour

- `apps/inventory/test/inventory.int-spec.ts`: the reservation suites created a `CENTRAL` warehouse and reserved from it, created warehouses with no branch, and re-created the same code through the upsert. They now use `BRANCH` warehouses of the test branch (the branch event also creates a default `CN01`), send `branchId`, and create the warehouse through `WarehousesService`; the warehouse management test no longer gives a `CENTRAL` warehouse a branch.
- `apps/inventory/test/{inventory-scope,stock-views}.int-spec.ts` and the benchmark register the new migration.
- `apps/sales/test/{sales,screen}.int-spec.ts` and `apps/sales/src/orders/orders.service.spec.ts` stub `resolveSaleWarehouse`; `test/system/*` bridge it to the real inventory resolver and one reservation passes `branchId`.

## Results

Inventory unit 410 and integration 97 (new `branch-warehouse.int-spec.ts` 20, `default-warehouse.spec.ts` 17), sales unit 422 and integration 73, `test/system` 15, all green. `tsc`, eslint and prettier clean on the changed files.

## For other workstreams

- **Platform (B):** the branch event already carries what inventory needs; nothing to change there. The guard that refuses to deactivate a branch with stock is what keeps the "leave warehouses with stock alone" branch of the handler unreachable.
- **pbl-web:** drop the `warehouseId` choice from POS and manual order screens; show `BRANCH_HAS_NO_WAREHOUSE` and `WAREHOUSE_NOT_IN_BRANCH` messages.
- No change to `topology.ts` or `krakend.json` (the new routes are internal).
