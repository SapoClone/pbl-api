# RBAC migration: customer

ADR-0012. `@RequireRoles` and `ROLES` are gone from `apps/customer`; every route uses `@RequirePermission`. Customers are store-wide: no branch scope.

## Built

| Route | Permission |
| --- | --- |
| GET `/customers`, `/customers/summary`, `/customers/export`, `/customers/{id}`, `/customers/{id}/loyalty-transactions` | `customers.view` |
| GET `/customer-groups`, `/customer-tags`, `/loyalty-settings` | `customers.view` |
| POST `/customers`, `/customers/{id}/addresses`, `/customer-groups`, `/customer-tags` | `customers.create` |
| PATCH `/customers/{id}`, `/customers/{id}/addresses/{addressId}`, `/customer-groups/{id}`, `/loyalty-settings` | `customers.update` |
| POST `/customers/{id}/loyalty-adjustments` | `customers.update` |
| DELETE `/customers/{id}`, `/customers/{id}/addresses/{addressId}` | `customers.delete` |

Phone visibility: `hasPermission(user, 'customers.update')` gives the full phone; otherwise `phone: null` + `phoneMasked`. Applies to list, detail, create/PATCH/address responses and the CSV export (the service flag is unchanged; only the controller computes it).

No status code or response shape changed.

## Deferred

- None.

## Decisions to review

1. DELETE address is now `customers.delete` (it was cashier-allowed). A `sales_staff` can no longer remove an address; they can still add and edit. Follows the instructed mapping.
2. Creating a group or tag is `customers.create`, renaming a group `customers.update` (the old code used one role set for both).
3. A caller with `customers.create` but not `customers.update` sees a masked phone in the response of the customer they just created.

## How verified

- `tsc -p apps/customer/tsconfig.app.json --noEmit`: clean. eslint and prettier --check on `apps/customer`: clean.
- `jest apps/customer/src`: 3 suites, 72 tests pass. The route matrix is now by permission for all 20 routes: the permission passes, the other three customers codes, an empty set and an unrelated code get 403, owner passes, legacy `manager`/`cashier`/`viewer` role names without permissions get 403 (401 without token, 403 without store unchanged). Phone masking test: owner and `customers.update` see phones, `view/create/delete` does not.
- Integration (`jest-int.json apps/customer/test`, Postgres on 25491, container removed): 24 tests pass.
