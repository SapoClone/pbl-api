# RBAC migration: insight

ADR-0020. `@RequireRoles` and `ROLES` are gone from `apps/insight`; reports use `@RequirePermission` and branch scope.

## Built

| Route                                                                                                                          | Permission (any-of)            |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| GET `/dashboard/kpis`, `/sales-summary/hourly`, `/sales-summary/by-channel`, `/sales-summary/top-products`, `/attention-items` | `dashboard.view`               |
| GET `/sales-summary/daily`, `/sales-summary/by-branch`, `/reports/export`, `/audit-logs`                                       | `reports.view`                 |
| GET `/notifications`, `/notifications/unread-count`, POST `/notifications/read-all`, `/notifications/{id}/read`                | none (any member of the store) |
| POST `/device-tokens`, DELETE `/device-tokens/{token}`                                                                         | none (any member of the store) |

Branch scope (`src/common/branch-scope.ts`: `BranchScope`, `assertBranchInScope`). Controllers pass `@AllowedBranches()` to the services as a trailing optional `scope` argument (`null` = every branch, the default).

- kpis, hourly, by-channel, top-products, daily (both `groupBy` modes), export: `branchId` outside the scope is 404; with no `branchId` and a restricted caller every SQL gets `branch_id = ANY($scope::uuid[])` (also the cost and customer queries). by-branch only lists allowed branches. An empty scope returns nothing.
- Notifications: list, unread-count, read-all and attention-items only see `branch_id IS NULL OR branch_id = ANY(scope)`. A `branchId` filter outside the scope is 404 (list, attention-items). Marking one notification read that is outside the scope is 404 `NOTIFICATION_NOT_FOUND`, like an unknown one.
- Audit logs have no branch column: they stay tenant-wide, gated only by `reports.view`.

No status code or response shape changed.

## Deferred

- Audit logs are not branch-filtered (no branch in the table; an event's payload branch is not indexed).
- `customers` in the KPIs is filtered through `customer_sales_daily.branch_id`, so a customer who bought in an allowed and a foreign branch counts once in the allowed scope only (correct for scope, not separately tested).

## Decisions to review

1. Scope is a trailing optional parameter (default `null`), not a request-scoped provider, matching sales.
2. `POST /notifications/{id}/read` for a notification of a foreign branch is 404 (not a silent no-op), so existence is not leaked.
3. `/attention-items` is `dashboard.view` as instructed, and also follows the notification branch filter.
4. Role names in the old tests (`manager`, `cashier`) were replaced; those names now get 403 on report routes (asserted).

## How verified

- `tsc -p apps/insight/tsconfig.app.json --noEmit`: clean. eslint and prettier --check on `apps/insight`: clean.
- `jest apps/insight/src`: 2 suites, 53 tests pass. New: 9-route permission matrix (the code passes, the other code, no permission, legacy `manager`/`cashier`, `branch_manager` and unknown roles without permissions get 403, owner passes, 401 without token, 403 without store), scope hand-off from the token for reports, notifications and export, the bell open to any role.
- Integration (`jest-int.json apps/insight/test`, Postgres on 25471, container removed): 19 tests pass, including a new "branch scope" block (404 on every read for a foreign branch, filtered aggregates for all reports and the CSV, empty scope, filtered notifications/unread/read-all/attention items, markRead 404).
