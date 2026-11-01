# Phase 6: M7 insight replaces our insight service

Decision of the repo owner: dhtphu05's M7 (`apps/insight`, ADR-0021) replaces our insight. Same conversion policy as
phases 2-4 (permissions, branch scope, integer VND, additive, their routes and shapes kept). Four commits after the
rebase: ADR renumber, port, conversion, events; then the tests.

## What replaced what

- **Kept from M7:** modules, consumers, domain, projections, rebuild, reconciliation, exports, migration `1791900000300`.
- **Removed of ours:** `sales-summary/*` (handler, `daily_sales`, hourly, product, customer read models), `reports/*`,
  `insight-query.service.ts`, `insight.controller.ts`, migration `1792000000100`, the `daily_sales` table (also dropped
  from `1791800000100` and the RLS line of M7's migration; nothing is deployed, reset the local volume).
- **ADR:** theirs is now `0021-insight-m7-...` (index lists 0019 to 0021, references fixed in CLAUDE.md, their docs, code).

## Routes (service path, permission)

| Route                                                                                                         | Permission                           | Origin                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| GET `/api/v1/audit-logs`                                                                                      | reports.view                         | ours (kept, `AuditQueryService`)  |
| GET `/api/v1/dashboard/kpis`, `sales-summary/hourly`, `by-channel`, `top-products`, `attention-items`         | dashboard.view                       | ours, now over the M7 order facts |
| GET `/api/v1/sales-summary/daily`, `by-branch`, `reports/export`                                              | reports.view                         | ours, same                        |
| GET/POST notifications (`notifications`, `unread-count`, `read-all`, `:id/read`), POST/DELETE `device-tokens` | none (every member)                  | ours (kept)                       |
| GET `/api/v1/insight/dashboard/{overview,revenue-trend,top-products,channel-breakdown}`                       | dashboard.view                       | M7                                |
| GET `/api/v1/insight/reports/**` (sales x6, inventory x5, gross-profit x3, branches x2)                       | reports.view                         | M7                                |
| POST/GET `/api/v1/insight/export-jobs`, GET `:id`, `:id/download`                                             | reports.view                         | M7                                |
| GET `/internal/v1/insight/projections/status`, `projections/rebuild/:id`, `reconciliation-runs[/:id]`         | settings.view + `x-internal-token`   | M7                                |
| POST `/internal/v1/insight/projections/rebuild`, `reconciliation-runs`                                        | settings.update + `x-internal-token` | M7                                |

No new permission codes. Branch scope: a branch outside the token is 404 (dashboard, reports, comparison `branchIds`,
export create, export job read/download); lists without a branch are filtered; an empty scope sees nothing (the M7
filter treated `[]` as unrestricted, fixed). `@AllowedBranches()` replaces the `x-allowed-branches` header helper.

## Ported from ours / dropped

- **Ported:** audit log (+ purchase order approvals), notifications and read state, device tokens, attention feed (now
  fed by `inventory.stock.below_min`, `integration.external_order.mapping_required`, `integration.sync_job.failed`),
  the screen routes above (KPIs "same time yesterday", hourly, by channel, top products by SKU, by branch with
  `branchName` from the branch dimension, daily with `groupBy=day|day_channel`, CSV export). Notification tables got
  tenant RLS. Their shapes are unchanged; `by-branch.branchName` and top-products `productId` are now filled.
- **Dropped:** the duplicate read models and handler; M7 route shapes were not changed except money numbers below.

## Money (integer VND)

Money columns of the baseline migration are `bigint` with `moneyTransformer` (`common/money.ts`, same contract as
sales); quantities, `low_stock_threshold` and the reconciliation issue values stay `numeric(18,4)` (issues mix counts
and money). Lines are rounded half up to whole VND at creation (price x fractional quantity, cost, discount
allocation, return prorating); every summary delta is then an integer. Reports, growth metrics (`current`, `previous`,
`delta`, `growthPct` are now numbers), exports, reconciliation values and AOV answer JSON numbers. No money in request
DTOs (queries only). Raw SQL uses `qualifiedTable`; no `search_path`.

## Event mapping (consumer fixed, producers untouched)

| Event as emitted                                                                                               | Fix                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales.order.completed` (`channel`, `costAmount`, `items.variantId`)                                           | channel upper-cased to the channel type; order cost spread over lines by subtotal share (`normalizeOrderEvent`); cost lookup by variant id too |
| `sales.order.created/confirmed/cancelled`, `checkout.completed` (lifecycle)                                    | unchanged, status inferred from the event type, replays are no-ops                                                                             |
| `sales.return.completed` (no lines)                                                                            | proportional path over the order facts, whole VND per line                                                                                     |
| `inventory.stock.changed` (variant id as `skuId`, no branch)                                                   | SKU code resolved from the variant cache; branch learnt from `below_min` (else the warehouse id stands in)                                     |
| `stock.received/issued`, `transfer.dispatched/received`, `stocktake.adjusted` (document events, no stock line) | no longer move stock (they created an `UNKNOWN-SKU` row); checkpoint only                                                                      |
| `reservation.confirmed/released/expired`                                                                       | adjust `reserved_qty` (no stock.changed reports it)                                                                                            |
| `reservation.committed`                                                                                        | checkpoint only: `stock.changed SALE_COMMIT` already carries it (was counted twice)                                                            |
| transfer receipt                                                                                               | clears the in-transit stock the dispatch left at the source warehouse                                                                          |
| `customer.group.changed`                                                                                       | only the group changes (it overwrote code, name, metadata with a version-999 hack)                                                             |
| `customer.deactivated`                                                                                         | now handled (status in the cache)                                                                                                              |
| `finance.receivable.payment_applied` (cumulative `paidAmount`)                                                 | debt collected = growth since the last event; cash comes from `cashbook.entry_posted` (was double counted)                                     |
| `inventory.purchase_order.approved`                                                                            | audit log row                                                                                                                                  |

Queue: `insight-events` is provisioned by `PblEventsModule` from the topology (no insight-specific registration).
`TOPOLOGY.subscriptions.insight` is cut to the 37 events a handler reads (was ~70, the rest were dropped with a warning);
`inventory.stock.below_min` was emitted but absent from the topology: added as inventory producer and insight subscriber.

## Gateway and compose (parent)

Existing routes (audit, kpis, sales-summary x5, attention, reports/export, notifications x4, device-tokens x2) stay.
New, to declare in `krakend.json` (`/insight` + service path, protected, `no-op` encoding), all GET unless stated:
`/api/v1/insight/dashboard/{overview,revenue-trend,top-products,channel-breakdown}` (dashboard.view);
`/api/v1/insight/reports/sales[/by-branch|by-channel|by-employee|by-product|by-customer-group]`,
`/reports/inventory[/low-stock|slow-moving|valuation|movements]`, `/reports/gross-profit[/by-product|by-branch]`,
`/reports/branches/{comparison,ranking}`, `/export-jobs`, `/export-jobs/{id}`, `/export-jobs/{id}/download` (binary,
keep `no-op`), POST `/export-jobs` (reports.view). Internal routes are **not** exposed. Compose env for `insight`:
`INTERNAL_S2S_TOKEN: ${INTERNAL_S2S_TOKEN:-local-dev-internal-token-change-me}` (the operator routes fail closed
without it). Local DB must be reset (`docker compose down -v`): baseline migrations were edited in place.

## Deferred

Branch of stock rows needs `branchId` on `inventory.stock.changed` (producer change, out of scope): scoped users see
inventory reports only for warehouses learnt from `below_min`. Export jobs are not owner-bound, only branch-scoped.
Report date params are not validated by DTOs (a bad date is a 500, as in M7). Multi-allocation receivable payments
count the primary receivable only. M7 route DTO validation, XLSX/PDF content and the benchmark were not reworked.

## Decisions to review

1. `dashboard.view` for `/insight/dashboard/*`, `reports.view` for reports and exports (not one code for all).
2. Operator routes need `settings.view`/`settings.update` plus the internal token plus a user token.
3. Growth metrics and AOV changed from strings to numbers; reconciliation issue values are numbers, but the
   `insight.reconciliation.discrepancy_detected` event keeps strings (now whole numbers).
4. Screen reads date an order by completion in UTC+7 (M7 facts keep the first-event day in `date_bucket`).
5. Cost "known" = verified and non-zero (an order without `costAmount` and without stock cost shows no profit).

## How verified

`tsc -p apps/insight/tsconfig.app.json`, `jest apps/insight/src` (183 passed: permission matrix of 32 routes, internal
token, branch scope, domain, handlers, money, `normalizeOrderEvent`), `eslint apps/insight libs`, `prettier --check`,
integration on a throwaway Postgres (19 passed: M7 scenarios A-T on bigint, branch scope, real event shapes, migrations
undo/redo). Container removed afterwards; the running stack was not touched.
