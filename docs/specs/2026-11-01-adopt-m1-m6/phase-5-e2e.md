# Phase 5: end-to-end demos on the current API

Scope: `scripts/demo-first-wave.sh`, `demo-rbac.sh`, `demo-events.sh` rewritten for the adopted M1-M6 stack (gateway only,
integer VND, permissions, branch scope), plus the bug fixes below in `apps/sales`. No git state changed.

## Scripts and assertion counts

All three: bash + curl + jq (+ Docker for projection waits and the DLQ check), one fresh owner and store per run, every
step asserted, exit non-zero on the first failure. Same helpers as before (`http`, `expect_status`, `expect_eq`,
`expect_true`, `wait_for`, `count_is`, `get_is`); the final line prints the number of checks passed.

| Script | Checks | Covers |
|---|---|---|
| `demo-first-wave.sh` | 264 | owner + second user, store, branch, warehouses; platform (context, members, lock/unlock, password, sessions, branch settings, schedules, lockout); catalog (category, brand, attribute, product, variants at integer VND, picker, summary, export, lookup, 409/422/400); customer (seeded groups, loyalty settings, tags, customer, masked phone, adjust points); inventory (receipt draft -> submit -> reject -> submit -> approve, cancel, stock levels/summary/lookup/export/ledger, threshold -> below_min, supplier, PO create/approve/receive, directory, summary); sales (channels, providers, registers, shift, POS checkout with change, replay, 409 stock, manual order with pack/ship/complete, partial and final payment, cancel releases stock, list/summary/print/export, close shift); events (customer totals and points, insight daily/by-channel/KPIs/top products, finance cash account, cashbook receipt/expense, receivable and its payment, notifications, device tokens, no failed outbox row) |
| `demo-rbac.sh` | 178 | permission catalog (42 applicable, 12 modules), five seeded roles and their immutability, custom roles, token claims (`roles`, `perms`, `branches`), allowed vs 403 in every service incl. finance, gateway 404 for the internal routes, branch scope 404 and filtered lists as a one-branch clerk, role change (old token keeps claims, new sign-in gets new ones, refresh), sales_staff / accountant / warehouse_staff / branch_manager / owner matrices, phone masking (detail string, list `phone: null`, export), legacy `manager`/`cashier` input, no self-grant |
| `demo-events.sh` | 85 | branch events -> sales + inventory projections; catalog variant + price events -> sales/inventory projections; membership granted / login / role changed -> insight audit log; stock: receipt approval -> `inventory.stock.received` published, POS sale holds then commits, manual order hold -> fulfilment commit, cancel releases; `sales.order.completed` -> insight (daily, by channel, KPIs), customer (orders, spend, points), finance (cashbook receipt from the payment); outbox failed = 0, every consumer inbox filled, all five DLQs empty |

## Bugs found and fixed

1. **sales -> inventory reservation always failed with 400 (`apps/sales/src/inventory/inventory.client.ts`).** The warehouse
   routes `/internal/v1/reservations*` are `@Public()` behind `x-internal-token`, so inventory cannot read the tenant from the
   forwarded bearer token and answers `MISSING_TENANT_CONTEXT`; sales sent no `X-Tenant-Id`. Every checkout and every
   confirm answered 503 S005 / `STOCK_RESERVATION_UNKNOWN`. Fix: the five `/internal/v1/*` calls pass
   `{ asService: true, tenantId: TenantContext.current() }` to `InternalHttpClient` (the header counts only after the token is valid).
   The 400 body is now part of the thrown error message. Regression test: `inventory.client.spec.ts` ("names the tenant on the warehouse routes").
2. **Reservation and return lines were keyed by SKU code, not variant id (`checkout.service.ts`, `m3-orders.service.ts`,
   `returns.service.ts`).** Inventory's `sku_id` is the catalog variant UUID and validates it (`INVALID_SKU_ID`). New helper
   `inventoryStockKey(variantId, skuCode)` (`apps/sales/src/inventory/stock-key.ts`, spec `stock-key.spec.ts`); the SKU code stays only as the
   fallback for a line without a variant. Legacy `OrdersService` already used the variant id.

Verified: `tsc -p apps/sales/tsconfig.app.json --noEmit` clean, `jest apps/sales/src` 13 suites / 404 pass, eslint and prettier clean on the
touched files, sales container rebuilt (`docker compose up -d --build sales`), the three demos pass. Not run: `apps/sales/test` integration
specs (need a throwaway Postgres; they stub inventory and do not assert `skuId` values).

## Gaps found

- **`docker-compose.yml`, service `catalog`, has no events env (outside this task's edit scope).** Its outbox relay defaults to SNS and fails
  with "Could not load credentials", so no `catalog.*` event is ever published: sales answers `PRICE_NOT_CONFIGURED` 404 for any new variant, and
  inventory/insight never learn SKUs. Add to `catalog.environment` (as the other services) and `depends_on: elasticmq`:
  `EVENTS_TRANSPORT: sqs-direct`, `AWS_REGION: ap-southeast-1`, `AWS_ENDPOINT_URL_SQS: http://elasticmq:9324`, `AWS_ACCESS_KEY_ID: local`,
  `AWS_SECRET_ACCESS_KEY: local`. For these runs the catalog container was recreated with an override file kept outside the repo;
  until the compose change is committed, a plain `docker compose up --build` (and `verify-local-stack.sh`) puts it back to the broken state.
- `POST /orders/omnichannel` ignores the `Idempotency-Key` header: only `(sourceConnectionId, externalOrderId)` replays. A retried manual order
  creates and reserves twice. Demo uses the external pair.
- `costAmount` and `grossProfit` stay null in insight: the sales catalog projection carries no unit cost, so `unit_cost_snapshot` is 0 (phase 4 note).
- A first-generation `GET /orders` and customer detail keep `phone` as the masked string `099***6555`; only the new `data` rows and exports use `phone: null`
  plus `phoneMasked`. The real number never appears for a member without `customers.update` (asserted).
- Customer totals and loyalty use the eligible net spend: shipping is excluded (410000 order -> 390000 spent, 39 points). The customer projection
  stores `channel_type = POS` for a manual order (insight gets the right channel from the event).
- An unknown `branchId` on `stock-levels` for an unrestricted member answers 200 with no rows (404 only for a branch outside the member's scope).
- Delivered but unpaid manual orders stay `confirmed` until the last payment completes them (phase 4 decision 2); `sales.order.shipped` has no subscriber.
- Endpoint status quirks the demos pin: receipt submit/approve/reject, PO approve/receive, threshold upsert and shift close answer 200 (not 201).

## How to run

```bash
docker compose up -d --build            # once; catalog needs the env above
bash scripts/demo-first-wave.sh         # ~1.5 min, "First-wave demo complete: 264 checks passed."
bash scripts/demo-rbac.sh               # ~1 min,   "RBAC demo complete: 178 checks passed."
bash scripts/demo-events.sh             # ~1 min,   "Demo complete: 85 checks passed. ..."
```

Gateway port via `GATEWAY_HOST_PORT` (default 8080). The scripts use `docker compose exec postgres psql` for projection waits, so run them
from the repo root. After a service rebuild wait for its `/health` first; projection waits retry for 30 s.
