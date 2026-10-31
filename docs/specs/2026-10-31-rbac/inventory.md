# RBAC migration: inventory

ADR-0012. Scope: `apps/inventory/**` only. No `@RequireRoles` and no `ROLES.*` is left in the service.

## 1. Built

| Route                                                            | Permission (any-of)                        |
| ---------------------------------------------------------------- | ------------------------------------------ |
| GET /stock, /stock/summary, /stock/export                        | inventory.view                             |
| GET /stock/lookup                                                | inventory.view, pos.create, orders.create  |
| POST /stock-receipts                                             | inventory.create                           |
| GET /ledger-entries, GET /stock-thresholds                       | inventory.view                             |
| POST /stock-thresholds                                           | inventory.update                           |
| GET /stock-transfers, /stock-transfers/{id}                      | inventory.view                             |
| POST /stock-transfers                                            | inventory.create                           |
| POST /stock-transfers/{id}/ship, receive, cancel                 | inventory.update                           |
| GET /stock-takes, /stock-takes/{id}                              | inventory.view                             |
| POST /stock-takes                                                | inventory.create                           |
| PATCH /stock-takes/{id}/items, POST .../cancel                   | inventory.update                           |
| POST /stock-takes/{id}/complete                                  | inventory.approve                          |
| GET /stock-issues, /stock-issues/{id}                            | inventory.view                             |
| POST /stock-issues                                               | inventory.create                           |
| POST /stock-issues/{id}/approve                                  | inventory.approve                          |
| POST /stock-issues/{id}/cancel                                   | inventory.update                           |
| GET /suppliers, /suppliers/{id}                                  | purchasing.view                            |
| POST /suppliers / PATCH /suppliers/{id} / DELETE /suppliers/{id} | purchasing.create / update / delete        |
| GET /purchase-orders, /summary, /export, /{id}                   | purchasing.view                            |
| POST /purchase-orders                                            | purchasing.create                          |
| PATCH /{id}, POST /{id}/submit, /{id}/cancel, /{id}/payments     | purchasing.update                          |
| POST /purchase-orders/{id}/approve                               | purchasing.approve                         |
| /internal/reservations (POST, DELETE)                            | pos.create, orders.create (see decision 1) |

Branch scope (404, never 403; `@AllowedBranches()` is passed to the services as a required `scope: string[] | null`):

- Helpers in `common/sql.ts`: `Scope`, `assertBranchInScope`, `assertVisible`, `Where.branchScope` (SQL `col = ANY($n::uuid[])`).
- Stock list/summary/export, thresholds list, ledger, PO list/summary/export, takes/issues/transfers lists: an explicit `branchId` outside the scope is 404, no filter restricts the rows (SQL) to the allowed branches. Summary `byBranch` follows the same filter.
- Lookup, receipt, threshold upsert, PO create, PO update with a new `branchId`, take/issue create: foreign branch is 404, checked before the "branch exists and is active" 400 (I001), so existence is not leaked.
- Documents by id (PO, take, issue, transfer): 404 when the branch is outside the scope. For every action the check runs on the locked row inside the transaction, before any state check or movement.
- Transfers: create needs the source in scope (destination may be any branch of the store); read and list need either end in scope; ship and cancel need the source; receive needs the destination.
- Suppliers are store-wide (no branch), so no scope.

Response shapes and status codes are unchanged. No migration.

## 2. Deferred

- `/internal/reservations` has no branch-scope check (the brief lists none; the caller is the sales service forwarding the user's token). Add `assertBranchInScope` on `branchId` if the cashier-branch rule must hold there too.
- Event handlers, jobs and projections are untouched.

## 3. Decisions to review

1. Reservations: the brief says to keep their protection, but that was `RequireRoles(OWNER, MANAGER, CASHIER)`, which would 403 `branch_manager` and `sales_staff` tokens and breaks the "no ROLES.MANAGER/CASHIER" rule. It is now `@RequirePermission('pos.create', 'orders.create')`, the permissions of the callers (checkout). Alternative: drop the decorator and rely on the tenant check only.
2. Transfer visibility: "both source and destination outside the scope" is read as: hidden only when neither end is in scope. A user at only the destination can read but cannot ship or cancel (404); a user at only the source can ship and cancel but cannot receive.
3. Transfer create does not require the destination in scope (stock leaving your branch for another is normal); the destination must still exist and be active.
4. Stock take/issue PATCH items and cancel are `inventory.update`, take complete is `inventory.approve`, as specified; the scope check applies to all of them.
5. Missing store (token without `tid`) stays 403 through the guard; a restricted caller with an empty `branches` list (`[]`) sees nothing and gets 404 for any branch.
6. `scope` is a required parameter on the service methods (no default) so a new call site cannot forget it; int tests pass `null` for "every branch".

## 4. How verified

- `pnpm exec tsc -p apps/inventory/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest apps/inventory/src --maxWorkers=2 --silent`: 7 suites, 153 tests pass. New: a 40-route permission matrix in `first-wave.e2e.spec.ts` (each route: no token 401, owner `*` ok, each allowed code ok, an unrelated code and no code 403, legacy role `manager` 403; the count is asserted so a new route must be added), the reservation/receipt matrix in `app.e2e.spec.ts`, controller-to-service scope pass-through, unit tests for `Where.branchScope` and the 404 helpers.
- Integration (own Postgres 17 on port 25461, container removed afterwards): `EVENTS_IT_DB_PORT=25461 pnpm exec jest --config libs/events/test/jest-int.json apps/inventory/test --maxWorkers=1`: 2 suites, 64 tests pass, including a new "branch scope" block (filtered lists/summary/export/ledger/thresholds/PO/take/issue/transfer, 404 on foreign documents and branches, no stock moved on a refused action, transfer source/destination rules).
- `eslint apps/inventory`: clean. `prettier --check apps/inventory`: clean.
