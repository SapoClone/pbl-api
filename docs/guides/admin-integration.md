# Admin integration ("Tích hợp"): cross-store reads and actions

The platform admin screen 16 reads and acts on marketplace connections (Shopee, Lazada) of every store. The routes live
in **integration** (`apps/integration/src/modules/admin/`), gateway prefix `/integration/api/v1/admin`. The contract is
[04-platform-admin.md](../specs/2026-10-28-api-contracts/04-platform-admin.md) "Integrations (integration)", as
amended by the web team's v1.2 request.

| Method and path | What |
|---|---|
| `GET /connections` | list, `q` over shop and store name, `provider`, `status`, `branchId`, paging, `counts` by status |
| `GET /connections/{id}` | the item plus scopes, token expiry (no token), last syncs, error fields, `stats` |
| `GET /sync-history` | sync jobs of every store: `connectionId`, `tenantId`, `status`, `jobType`, `from`, `to` |
| `GET /webhook-events` | received webhooks: `connectionId`, `provider`, `status`, `from`, `to` (never the payload) |
| `POST /connections/{id}/check` | the health probe now, with a 5 s timeout |
| `POST /connections/{id}/disconnect` | `{ reason }` (1-500), optional `Idempotency-Key` |

All of them are `@RequirePlatformAdmin()` (both `super_admin` and `admin`); a store token gets 403, and an admin token
passes on no store route. Lists answer `{ data, pagination, counts? }`; enums are lowercase snake_case (the store-side
API keeps its upper-case codes). The routes answer 422 for an unknown enum value or a bad date, and the web adapts to the
absence of `environment` and of sync on/off flags (they do not exist in the data).

## How an admin reads across stores (row-level security)

`channel_connections`, `connection_credentials`, `sync_jobs`, `webhook_inbox_events`, `sku_mappings` and
`integration_catalog_variants` use FORCE row-level security keyed on `app.tenant_id`, and the production role is not a
superuser and does not bypass RLS. `TenantScopedRepository` is not widened. Instead (migration
`AddAdminReadAndProjections1793300000000`):

- each of those tables gets a second policy, `admin_read_select_policy`, **`FOR SELECT` only**, that opens when
  `current_setting('app.admin_read', true) = 'on'` (the same pattern as `webhook_routing_select_policy` and
  `sync_job_scheduler_select_policy`);
- `runAsAdminRead` (`apps/integration/src/common/admin-read-context.ts`) opens a transaction and binds the setting with
  `set_config(..., true)`, so it ends with the transaction and cannot leak to another request on the pooled connection;
- only `AdminIntegrationService` calls it, from handlers behind `@RequirePlatformAdmin()`. A write still needs the
  store's own `app.tenant_id`: the policy has no `WITH CHECK` branch and is not `FOR ALL`.

Because RLS works per row and not per column, a policy cannot hide `connection_credentials.encrypted_*` from the admin
transaction. The guard is the code: the admin queries name their columns and never select a token, secret, oauth state,
webhook secret or payload. `admin-integration.int-spec.ts` asserts that none of those keys or values appears in any
response.

`apps/integration/test/admin-integration.int-spec.ts` runs as a provisioned role (not superuser, no BYPASSRLS, owner of
the tables) and proves: (a) the admin context sees every store, (b) a store context sees only its own store, (c) no
context sees nothing and the setting does not outlive its transaction, and that the admin setting alone cannot
write.

## Store and branch names

Integration does not store them, so it keeps two small projections, fed through the inbox (idempotent, an older event is
ignored):

| Table | Fed by |
|---|---|
| `tenant_projection (tenant_id, name)` | `platform.tenant.created`, `platform.tenant.updated` |
| `branch_projection (branch_id, tenant_id, name)` | `platform.branch.created`, `platform.branch.updated` |

They hold platform data and no store-owned content, so (like `tenant_status`) they have no RLS. A store or branch created
before the projection existed has **no row and the API answers `name: null`**. To fill them, re-emit the events from
platform (a tenant rename or a branch update does it per row; a bulk resync for tenants and branches does not exist yet,
the subscription plan one is `POST /admin/subscriptions/resync`). The topology change is in
`docs/specs/2026-11-20-admin-be/topology-integration.md`.

## Check

`POST /connections/{id}/check` calls `ConnectionsService.getConnectionHealth(id, tenantId)`, the same function behind the
store's `GET connections/:id/health` (token expiry, circuit breaker, status). It is in-process and calls nothing at the
marketplace, so it neither changes state nor needs the provider rate limiter; it runs under a 5 s timeout and answers
`status: 'timeout'` if it ever takes longer.

## Disconnect

`ConnectionsService.disconnectConnectionAsAdmin` runs the store's transition (`transitionConnectionState`) for the
connection's own store, found through the admin read path: row lock, status `DISCONNECTED`, tokens wiped,
credential version bumped, audit row, and the `integration.connection.disconnected` event in the same transaction.
Workers and the webhook intake already refuse a `DISCONNECTED` connection, so syncing and webhook handling stop. Synced
orders and SKU mappings are kept (the test asserts the mapping count).

- Already disconnected: **400 `CHANNEL_CONNECTION_ALREADY_DISCONNECTED`** (the store-side `DELETE` still answers 409
  `INVALID_CONNECTION_TRANSITION`).
- `Idempotency-Key` (max 128 chars): kept in the audit row's metadata. A repeat with the same key returns the
  connection with `Idempotency-Replayed: true`, no second event; two concurrent calls take turns on the row lock.
- Event payload: the existing fields plus optional `actor: { type: 'platform_admin', id, name }` and `reason`
  (`IntegrationConnectionEventPayload` in `libs/contracts`); the envelope actor is `{ id, type: 'platform_admin' }`.
  **`actor.name` is `null`**: the admin token carries `sub` but not the name, and reading it would need a call to
  platform or a new claim. If the audit log needs the name, add a `name` claim to the admin token (platform) and read it
  in the controller; nothing else changes.
- The store's own disconnect emits the event as before, without `actor`/`reason`.

## Jobs and webhooks

Job statuses (8) and types (9) and webhook statuses (7) are the stored values, lowercased. `startedAt` falls back to
`createdAt` for a job that has not started. `code` is the job's own code (`JOB-...`).
