# Phase 2: integration (their M6)

## Built

All 28 routes of `apps/integration`; 27 carry `@RequirePermission`, the webhook is `@Public()`. Module `channels`.

| Route | Old string | New code |
| --- | --- | --- |
| POST /connections | integration.connection.create | channels.create |
| GET /connections, /connections/:id, /connections/:id/health | integration.connection.read | channels.view |
| POST /connections/:id/authorize, /refresh, /pause, /resume | integration.connection.manage | channels.update |
| DELETE /connections/:id (disconnect) | integration.connection.disconnect | channels.delete |
| POST /sku-mappings | integration.mapping.manage | channels.create |
| GET /sku-mappings, /sku-mappings/:id | integration.mapping.read | channels.view |
| PATCH /sku-mappings/:id | integration.mapping.manage | channels.update |
| DELETE /sku-mappings/:id | integration.mapping.manage | channels.delete |
| POST /connections/:id/sync/orders | integration.order_sync.execute | channels.update |
| POST /connections/:id/sync/inventory | integration.inventory_sync.execute | channels.update |
| POST /connections/:id/sync/products | integration.product_sync.execute | channels.update |
| GET /sync-jobs, /sync-jobs/:id | integration.jobs.read | channels.view |
| POST /sync-jobs/:id/retry | integration.jobs.retry | channels.update |
| GET /conflicts, /conflicts/:id | integration.conflict.read | channels.view |
| POST /conflicts/:id/resolve, /conflicts/:id/retry | integration.conflict.resolve | channels.update |
| POST /reconciliation-runs | integration.reconciliation.execute | channels.update |
| GET /reconciliation-runs, /reconciliation-runs/:id | integration.reconciliation.read | channels.view |
| POST /webhooks/v1/:provider/:connectionKey | public | `@Public()`, own HMAC verification untouched |

Nothing approves, so `channels.approve` does not exist and is not used (the catalog has none for channels).

**Branch scope.** `channel_connections.branch_id` is required (the connection applies to one branch); `warehouse_id` is
optional and integration has no way to resolve a warehouse's branch, so the connection's own `branch_id` is the scope.
Mappings, sync jobs, conflicts and reconciliation runs reach a branch through `connection_id`.
New `BranchScopeService` (`modules/branch-scope`), used by the controllers (services and business logic unchanged):
- Create connection with a `branchId` outside the scope: 404. Any `:id` route on a connection, mapping, job, conflict
  or run of another branch: 404 (also for `connectionId` in a body or query).
- Lists return only the allowed branches (post-filtered by connection; the 100-row cap of the jobs list applies before
  the filter, so a restricted member may see fewer than 100).
- Rows with no connection (store-wide reconciliation runs, jobs) are hidden from restricted members.
- Reconciliation run without `connectionId` covers every branch: a restricted member gets 403 (needs a connection).
- Webhook ingestion and the background job runner carry no member and are not scoped.

## Hardening done

- (a) Credential key: the hard-coded development key is gone. `readCredentialMasterKey()` throws when
  `INTEGRATION_CREDENTIAL_MASTER_KEY` is unset; `main.ts` runs `assertIntegrationConfig()` before listening (skipped only
  under `NODE_ENV=test`). Tests set their own key.
- (b) Sales client: `SalesOrderClient` is HTTP only and throws without `SALES_SERVICE_URL`. The in-memory maps,
  stock projection check and crash simulation moved to `test/support/in-memory-sales-order.client.ts`
  (`InMemorySalesOrderClient`, tests and benchmark only). `InternalHttpClient` was never provided before (the module did
  not import `PblPropagationModule`, so the old code always used the in-memory path): `IntegrationCoreModule` now imports it
  with `baseURL = SALES_SERVICE_URL`.
- (c) Internal routes: integration exposes none (every route is public-with-signature or user-authenticated), so no
  guard is added.
- (d) The client sends `x-internal-token: $INTERNAL_S2S_TOKEN` and `Idempotency-Key`; outside a request context
  (jobs, webhooks) it calls with `asService`, inside one it also forwards the user's token as before. A failed call
  has the token stripped from the rethrown axios error.
- (e) No secrets in logs: integration logs nothing else; the new warning prints order id and status only; existing
  `redactSensitiveObject` and the credential summary are untouched.

## Deferred

- Sales has no internal route: `POST /api/v1/orders/omnichannel` is a user route (`orders.create`). Calls from jobs and
  webhooks (no user token) will get 401 until sales offers an internal route taking `x-internal-token` plus a tenant
  (the shared client drops `x-tenant-id`; the sales worker must decide the shape). Integration only needs its URL and
  header changed.
- `transitionCanonicalOrderStatus`: sales has only confirm/cancel by id, no marketplace status ingest. It was an
  in-memory stub before; now it changes nothing in sales and logs a warning. Real mapping (READY_TO_SHIP -> confirm,
  CANCELLED -> cancel, shipped/delivered) needs sales endpoints.
- `integration.int-spec.ts` was kept compiling (typechecked) but not run: no throwaway Postgres started.
- Money types and response shapes untouched (rule 3).

## Decisions to review

- `channels.update` for run/retry/resolve/reconcile (per instruction); resolve and retry conflict also `update`.
- Mapping create is `channels.create`, patch `update`, delete `delete` (one old string, three codes).
- Restricted member + reconciliation without connection: 403, not 404 (no branch is named, nothing to hide).
- Branch scope by post-filtering in the controller (smallest change); a SQL filter belongs with the services later.
- Role literal `owner` remains in tests only as the owner token.

## Needs from shared files

Variables for `docker-compose.yml` (integration service) and `.env` examples:
- `INTEGRATION_CREDENTIAL_MASTER_KEY`: any string, at least 32 characters, local value e.g. `dev-only-integration-master-key-change-me-0123`. Required; the service does not start without it. Changing it makes stored credentials unreadable.
- `SALES_SERVICE_URL`: `http://sales:3000` (no trailing slash needed). Required.
- `INTERNAL_S2S_TOKEN`: the same random string on integration, sales, finance, customer and the rest, e.g. `dev-internal-s2s-token-0123456789abcdef`. Required (non-test).
- KrakenD: none; webhook and API routes are unchanged (no route added or renamed).

## Stale statements (docs/progress-report, not edited)

- `M6_API_REFERENCE.md`: every `integration.*` permission (`.manage` on create/disconnect, `.run` for reconciliation,
  `.read`, `.resolve`); lists `GET /integrations/providers` and `POST /connections/:id/refresh-token`, which do not
  exist (code: `POST /connections/:id/refresh`, plus `/pause`, `/resume`, sync, sync-jobs, conflicts retry routes
  missing from the table).
- `M6_INTEGRATION_BASELINE.md` line 50 (RBAC via `@Permissions`), and any mention of a default development
  master key or of the in-memory Sales client as automatic fallback (ADR-0018 / architecture docs).
- Absolute `/Users/mac/...` links in the baseline.

## How verified

- `pnpm exec tsc -p apps/integration/tsconfig.app.json --noEmit`: clean (also a temporary config including `test/`: clean).
- `pnpm exec jest apps/integration/src --maxWorkers=2 --silent`: 5 suites, 63 tests pass (27-route matrix: allowed,
  wrong code 403, other module 403, owner, no token 401; branch-scope; config; sales client).
- `pnpm exec eslint apps/integration`: 0 errors, 2 pre-existing unused-variable warnings in `test/`.
- `pnpm exec prettier --check apps/integration`: clean.
