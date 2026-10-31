# RBAC migration: catalog

ADR-0012. `@RequireRoles` and `ROLES` are gone from `apps/catalog`; every route uses `@RequirePermission`. The catalog is store-wide, so there is no branch scope.

## Built

| Route                                                                                                           | Permission (any-of)                                              |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET `/products`, `/products/summary`, `/products/export`, `/products/{id}`                                      | `products.view`                                                  |
| GET `/categories`, `/brands`, `/attributes`                                                                     | `products.view`                                                  |
| GET `/variants` (POS, manual order, receipt lookup)                                                             | `products.view`, `pos.create`, `orders.create`, `inventory.view` |
| POST `/products`, `/products/{id}/variants`, `/categories`, `/brands`, `/attributes`, `/attributes/{id}/values` | `products.create`                                                |
| PATCH `/products/{id}`, `/variants/{id}`, `/categories/{id}`, `/brands/{id}`                                    | `products.update`                                                |
| DELETE `/products/{id}`, `/variants/{id}`, `/categories/{id}`, `/brands/{id}`                                   | `products.delete`                                                |

No status code or response shape changed.

## Deferred

- Nothing for catalog. Brands PATCH/DELETE exist in the code (not listed in the task) and follow the update/delete rule.

## Decisions to review

1. Brand PATCH/DELETE mapped to `products.update` / `products.delete`, like categories.
2. `GET /products/{id}` is `products.view` (a read, same as the list).
3. `sales_staff` and `warehouse_staff` both hold `products.view`, so they keep reading; neither can write (as the old cashier).

## How verified

- `tsc -p apps/catalog/tsconfig.app.json --noEmit`: clean. eslint on `apps/catalog`: clean. prettier --check on the changed files: clean (`tsconfig.app.json` was already unformatted and not touched).
- `jest apps/catalog/src`: 2 suites, 82 tests pass. The route-by-role matrix is now route-by-permission (20 routes: every listed permission passes, an unrelated permission, no permission, `manager`/`cashier`/`viewer` names without permissions get 403, owner passes; 401 and no-store 403 kept).
- Integration (`jest-int.json apps/catalog/test`, Postgres on 25481, container removed): 1 suite, 12 tests pass. No AuthUser literals existed in catalog.
