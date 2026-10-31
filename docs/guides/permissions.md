# Permissions guide

For service authors. Design: [ADR-0012](../decisions/0012-permissions-and-branch-scope.md).
A permission is `<module>.<action>`; the catalog and the default roles live in
`@pbl/contracts` (`libs/contracts/src/permissions.ts`), enforcement in `@pbl/auth`.

## Catalog

| Module                               | Actions                               |
| ------------------------------------ | ------------------------------------- |
| dashboard, reports                   | view                                  |
| products, channels, customers, staff | view, create, update, delete          |
| inventory, orders, purchasing        | view, create, update, delete, approve |
| pos                                  | view, create, update                  |
| settings                             | view, update                          |

Exports: `PERMISSION_CATALOG`, `PERMISSION_MODULES`, `PERMISSION_ACTIONS`, `PermissionCode`,
`ALL_PERMISSIONS`, `isPermissionCode()`, `WILDCARD_PERMISSION` (`'*'`).

## Default roles

`owner` has `*`. `branch_manager` has everything except `staff.create|update|delete` and
`settings.update`. The others (`DEFAULT_ROLE_PERMISSIONS`):

| Role (`ROLE_CODES`)                | Permissions                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sales_staff` (Nhân viên bán hàng) | dashboard/products/inventory view; orders view, create, update; pos view, create, update; customers view, create, update |
| `warehouse_staff` (Nhân viên kho)  | dashboard/products/orders view; inventory view, create, update; purchasing view, create                                  |
| `accountant` (Kế toán)             | dashboard, orders, customers, inventory view; purchasing view, update; reports view                                      |

Legacy `manager` and `cashier` map to `branch_manager` and `sales_staff` (`normalizeRoleCode()`).

## Protect a route

```ts
@Post()
@RequirePermission('orders.create')
create(@CurrentTenant() tenantId: string, @Body() dto: CreateOrderDto) {}
```

- The caller needs **at least one** of the listed codes; `'*'` (owner) passes any.
- No store selected in the token, or no matching code: 403.
- With `@RequireRoles` as well, the caller must satisfy **both** (roles are legacy; prefer permissions).
- A route open to every member of the store (branch list, own account) carries **no** decorator.
  `@Public()` and `@AuthOptional()` still skip the guard entirely.
- Pure check inside a service: `hasPermission(user, 'orders.approve')`.

## Branch scope

`AuthUser.branches` lists the branch ids the member may act in; `['*']` means all.

- A request naming a branch outside the scope answers **404**, never 403:
  `if (!canAccessBranch(user, branchId)) throw new NotFoundException()`.
- A list without a branch filter returns only allowed branches:

```ts
list(@CurrentTenant() tid: string, @AllowedBranches() branches: string[] | null) {
  // null = every branch, so add no filter; otherwise WHERE branch_id = ANY($branches)
}
```

`allowedBranches(user)` returns the same value outside controllers.

## Test tokens

```ts
const auth = createTestAuth(); // from '@pbl/auth/testing'
auth.token({ tid, roles: ['sales_staff'], permissions: ['orders.create'], branches: ['b1'] });
auth.bearerWithPermissions('sales_staff', ['orders.create'], tid, ['b1']);
auth.bearer(['owner'], tid); // owner: permissions default to ['*']
```

Defaults: roles containing `owner` get `['*']`, everything else none; `branches` defaults to `['*']`.

## Claims

Platform signs, for the selected store: `roles: ['sales_staff']`, `perms: ['orders.view', ...]`
(`['*']` for the owner) and `branches: ['<branch id>', ...]` (or `['*']`). Non-string elements
are dropped. A token without `perms` reads as `['*']` for an owner and `[]` otherwise
(no role-to-permission fallback in `@pbl/auth`); without `branches`, as `['*']`.
Changes apply at the next refresh or sign-in.
