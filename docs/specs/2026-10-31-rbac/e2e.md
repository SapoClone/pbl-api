# RBAC end-to-end tests

Design: [ADR-0011](../../decisions/0011-multi-tenant-model.md) is not needed to run these; see [ADR-0012](../../decisions/0012-permissions-and-branch-scope.md) and the per-service tables in this folder.

## How to run

The Docker stack must be up (`docker compose up -d --build`). Both scripts talk only to the gateway (`http://localhost:8080`, or `GATEWAY_HOST_PORT`), need `bash`, `curl` and `jq`, and use `docker compose exec postgres` only to wait for the branch projections. Each run registers fresh users and a fresh store, so a script can be repeated without a reset.

```bash
scripts/demo-rbac.sh          # 142 checks
scripts/demo-first-wave.sh    # 248 checks
scripts/demo-events.sh
scripts/verify-local-stack.sh
```

Every step is asserted and the script exits non-zero on the first failure.

## What `demo-rbac.sh` covers

| Step | Covers |
| --- | --- |
| 1 | Owner creates a store with a second branch; owner token claims (`roles ["owner"]`, `perms ["*"]`, `branches ["*"]`); `GET /permissions` (38 applicable, 11 modules, 5 default matrices); `GET /roles` (5 seeded roles, member counts, `isOwner`); owner role cannot be edited (400 R002) or deleted (400 R004); seeded role cannot be deleted (400 R004); unknown role 404 |
| 2 | Custom role create (201, slug code), unknown permission (400 R003), duplicate name (400 R001, case-insensitive, also a seeded name), PATCH (drop and re-add a permission, unknown code), delete an unused role (204, then 404) |
| 3 | Member added with `roleId` + `branchIds` (first branch); role in use is 409 R005 and `memberCount` is 1; decoded JWT has exactly the role code, the role's six permissions and the one branch |
| 4 | An allowed call and a 403 in each service: platform (`/branches` vs `/roles`, member add), catalog, customer, inventory, sales (list, create draft vs confirm), insight (KPIs vs `sales-summary/daily`); 401 without token |
| 5 | Branch scope: `GET /branches` filtered, `GET /branches/{other}` 404, stock (filtered, lookup, no-filter rows), KPIs of the other branch 404, own branch 200, order of the other branch 404, create in the other branch 404, order list filtered by the other branch 404, unfiltered order list only the member's branch (the owner sees both) |
| 6 | Role + branch change through the API: old token keeps old claims and old limits (403 on `/roles`, 404 on the other branch); a new sign-in (and a refresh) gets `branch_manager` and `["*"]`; the new token works |
| 7 | Seeded roles: sales_staff reads KPIs, not `sales-summary/daily`, sees the full phone, may confirm but not cancel orders, cannot create categories; accountant reads the daily report, sees a masked phone (list and detail), cannot create customers or receive stock; warehouse_staff creates a stock receipt, reads purchase orders, cannot approve one, read customers, read reports or create orders; sales_staff cannot read roles or update the store |
| 8 | Legacy `manager` -> `branch_manager`, `cashier` -> `sales_staff` (same seeded role id, signs in as `sales_staff`); a member without `staff.update` cannot change their own role (403), edit a role (403) or create a role (403); a branch_manager cannot change roles or add members (403); the owner's role cannot change (400 T003); unknown or `owner` role code 422; unknown `roleId` 400 R007 and no member left behind |

## Changed assertions in `demo-first-wave.sh`

| Was | Now | Reason |
| --- | --- | --- |
| a cashier does not see the full phone (`.phone = null`) | a cashier (sales_staff) sees the full phone | sales_staff holds `customers.update`, which gives the full phone (customer table, ADR-0012) |
| 403 "a cashier cannot confirm (orders.update)" | 403 "a cashier cannot cancel (orders.delete)" on the same draft | sales_staff holds `orders.update`, so it may confirm; the owner's later confirm step stays. The denial now checks `orders.delete`, which sales_staff does not hold |
| 403 "a cashier cannot read the KPIs" | 200 for KPIs, plus 403 for `sales-summary/daily` | sales_staff holds `dashboard.view` but not `reports.view` (insight table) |

Line 133 (the cashier's own role is `sales_staff`) was already updated. Every other check is unchanged.

## Bugs found

| Symptom | Root cause | Fix | Regression test |
| --- | --- | --- | --- |
| none | | | |

No defect in `apps/**` was found: after correcting the script's own assumptions below, every check passed against the running stack. No code, gateway route or container was changed.

## Script assumptions corrected (not bugs)

- Duplicate role name is `400 R001` and an owner or seeded role delete is `400 R004`, as in the contract (`01-platform.md`, roles section). The brief expected 409 for a duplicate name; only "role in use" is 409 (R005), as in `platform.md`. If 409 is wanted for R001, change the contract and `RoleService.assertNameFree` together.
- Editing the owner role is `400 R002`; changing the owner member's role is `400 T003`; an unknown legacy `role` string is a DTO `422`.
- `warehouse_staff` holds `purchasing.view` and `purchasing.create` (see `docs/guides/permissions.md`), so it can read purchase orders. The brief said it cannot; the script checks that it cannot approve one, read customers or read reports instead.
- The token claim `roles` is an array (`["owner"]`).

## Not covered

- Mobile and UI behaviour; only the HTTP APIs through the gateway.
- Inventory transfers, stock takes, stock issues, registers and shifts under a restricted branch scope (covered by the service integration tests, not by the shell scripts).
- Branch scope of `GET /staff-schedules`, branch settings, notifications and `reports/export`.
- `/internal/reservations` branch scope (deferred in `inventory.md`).
- Events for role changes (`platform.role.updated` is deferred in `platform.md`).
- Live token revocation (not implemented by design; the script documents the delay).
- Time-based expiry and the refresh flow in depth: the refresh check only runs when the login response carries a `refreshToken`.
