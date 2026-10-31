# customer: first-wave report

## 1. Built

All routes are under `/customer/api/v1` at the gateway (service path `/api/v1/...`). Roles: view = owner, manager, cashier; create/PATCH customer and addresses = all three (contract: cashier may create/update customers); delete, loyalty adjustments, groups create/rename, tag create, settings update = owner, manager.

| Method              | Path                                    | Status vs contract                                                                                                               |
| ------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| GET                 | /customers                              | changed: filter `groupCode` (csv, contract `group`), `tagId`, `spendMin/Max`, `status`; sort whitelist adds `name`, `orderCount` |
| GET                 | /customers/summary                      | changed: `returningRate` and `returningRateDelta` are `null` (need sales orders per month)                                       |
| GET                 | /customers/export                       | as contract (CSV, UTF-8 BOM, max 10,000 rows, formula-injection neutralised)                                                     |
| POST                | /customers                              | as contract (201; addresses[], tagIds[], member card via `loyalty.enabled`, `initialPoints`)                                     |
| GET, PATCH, DELETE  | /customers/{id}                         | as contract (soft delete 204); PATCH also takes `status`, `loyalty.enabled` (card on request)                                    |
| POST, PATCH, DELETE | /customers/{id}/addresses[/{addressId}] | new (nested); POST/PATCH answer the whole customer                                                                               |
| GET                 | /customer-groups                        | as contract (4 defaults seeded lazily)                                                                                           |
| POST, PATCH         | /customer-groups[/{id}]                 | as contract; DELETE deferred                                                                                                     |
| GET, POST           | /customer-tags                          | as contract                                                                                                                      |
| GET                 | /customers/{id}/loyalty-transactions    | changed: types `earn                                                                                                             | redeem | adjust` only |
| POST                | /customers/{id}/loyalty-adjustments     | as contract (201 `{transaction, balance}`, U005 below zero)                                                                      |
| GET, PATCH          | /loyalty-settings                       | as contract                                                                                                                      |

Migration `1792000000000-create-customer-tables` (reversible): `code_sequence`, `customer_group`, `customer`, `customer_tag`, `customer_tag_link`, `customer_address`, `loyalty_transaction`, `loyalty_setting`. Customer carries the denormalised `order_count`, `total_spent`, `last_purchase_at` and `points_balance` (CHECK >= 0, so there is no separate LoyaltyAccount table).
Events consumed: `sales.order.completed` (order totals + earn points, in the inbox transaction). Produced: none.
Error codes (letter U per the wave rules; contract C00x renamed): U001 phone taken, U002 invalid address, U004 tag name taken, U005 negative balance, U006 unknown group/tag, U007 group name taken. (U003 unused: no debt data.)

## 2. Deferred

- Import (`/customers/import`, template): asked to defer.
- `DELETE /customer-groups/{id}`: not in scope; needs a "move customers" rule.
- Events `customer.customer.created/updated`: contracts of the payloads and the sales projection do not exist yet.
- `sales.order.returned` reversal and `expire`/`reverse` loyalty types: the return event does not exist.
- `currentDebt`, `debtLimit` (finance data), `tier` (no membership tiers): returned as `null`.
- Redeeming points: no consumer; `redeemValuePerPoint` and `pointsExpireMonths` are stored only.

## 3. Decisions to review

1. Phone is shown only to owner and manager; cashier gets `phone: null` + `phoneMasked`, also in the export and after create/PATCH. The contract says "customers.update", but the wave rules give cashiers update, which would defeat masking (open question 6).
2. `phone` is required, normalised (spaces, dots, dashes stripped, 8-15 digits, optional +) and unique per tenant among non-deleted customers (partial index). Duplicate = 409 U001 (aligned with the other services on 2026-10-31; the contract said 400); the existing id is returned as `details: [{ existingCustomerId }]` because the shared filter copies only lists.
3. Summary `members` = customers in group `member` (matches the contract's example), `vip` = group `vip`, `newThisMonth` by the Asia/Ho_Chi_Minh calendar month, `month=YYYY-MM` optional.
4. Default group on create/PATCH-less create = `retail`. A foreign group or tag id = 400 U006 (not 404).
5. Incomplete address is a 422 (DTO), not 400 U002; U002 is used for two default addresses and for un-defaulting the only default. The first address is the default; deleting the default promotes the oldest remaining.
6. Loyalty setting is created lazily with `enabled = true`, 10,000 VND per point (contract has no default); earn = floor(total / amountPerPoint).
7. Order-completed handler ignores orders with no `customerId`, an unknown or other-tenant customer, or a soft-deleted one. A repeat of the same order (should not pass the inbox) fails on the unique `(tenant, type, ref)` index and rolls back.
8. Member code `TV000001` and customer code `KH000001` come from `code_sequence(tenant_id, key, value)`; the number is not reused after a rolled-back create.
9. `POST /customers` with `loyalty.enabled=false` creates no card; PATCH never removes a card.
10. Group codes of custom groups are slugs of the name (`khach-quen`, `-2` on collision); names are unique per tenant, case-insensitive.
11. Lists/CSV treat `%` and `_` in `q` literally. The sort puts never-purchased customers last in both directions.

## 4. Needs from shared files

- krakend: the 19 routes in `scratchpad/routes/customer.json` (compact form). Fixed paths `summary`/`export` are declared before `{id}` in the controller; KrakenD matches them as distinct endpoints.
- compose/topology: nothing further (DB, events env and `customer: [sales.order.completed]` already applied).
- `pnpm test:int` for customer runs `apps/customer/test` (jest-int root already added).

## 5. How to verify

- `pnpm exec tsc -p apps/customer/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest apps/customer/src --maxWorkers=2`: 3 suites, 72 tests pass (permissions matrix for every route, validation, routing order, masking, month maths).
- `EVENTS_IT_DB_PORT=<port> pnpm exec jest --config libs/events/test/jest-int.json apps/customer --maxWorkers=1` against a throwaway pgvector pg17: 24 tests pass (migration down/up, codes, phone uniqueness incl. race, groups seeding, addresses, filters/sort/summary/export, loyalty incl. concurrent deductions and the CHECK, order-completed consumer, cross-tenant isolation).
- `pnpm exec eslint apps/customer` and `prettier --check`: clean.
- The event bus itself (inbox, SQS) was not booted; the handler is tested through its service method.
