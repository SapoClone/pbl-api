# RBAC migration: sales

ADR-0012. `@RequireRoles` and `ROLES` are gone from `apps/sales`; every route uses `@RequirePermission` and branch scope.

## Built

| Route | Permission (any-of) |
| --- | --- |
| GET `/orders`, `/orders/summary`, `/orders/export`, `/orders/{id}`, `/orders/{id}/history`, `/orders/{id}/print` | `orders.view` |
| POST `/orders` | decorator: `orders.create` or `pos.create`; handler: `source: pos` needs `pos.create`, any other source needs `orders.create` (403) |
| PATCH `/orders/{id}` (draft edit) | `orders.create` |
| POST `/orders/{id}/confirm`, `pack`, `ship`, `complete`, `payments` | `orders.update` |
| POST `/orders/{id}/cancel` | `orders.delete` |
| GET `/sales-channels`, `/shipping-providers`, `/registers` | `orders.view` or `pos.view` |
| POST `/registers`, PATCH `/registers/{id}` | `pos.update` |
| GET `/shifts/current` | `pos.view` |
| POST `/shifts`, POST `/shifts/{id}/close` | `pos.create` |

Branch scope (`common/branch-scope.ts`: `assertBranchInScope`, `branchCondition`). Controllers pass `@AllowedBranches()` to the services as a trailing optional `scope` argument (`null` = every branch, the default, so unrestricted behaviour is unchanged).

- Order create: 404 when `dto.branchId` is outside the scope (before the idempotency lookup, nothing is reserved).
- Order get, PATCH, confirm, pack, ship, complete, cancel, payments, history, print: 404 when the order's branch is outside the scope.
- List, summary, export: `branchId` filter outside scope is 404; no filter and a restricted caller gives `branch_id IN (allowed)` in the SQL (also in the `q` alternatives, the summary counts and the `latestException`). An empty scope returns nothing.
- Registers: list and create check the named branch, update checks the register's branch. Shifts: open checks the register's branch, current and close check the shift's branch. All 404.

No status code or response shape changed.

## Deferred

- Branch scope of the `registerId`/`customerId` list filters is not separately checked: a register of another branch simply matches no visible order (the branch condition still applies).
- `GET /sales-channels` and `/shipping-providers` are tenant-wide, with no branch dimension.

## Decisions to review

1. Scope is a trailing optional parameter on service methods (default `null`), not a request-scoped provider, so existing call sites and specs keep compiling.
2. `POST /orders` without `source` is treated as a non-POS order (`orders.create`), matching the old default of counter sales through the API.
3. `GET /shifts/current` in a foreign branch is 404 (same as "no open shift"); `POST /shifts` with a register that exists in a foreign branch is 404, an unknown register stays 400 S007.
4. `PATCH /orders/{id}` is `orders.create` as instructed, even when it finalises a draft to completed.

## How verified

- `tsc -p apps/sales/tsconfig.app.json --noEmit`: clean. eslint and prettier --check on `apps/sales`: clean.
- `jest apps/sales/src`: 10 suites, 181 tests pass. New: route-by-route permission matrix (21 routes: each allowed code passes, an unrelated permission and an empty set get 403, owner passes, legacy `manager`/`cashier` role names get 403), the `POST /orders` source rule, controller scope hand-off, and `buildOrderWhere` scope cases.
- Integration (`jest-int.json apps/sales/test`, Postgres on 25451, container removed): 2 suites, 52 tests pass, including a new "branch scope" block (SQL list/summary/export filtering, 404 on every order read and action, create in a foreign branch, registers and shifts).
