# Reconciliation: shared layer (libs, infra, gateway, ADRs, platform, insight)

Compared: MINE = `feat/rbac-permissions` (/home/truong/Code/PBL6/pbl-api), THEIRS = `refs/pr/17` (wt17), base 09dbeb0.
Textual conflicts come from `git merge-tree --write-tree --name-only refs/pr/17 feat/rbac-permissions` (read-only).
"Not verified" = read from code, never compiled or run.

## 1. libs/auth

| Item | Mine (1.1.0) | Theirs (no version bump) |
|---|---|---|
| Token claims | `perms`, `branches` read into `AuthUser.permissions/branches` (`libs/auth/src/access-token.verifier.ts`); missing `perms` = `['*']` for owner, else `[]` | none; relies on `roles` only |
| Decorator | `RequirePermission(...codes)` on new metadata `REQUIRED_PERMISSIONS`; `@AllowedBranches()`; helpers `hasPermission/canAccessBranch/allowedBranches` | `Permissions(...)` is `SetMetadata(REQUIRED_ROLES, ...)`: an alias of RequireRoles, not a separate check; `CurrentContext` param decorator + `AuthenticatedContext` type |
| Guard | `hasPermission(user, ...codes)` after roles | `hasRoleOrPermission()` in `auth.guard.ts`: hard-coded rules. `finance.*`: owner/accountant/manager pass, cashier only 7 listed codes. `integration.*`: owner/manager pass, cashier only 6 `*.read` codes. Any other string: exact role match only |
| Role names | `owner, branch_manager, sales_staff, warehouse_staff, accountant`; `ROLES.MANAGER/CASHIER` kept `@deprecated` (`libs/contracts/src/events.ts`) | uses `ROLES.OWNER/MANAGER/CASHIER` (`manager`, `cashier`) |

Textual: `auth.guard.ts` and `auth.types.ts` auto-merge; `auth.decorators.ts` CONFLICT (3 hunks, both add exports).
Semantic conflict (hardest): my platform signs `roles: [membership.role]` (`apps/platform/src/api/auth/auth.service.ts:428`) and seeded roles are `branch_manager`/`sales_staff`.
Their 74 `RequireRoles(OWNER, MANAGER)` and 84 `RequireRoles(OWNER, MANAGER, CASHIER)` (plus 5+4 with `'accountant'`) match on the literal roles `manager`/`cashier`, so a `branch_manager` or `sales_staff` gets 403 on all of them.
Their guard's `normalized.has('manager'|'cashier')` fails the same way. CLAUDE.md says "Never check a role name in a service".
Reconcilable: yes. Replace every `RequireRoles(...)`/`Permissions(...)` in their services with `RequirePermission('<module>.<action>')`, delete `hasRoleOrPermission` and the `Permissions` alias, keep `CurrentContext` (additive, no conflict). Interim: `@RequireRoles` in my guard could normalize via `normalizeRoleCode` (not implemented; a stopgap only).

Their service counts (grep, `@RequireRoles(` / `@Permissions(` lines excluding specs): catalog 36/0, inventory 40/0, sales 13/0, customer 39/0, finance 60/0, integration 0/27, insight 1/0.

### Their permission strings and mapping onto my catalog
My catalog (`libs/contracts/src/permissions.ts`): modules dashboard, products, inventory, orders, pos, channels, customers, purchasing, staff, reports, settings; actions view/create/update/delete/approve.
Distinct strings in their code (grep of `'finance.*'`/`'integration.*'` literals in `apps`; the `*.created`-style names are event types, not permissions):

| Their string | Used by | Maps to | New? |
|---|---|---|---|
| `finance.cashbook.read` / `.create` | finance | `finance.view` / `finance.create` | module `finance` |
| `finance.receivable.read` / `.collect` | finance | `finance.view` / `finance.create` | `finance` |
| `finance.credit.read` | finance | `finance.view` | `finance` |
| `finance.refund.process` / `.approve` | finance | `finance.update` / `finance.approve` | `finance` |
| `finance.shift.reconcile`, `finance.cod.reconcile`, `finance.settlement.reconcile` | finance | `finance.approve` (or new action `reconcile`) | `finance` (+ optional action) |
| `finance.adjustment.approve` | finance | `finance.approve` | `finance` |
| `finance.report.read` | finance (13) | `reports.view` | no |
| `integration.connection.read`, `mapping.read`, `order_sync.read`, `conflict.read`, `jobs.read`, `reconciliation.read` | integration | `channels.view` | no (reuse `channels`) |
| `integration.connection.create` | integration | `channels.create` | no |
| `integration.connection.manage`, `mapping.manage` | integration (7) | `channels.update` | no |
| `integration.connection.disconnect` | integration | `channels.delete` | no |
| `integration.conflict.resolve` | integration | `channels.approve` | no |
| `integration.order_sync/product_sync/inventory_sync.execute`, `jobs.retry`, `reconciliation.execute` | integration | `channels.update` | no |
| catalog pricing, promotions, loyalty | no string exists: guarded by `RequireRoles(OWNER, MANAGER[, CASHIER])` | pricing -> `products.update`; loyalty -> `customers.update`; promotions: no module (add only if Figma needs it, not verified) | open |
| other catalog/inventory/sales/customer routes | `RequireRoles` | owner+manager only -> `<module>.update/approve`; owner+manager+cashier -> `<module>.view/create` | no |

Catalog additions needed: module `finance` (view, create, update, approve; optionally `reconcile`), grants for `accountant` (finance.*, reports.view) and `sales_staff` (finance.view/create to replace their cashier subset); everything else fits existing modules. Their finance cashier subset also lets cashiers refund (`refund.process`); decide whether `sales_staff` gets `finance.update`.

## 2. libs/common (theirs only; mine did not touch it)

| Change (files under `libs/common/src`) | Detail | Back-compat |
|---|---|---|
| `tenancy/tenant-scoped.repository.ts` | new `setLocalTenantContext`, `runInTenantTransaction`; `transaction()` now runs `SELECT set_config('app.tenant_id', $1, true)` when a tenant is active and `em.query` exists | yes (no-op without tenant/`query`); extra query per transaction |
| `tenancy/tenancy.module.ts` | alias `InjectTenantRepository` | yes |
| `health/pbl-health.module.ts` | `GET /health/live`, option `database: true` (SELECT 1 in `/health/ready`), swagger tags | yes (opt-in) |
| `errors/*` | optional `traceId` in `ErrorResponse` (from RequestContext or `X-Trace-Id`) | yes, additive field |
| `bootstrap/bootstrap-service.ts` | `rawBody: true`, richer swagger title, Swagger also served at `api/docs` as well as `api-docs` | yes (rawBody for webhooks) |
| `bootstrap/architecture-boundaries.spec.ts` | new, see section 5 | n/a |
| `libs/common/package.json`, `CHANGELOG.md` | 1.1.0 | n/a |

No RLS or DB role switch happens in the repository itself: it only sets the GUC. My code is unaffected: no textual conflict in `libs/common`; my raw SQL (insight `reports.service.ts`, `sales-summary.handler.ts`, inventory `stock.service.ts`, `reservations.service.ts`, `ledger.service.ts`, customer, catalog) keeps working as long as services connect as `postgres`.
`libs/events` extras: `EventOutbox.enqueue()` wrapper, SQS client `useQueueUrlAsEndpoint:false` when `AWS_ENDPOINT_URL*` is set, `docker/elasticmq.conf` host `"*"`. All additive; only `libs/events/test/jest-int.json` conflicts (test roots list, union both).

## 3. libs/events and libs/contracts

Textual: `events.ts` auto-merges but yields invalid TS. `OrderCompletedPayload` ends with `customerId` declared twice (theirs adds `customerId`, `subtotal`, `discountTotal`, `taxTotal`, `grandTotal`; mine adds `channel`, `customerId`, `costAmount`). Verified in the merge-tree result. `ROLES` merges fine (`@deprecated` comments only). `topology.ts` and `topology.spec.ts` CONFLICT. `index.ts` no conflict.
Existing payload changes by theirs: only `OrderCompletedPayload` (+5 optional fields, backward compatible). All other additions are new.

New event types in theirs (`events.ts` +821). All are `version: 1`; `producer -> consumers` from `topology.ts` (consumers by service; insight subscribes to nearly everything):

| Producer | Events | Consumers |
|---|---|---|
| catalog | `catalog.product.created/updated/deactivated`, `catalog.variant.created/updated/deactivated`, `catalog.price.changed` | sales, inventory (variant events; not verified which list), integration, insight |
| inventory | `inventory.reservation.confirmed/committed/released/expired`, `inventory.stock.changed/received/issued`, `inventory.transfer.dispatched/received`, `inventory.stocktake.adjusted`, `inventory.purchase_order.approved` | sales (reservation.*), finance (po.approved, stock.received), integration (stock.changed, reservation.*, transfer.received, stocktake), insight |
| sales | `sales.order.created/confirmed/cancelled`, `sales.checkout.completed/reconciliation_required`, `sales.tender.recorded`, `sales.payment.confirmed`, `sales.return.created/approved/completed`, `sales.refund.requested`, `sales.shift.opened/closed`, `sales.fulfillment.completed` (plus existing `sales.order.completed`) | customer (completed, checkout.completed, cancelled, return.completed), finance (completed, checkout, tender, payment, return.completed, refund.requested, shift.closed, fulfillment), integration (confirmed, cancelled, completed, fulfillment), insight |
| customer | `customer.created/updated/deactivated`, `customer.group.changed`, `customer.membership.changed`, `customer.loyalty.points.earned/redeemed/reversed`, `customer.loyalty.hold.created/committed/released/expired` | finance (created/updated/deactivated), insight (all but holds) |
| finance | `finance.cashbook.entry_posted`, `finance.receivable.created/payment_applied`, `finance.payable.created/payment_applied`, `finance.credit.authorized/committed/released`, `finance.payment.settlement_confirmed`, `finance.refund.completed/reconciliation_required`, `finance.cod.settlement_reconciled/discrepancy_detected` | customer (receivable.*), insight |
| integration | `integration.connection.connected/disconnected/reauth_required`, `integration.sku_mapping.created/updated`, `integration.external_order.received/imported/mapping_required/sync_failed`, `integration.inventory.publication_succeeded/failed`, `integration.sync_job.completed/failed`, `integration.reconciliation.discrepancy_detected` | insight |

Overlap with mine: both add `customer` as a subscriber of `sales.order.completed` (identical intent, theirs is a superset). Mine adds nothing else to topology. Theirs relaxes `topology.spec.ts` to `arrayContaining`, mine adds exact `'customer'` to the old exact list; take theirs.

Merge plan:
1. `events.ts`: take theirs, then in `OrderCompletedPayload` keep ONE `customerId?: string | null`, keep theirs' money strings, append my `channel?` and `costAmount?`. Keep my `ROLES` `@deprecated` comments.
2. `topology.ts`: take theirs wholesale (its `customer` block already contains `SALES_ORDER_COMPLETED`); drop my one-line `customer: [SALES_ORDER_COMPLETED.type]`. Check my insight consumers (notifications, sales-summary) are still subscribed to the types they handle.
3. `topology.spec.ts`: theirs. `permissions.ts`/`index.ts` export of mine stays (no conflict).
4. Add `OrderCompletedPayload` producers: their sales emits it without `channel`/`costAmount` (optional, fine); decide who fills them.

## 4. Database isolation (ADR-0019 theirs, `docker/postgres-init-schemas.sql`)

| Aspect | What theirs does |
|---|---|
| Roles | init script creates `<svc>_app` for 8 services (platform, catalog, inventory, sales, customer, finance, integration, insight): LOGIN, password = role name, NOSUPERUSER, NOBYPASSRLS; `search_path` = own schema |
| Grants | REVOKE ALL on each schema from PUBLIC and from other `_app` roles; own schema: USAGE, table DML, sequence USAGE/SELECT/UPDATE, default privileges. Also `CREATE EXTENSION pgcrypto` |
| RLS | helpers `enableTenantRlsPolicy` (ENABLE + FORCE, policy `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`, fail-closed) and `provisionServiceRole` in `libs/events/src/database/pbl-database.module.ts`; used in their M1-M6 core migrations (`1791900000200-create-*`) for sales, inventory, customer, finance, integration, catalog. Outbox/inbox tables exempt |
| Connection | NOT wired: `docker-compose.yml` is unchanged by theirs and every service still uses `DATABASE_USERNAME: postgres` / `DATABASE_PASSWORD: postgres`. Superusers bypass RLS even with FORCE, so today RLS and role grants have no runtime effect. No per-service credentials, env vars unchanged (`DATABASE_*`) |
| CLAUDE.md target ("each service connects with its own Postgres role", line 408) | script and ADR provide the roles; connection switch is missing. Matches target once compose/env use `<svc>_app` |

Requirements if the switch is made (not verified by running):
- Plain `TenantScopedRepository.find/save` outside `transaction()` do NOT set `app.tenant_id`, so under `_app` + FORCE RLS they return zero rows or fail the CHECK. Every query path (HTTP handlers and event consumers) must run inside `runInTenantTransaction`/`transaction()`; my code (raw `.query()` in insight, inventory, customer, catalog services listed in section 2) does not, and would break on their RLS tables.
- Migrations need DDL rights: `_app` roles are not owners and lack CREATE on schema, but `PblDatabaseModule` runs `migrationsRun: true`; migrations must run as owner (separate migration role) or the role needs CREATE. Their ADR is silent.
- My migrations (first wave, RBAC in platform) would need `tenant_id uuid` and RLS statements too, or be exempt by decision. Platform uses its own TypeORM (`apps/platform/src/utils/modules-set.ts`) and is not on `PblDatabaseModule`.
Recommendation: land roles and helpers now, keep compose on `postgres`, then switch services one at a time after auditing raw SQL. Their ADR-0019 wording "NOLOGIN or LOGIN" is vague, fix when renumbering.

## 5. Gateway, compose, lint boundaries

| Item | Theirs | Mine |
|---|---|---|
| `krakend/krakend.json` endpoints | 233 total (base 41): sales 45, inventory 41, catalog 37, customer 35, platform 27, integration 26, finance 19, insight 3 | 174 (platform 49, inventory 41, catalog 23, sales 23, customer 20, insight 16, finance 1, integration 1) |
| Style | `/<svc>/api/v1/<resource>`, one `auth/validator` (RS256, JWKS from platform) + per-backend `qos/circuit-breaker` per service; finance routes are `/finance/api/v1/finance/...`; integration webhook `POST /integration/webhooks/v1/{provider}/{connectionKey}` is unauthenticated (signature headers, no-op encoding) | same style |
| New plugin/config | none: same plugin `pbl-error-body`, same CORS, same claim propagation (no `perms`/`branches` propagated in either; services verify the JWT themselves) | same |
| Overlap | 90 identical (method, path) pairs; 33 differ only in `input_headers` (mine lacks `Idempotency-Key` on those routes, theirs adds it) | |

`krakend.json` CONFLICT (one file, huge): resolve by union keyed on (method, path), keep theirs' `input_headers` (superset), keep my 84 routes absent in theirs (insight 13, catalog/customer/inventory/sales export/summary/lookup routes, `/roles`, `/permissions`, members). Script it, do not hand-merge. Not verified: that every my-only route has a backend in the merged apps.
Compose/Dockerfile: theirs changed neither (only `docker/elasticmq.conf`, `postgres-init-schemas.sql`); mine changed compose and Dockerfile (4 files incl. 2 demo scripts); no textual conflict. Theirs adds no services to compose (finance/integration may be missing there, not verified).
Lint/boundaries (`eslint.config.mjs`, `libs/common/src/bootstrap/architecture-boundaries.spec.ts`): forbids importing `apps/<other>` or relative paths into another app, `@/*` outside platform, `libs/*` importing `apps/*`, and `libs/common` runtime importing `@pbl/auth`/`@sapoclone/pbl-auth`; requires each of the 8 apps to have `main.ts`, `app.module.ts`, `tsconfig.app.json`. My code passes by reading: grep found no `apps/` imports, no `@/` outside platform, no `@pbl/auth` import in `libs/common/src` (only comments), all 8 apps exist with `tsconfig.app.json`; `eslint.config.mjs` auto-merges (not run).

## 6. apps/platform and apps/insight

| File | Theirs | Mine | Overlap |
|---|---|---|---|
| platform `utils/microservices-openapi.ts` (+4131) + `setup-swagger.ts` | hand-written static OpenAPI of all other services merged into platform Swagger, `servers` incl. gateway :8080 | none | additive; hand-maintained so will drift from controllers (also has text that says insight reads `sales.order.placed`, an event not in `events.ts`) |
| platform `health.controller.ts`, `main.ts` | `GET /health/live`, path exclusion | none | no conflict |
| platform roles/members/context/branch settings/schedules/membership | untouched | 100+ files (role, permission, member, status, sessions, schedules; migrations; i18n) | none |
| insight `insight.controller.ts`, `insight.dto.ts`, `app.module.ts` | only Swagger decorators, `database: true` readiness | dashboards, attention items, notifications, device tokens, reports, sales-summary routes (16 gateway routes) | controller CONFLICT: keep mine, re-apply their `@ApiOperation/@ApiResponse` text if wanted (S) |

## 7. ADR numbering

| # | Mine | Theirs |
|---|---|---|
| 0011 | `0019-store-users-are-accounts` (Proposed) | `0011-rls-and-db-role-isolation` (Accepted) |
| 0012 | `0020-permissions-and-branch-scope` (Proposed) | `0012-warehouse-reservation-and-checkout-workflow` (Accepted) |

Filenames differ, so no file collision; only `docs/decisions/README.md` conflicts and the numbers and references collide. CLAUDE.md, code comments, `docs/guides/permissions.md` and `libs/auth/CHANGELOG.md` cite my ADR-0020 by number.
Proposal: theirs keep 0011-0018 as is (already in their PR stack, referenced by their code and tests); renumber mine to 0019 `store-users-are-accounts` and 0020 `permissions-and-branch-scope`, and grep-replace `ADR-0020`/`0012-permissions` in my tree (CLAUDE.md, libs/auth, libs/contracts `permissions.ts`, platform, specs). Alternative (keep 0011/0012 mine, renumber theirs) costs more: 7 of their files plus references in 6 services.
Their other ADRs: 0013 catalog M1 domain and pricing boundaries; 0014 inventory M2 concurrency and valuation; 0015 sales M3 checkout saga, pricing, POS shifts and returns; 0016 customer M4 CRM, loyalty ledger and holds; 0017 finance M5 journals, receivables/payables, credit, reconciliation; 0018 integration M6 omnichannel webhooks, SKU mapping, sync jobs.

## 8. Compatibility summary

| Shared file | Textual | Semantic conflict | Effort | Winner |
|---|---|---|---|---|
| `libs/auth/src/auth.decorators.ts` | CONFLICT | `Permissions` aliases roles; double mechanism | S | merge: mine + `CurrentContext` |
| `libs/auth/src/auth.guard.ts`, `auth.types.ts` | clean | hard-coded finance/integration role rules vs permission claims; role names `manager/cashier` vs seeded names | M | mine; delete theirs' rules |
| their 190+ `RequireRoles/Permissions` in services | n/a | all fail for `branch_manager`/`sales_staff`/custom roles | L | mine (convert to `RequirePermission`) |
| `libs/contracts/src/permissions.ts` | clean (mine only) | needs `finance` module (+accountant/sales_staff defaults) | S | mine |
| `libs/contracts/src/events.ts` | clean | duplicate `customerId` (compile error) | S | theirs + my 2 fields |
| `libs/contracts/src/topology.ts`, `.spec.ts` | CONFLICT | none after taking superset | S | theirs |
| `libs/common/*` | clean (mine untouched) | RLS GUC only inside transactions | S | theirs |
| `libs/events/src/*` | clean | additive | S | theirs |
| `libs/events/test/jest-int.json` | CONFLICT | none | S | union |
| `docker/postgres-init-schemas.sql` | clean | roles unused until compose switches; my raw SQL not RLS-safe | M (L if switched) | theirs, switch deferred |
| `docker-compose.yml`, `Dockerfile` | clean | finance/integration services in compose not verified | S | mine + add services |
| `krakend/krakend.json` | CONFLICT | 33 differing headers; my-only routes | M (script) | union, theirs headers |
| `eslint.config.mjs`, architecture spec | clean | my code passes by reading | S | theirs |
| `docs/decisions/README.md` | CONFLICT | ADR 0011/0012 number clash | S | both, renumber mine to 0019/0020 |
| platform openapi/health/swagger | clean | static spec drift | S | theirs (optional) |
| `apps/insight/src/insight.controller.ts` | CONFLICT | their Swagger only | S | mine + their decorators |
| `apps/*/src/app.module.ts` (7), orders, inventory stock files | CONFLICT | owned by the per-service reports | see service files | per-service |

Hardest conflict: role/permission model. The merge is textually clean in `auth.guard.ts` but semantically breaks every theirs route for the new roles, so it needs conversion of ~250 decorators plus a `finance` catalog module, not a file merge.
