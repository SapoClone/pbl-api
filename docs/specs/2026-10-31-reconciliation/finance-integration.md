# Profile: `finance` and `integration` (dhtphu05 stack, M5/M6)

Read-only review, 2026-10-31. WT = `/tmp/claude-1000/-home-truong-Code-PBL6/25df95e7-b007-408f-a3ea-a382b0d5d4e9/scratchpad/wt17` (HEAD 4ae2828). Main line and `feat/rbac-permissions`: both are stubs (CLAUDE.md:45). Counts are by grep (`@Get|@Post|...` per controller, `it(` per spec file). Nothing was built or run, so "tests pass" claims in `M5_FINANCE_TEST_RESULTS.md` / `M6_TEST_RESULTS.md` are NOT verified.

## 1. Scope and size

| | finance (`WT/apps/finance`) | integration (`WT/apps/integration`) |
|---|---|---|
| TS lines | 16,654 | 12,568 |
| Routes | 65 | 28 (27 authenticated + 1 public webhook) |
| Route groups | cashbook 10, reconciliation 10, credit-authorization 7 (5 internal S2S), cod 6, journal 6, payables 6, receivables 6, refunds 6, cash-accounts 4, settlements 4 | connections 9, sync-jobs 6, sku-mapping 5, conflicts 4, reconciliation 3, webhooks 1 |
| Tables | 22 (`migrations/1791900000200-create-m5-finance-core.ts`, 892 lines) | 18 (`migrations/1791900000200-create-m6-integration-core.ts`, 574 lines) |
| Migrations | 1 (+ `PRODUCER_/CONSUMER_MIGRATIONS` from `@pbl/events`) | 1 (same) |
| Unit/e2e `it(` | domain 16, e2e 9, architecture 4 = 29 | domain 12, e2e 6, architecture 4 = 22 |
| Int-spec (real Postgres) | `test/finance.int-spec.ts` 13 | `test/integration.int-spec.ts` 10 (docs claim scenarios A-T; grep finds 10 `it(`; unverified how) |
| Benchmarks | `test/performance/finance-benchmark.ts` | `test/performance/integration-benchmark.ts` |
| Features | Double-entry journal with reversal, cash book (approve/post/reverse, CSV export), AR/AP with ledgers, credit limit + hold/commit/release, COD batches, settlements, refunds with approval, shift reconciliation, adjustments, recon runs | Shopee/Lazada adapters, AES-GCM credentials, durable webhook inbox, SKU mapping with versions, order import, stock publication (buffer, %), sync jobs with lease and DLQ, conflicts, reconciliation |

Doc/code mismatches: `M6_TEST_RESULTS.md` says domain 11 / architecture 5 (grep: 12 / 4). `M5_FINANCE_EVENT_CONTRACTS.md` cites `apps/finance/src/consumers/finance-events.consumer.ts`, which does not exist (consumers are `@OnEvent` methods inside services) and lists event names (`finance.journal.posted`, `finance.payable.paid`...) that are not in `libs/contracts/src/events.ts:620-680` (`finance.payable.payment_applied` etc.). Trust the code.

## 2. What each serves

### finance versus my contracts

| Contract need | finance has | Verdict |
|---|---|---|
| `POST /inventory/.../purchase-orders/{id}/payments` (02:587), `debtBalance`, `paidAmount`, `totalPaid` on suppliers | `POST v1/finance/payables/:id/payments`, `GET v1/finance/suppliers/:id/debt`, AP created from `inventory.stock.received` and `inventory.purchase_order.approved` (`payables.service.ts:675,706`) | Covered differently. Payments attach to a payable (a bill), not a PO id. Contract 02 open question 3 ("should finance own PO payments?") would be answered yes, but the route moves from `/inventory` to `/finance` or needs a gateway alias |
| Customer `currentDebt`, `debtLimit` (03:533), error `C003` | `customers/:id/debt`, `credit-profile`, `PUT credit-limit`, receivable events | Covered differently. Customer fields would come from events or a finance read, not from `customer` |
| COD (`S013`, `cod` payment) | `cod/receivables`, settlement batches, `cod/.../reconcile` | Beyond contract. No Figma screen. The `cod` payment method in sales is not wired to finance except via `sales.fulfillment.completed` (`cod.service.ts:761`) |
| `GET /sales/.../shipping-providers` (03:290, "owned by finance, ERD ShippingProvider") | Nothing: grep for `shipping_provider`/`ShippingProvider` in `apps/finance` finds none, only `carrier_code` strings (migration:601) | Missing. Needs a `shipping_providers` table and a projection event to sales |
| Shipments in order screens | None | Missing (WT sales has `fulfillment`, not checked in depth) |
| Cash book, journals, refunds, settlements, shift recon, credit holds | Present | Not in the Figma; no contract. Optional scope beyond screens |
| Dashboard/Reports `reports.view` | `finance.report.read` used on 13 reads | Different permission names |

Figma finance screens: none. Contract-endpoint count satisfied (supplier debt, PO payments, supplier list debt fields): about 3 of 3 by capability, 0 of 3 at the contract's URL/shape.

### integration versus my contracts (03 + 04)

Prefix: contracts `/integration/api/v1/channel-connections...` versus theirs `/api/v1/integrations/connections...`.

| Contract endpoint | Theirs | Verdict |
|---|---|---|
| GET channel-connections | `GET connections` | Covered differently (no `availableProviders`, `displayName`, `environment`, `syncInterval`, `syncProducts/Orders/pushStock/syncPrices` flags; has `safetyStockBuffer`, `stockAllocationPercent`) |
| POST channel-connections | `POST connections` | Covered differently (body has externalShopId, branchId required; providers `SHOPEE`,`LAZADA` only via CHECK, migration line ~121) |
| PATCH channel-connections/{id} | none (only pause/resume) | Missing |
| POST .../authorize | `POST :id/authorize` (initiate or complete callback in one route) | Covered differently |
| GET oauth/{provider}/callback | none (callback completed via authenticated POST) | Missing: a browser redirect from a provider cannot carry our bearer token |
| POST .../disconnect | `DELETE :id` | Covered differently |
| GET .../stats | `GET :id/health` | Covered differently (shape unverified) |
| GET .../sku-mappings | `GET sku-mappings` (filter by connection) | Covered differently; no `suggestedVariant` (unverified) |
| PATCH sku-mappings/{id} | `PATCH sku-mappings/:id` | Covered |
| POST sync-products, push-stock | `POST connections/:id/sync/products`, `.../sync/inventory` (+ `sync/orders`) | Covered differently |
| GET sync-jobs, POST retry | `GET sync-jobs`, `GET sync-jobs/:id`, `POST sync-jobs/:id/retry` | Covered |
| POST webhooks/{provider} | `POST webhooks/v1/:provider/:connectionKey` (public) | Covered differently (connectionKey in the path) |
| Admin: connections list/detail, sync-history, webhook-events (04) | none (per-tenant only, no platform-admin cross-tenant view) | Missing (4 of 4) |
| Admin failed jobs (04:561) | emits `integration.sync_job.completed/failed`; no `.retrying`/`.resolved`; `POST /internal/sync-jobs/{id}/retry` absent | Partial |

Count by table row (12 rows, 15 endpoints in 03): 2 rows covered (PATCH sku-mappings; sync-jobs list + retry), 8 covered differently, 2 missing (PATCH connection, oauth callback); `tiktok_shop` and `website` providers are also not modelled. Of 4 admin: 0 covered. Extra, not in contracts: conflicts (4), reconciliation (3), refresh, pause, resume, order-sync, SKU delete/create/get.

## 3. Data model and external dependencies

- Marketplace access is **simulated only**. `providers/shopee/shopee.adapter.ts` and `providers/lazada/lazada.adapter.ts` compute real-format signatures (HMAC, URL building) but no HTTP client is used: `grep fetch|axios|http\.` in `providers/` finds nothing; orders come from `rateLimiter.listSimulatedOrders` (`provider-rate-limiter.service.ts:98`, used at `shopee.adapter.ts` ~line 405). `SHOPEE_LIVE_ENABLED`/`LAZADA_LIVE_ENABLED` only set a `liveCredentialsConfigured` capability flag. No TikTok, no website provider. Nothing here needs internet or credentials.
- Tokens: `connection_credentials` stores AES-256-GCM ciphertext, `v1:` envelope, random 12-byte IV (`domain/integration-domain.ts:207-250`). Key = SHA-256 of `INTEGRATION_CREDENTIAL_MASTER_KEY`, **falling back to a hard-coded dev key** (`:210-217`) with no production guard.
- Refresh: lease plus `credential_version` compare-and-swap (ADR-0018 2.2).
- Webhooks: secret per connection (encrypted), signature verified on the raw body (`rawBody: true` in `libs/common/src/bootstrap/bootstrap-service.ts:35`), replay window, shop id match, advisory-lock dedup, inbox row before 200 (`webhooks.service.ts:100-215`). Tenant resolved from `connection_key` through an RLS SELECT policy `webhook_routing_select_policy` (migration:137).
- Env vars: `INTEGRATION_CREDENTIAL_MASTER_KEY`, `SALES_SERVICE_URL`, `SHOPEE_PARTNER_ID/KEY/BASE_URL/LIVE_ENABLED`, `LAZADA_APP_KEY/SECRET/AUTH_URL/LIVE_ENABLED`. None appear in WT `docker-compose.yml` (grep empty).
- finance env: `INTERNAL_S2S_TOKEN` (optional, see section 6). Postgres schema only; no external calls found.
- Sales client: `infrastructure/sales-client/sales-order.client.ts:117` calls `SALES_SERVICE_URL/api/v1/orders/omnichannel` only if the env is set; otherwise it keeps orders in **in-memory Maps** and fabricates ids (`:128-190`). Also fault-injection hooks live in production classes (`simulateCrashAfterSalesCreate`, `simulatePersistenceFailureForConnection` in webhooks.service).
- Jobs run by `SyncJobsService.claimAndProcessBatch` (`sync-jobs.service.ts:115`). Callers found by grep: only `test/` and the benchmark. No `@Cron`, `setInterval` or queue worker in `src/`: unverified whether the `sync/*` routes run work inline. Treat "background sync" as not running on its own.

## 4. Events and cross-service

| | finance | integration |
|---|---|---|
| Publishes (outbox) | `finance.cashbook.entry_posted`, `receivable.created`, `receivable.payment_applied`, `payable.created`, `payable.payment_applied`, `credit.authorized/committed/released`, `payment.settlement_confirmed`, `refund.completed`, `refund.reconciliation_required`, `cod.settlement_reconciled`, `cod.discrepancy_detected` (`libs/contracts/src/events.ts:620-680`) | `integration.connection.connected/disconnected/reauth_required`, `sku_mapping.created/updated`, `external_order.received/imported/conflicted`, `inventory_publication.succeeded/failed`, `sync_job.completed/failed`, `reconciliation.discrepancy_detected` (`events.ts:789+`, `M6_EVENT_CONTRACTS.md`) |
| Consumes | `sales.order.completed`, `sales.tender.recorded`, `sales.payment.confirmed`, `sales.refund.requested`, `sales.shift.closed`, `sales.fulfillment.completed`, `inventory.purchase_order.approved`, `inventory.stock.received` | `catalog.variant.created/updated/deactivated`, `catalog.product.deactivated`, `inventory.stock.changed` (`consumers/integration-events.consumer.ts`). ADR/docs also list `sales.order.*` but no handler exists |
| Sync calls | Inbound `internal/v1/finance/credit-authorizations*` (5 routes) from sales | Outbound `POST sales /api/v1/orders/omnichannel` |

Event names that my contracts expect and neither emits: `integration.channel_order.received` (they emit `external_order.received`), `integration.sku.mapped/unmapped`, `inventory.supplier_payment.recorded` (finance would not consume it; it consumes PO-approved and stock-received instead).

Dependencies are all inside the same stack: WT has `sales` (with `POST orders/omnichannel` at `apps/sales/src/modules/orders/m3-orders.controller.ts:35`), `inventory`, `catalog`, `customer`, `insight`, plus libs `contracts` (many events) and `events`. **Main line has none of that**: my `libs/contracts/src/events.ts` defines only 6 event types (platform.* and `sales.order.completed`), my sales has no `modules/` fulfillment/checkout/returns and no omnichannel route, my inventory has no `stock.changed` or `purchase_order.approved` event. Merged alone, finance and integration would compile only if `@pbl/contracts` event constants and `@pbl/events` helpers they import exist (they do not in main: `enableTenantRlsPolicy` lives at `libs/events/src/database/pbl-database.module.ts:167` in WT; not checked in main) and would receive no input. Integration would silently run on in-memory Sales mocks; finance would hold empty ledgers.

## 5. Tenancy and authorization

- RLS: every table calls `enableTenantRlsPolicy` (ENABLE + FORCE, `tenant_id = current_setting('app.tenant_id')`, `libs/events/.../pbl-database.module.ts:167-187`), set per transaction with `set_config`. DB role / non-superuser grant: not verified (no CREATE ROLE in either migration). Services use raw `DataSource` + `set_config`, not `@InjectTenantScopedRepository` (CLAUDE.md:281 pattern) (spot check, not exhaustive).
- Finance controllers use `@RequireRoles` (not permissions) with 38 usages: `owner,manager` 11; `+accountant` 5; `+accountant,finance.report.read` 4; `owner,manager,cashier` 18. Mixed role/permission strings in one list. Permission-like strings used: `finance.report.read`, `finance.cod.reconcile`, `finance.settlement.reconcile`, `finance.refund.process`, `finance.refund.approve`, `finance.adjustment.approve`, `finance.shift.reconcile`, `finance.cashbook.create`.
- Integration uses `@Permissions(...)` on its authenticated routes: `integration.connection.create|read|manage|disconnect`, `integration.mapping.read|manage`, `integration.order_sync.execute`, `integration.inventory_sync.execute`, `integration.product_sync.execute`, `integration.jobs.read|retry`, `integration.conflict.read|resolve`, `integration.reconciliation.read|execute`. 15 distinct codes.
- Their `@pbl/auth` guard (`WT/libs/auth/src/auth.guard.ts:73-120`) resolves these **by role name**, hard-coding `finance.`/`integration.` prefixes and a cashier whitelist inside the shared lib. `@Permissions` is `hasRoleOrPermission` on roles, not the token `perms` claim. That contradicts ADR-0020 items 4-6 and ADR-0009 (lib must not know domain names). The cashier set contains codes no route uses (`finance.cashbook.read`, `integration.order_sync.read`).
- Mapping to my catalog (`libs/contracts/src/permissions.ts:8-20`): there is no `finance` or `integration` module. Minimum viable: integration routes to `channels.view|create|update|delete` (as contract 03 already says); finance supplier payments to `purchasing.update`/`purchasing.view`; cash book, journals, receivables, COD, refunds, reconciliation need a new `finance` module (`view|create|update|approve`) or reuse `reports.view` for reads and `settings.update` for admin. Catalog is code (ADR-0020 item 1) and `ALL_PERMISSIONS` is asserted at 38 in `permissions.spec.ts:16`, so adding codes changes that test and `DEFAULT_ROLE_PERMISSIONS` (`accountant` especially).
- Branch scope: integration connections carry `branch_id` (required); finance entries carry nullable `branchId` (e.g. `cashbook.service.ts:191`). Neither uses `canAccessBranch`/`allowedBranches`, so out-of-scope branches return data instead of 404, and lists are not filtered.

## 6. Quality signals

- Error shape: both use `{ statusCode, errorCode, code, message, details?, timestamp }` (`finance-http-error.ts:6-17`), no `error` string; `errorCode` values are English enums, not my `I0xx`/`S0xx` codes or i18n. Validation errors follow Nest defaults (not checked).
- Pagination: finance lists return `pagination: { limit, offset, total }` (e.g. `payables.service.ts:798`); convention is `{ limit, currentPage, totalRecords, totalPages }` (`docs/conventions/api-conventions.md:82-93`). Integration pagination shape not checked.
- URLs: `v1/finance/...` served at both `/` and `/api` (`@Controller(['', 'api'])`), integration `api/v1/integrations/...`; conventions want `/api/v1/<plural>` per service and gateway entries (not present: no krakend entries checked in WT).
- Idempotency: `Idempotency-Key` header on finance payables/receivables/refunds writes; `UQ(tenant_id, idempotency_key)` on journals; webhook dedup in inbox. Strong.
- Concurrency/money: ledger tables append-only, integer or string decimals (`expectedCodAmount` is a string); contracts say integer VND (unverified whether the schema uses NUMERIC).
- Risks (file:line):
  1. `finance/src/modules/credit-authorization/credit-authorization.controller.ts:32-56,95-96,127-128,156-157,179-180,212-213`: five `@Public()` routes accept `x-tenant-id` + `x-internal-call` headers; the token check runs **only if `INTERNAL_S2S_TOKEN` is set** (`:41`). Unset means any caller who reaches the service picks the tenant. KrakenD routing is the only barrier (not verified).
  2. `finance/.../settlements.controller.ts:54-60` `webhooks/provider-callback` is named a provider callback but needs a user bearer token and role; no signature check. A real PSP cannot call it.
  3. `integration/.../webhooks.controller.ts:42-45`: `x-webhook-url` header overrides the URL used for the Shopee signature. Forging still needs the secret, so low severity, but it removes URL binding.
  4. `integration/src/domain/integration-domain.ts:210-217` default master key in source (see section 3).
  5. `integration/.../sales-order.client.ts:117-190` silent in-memory Sales fallback; test hooks in production services.
  6. `libs/auth/src/auth.guard.ts:73-120` domain strings in the shared auth lib.
  7. Webhook 200-before-processing contract: `webhooks.service.ts` returns after inbox write, but no consumer of the inbox found other than the job claimer (see section 3).
- CLAUDE.md conventions: followed: schema-per-service migrations, outbox via `@pbl/events`, `PblAuthModule.forRemoteJwks()` (`finance/src/app.module.ts`), RLS. Not followed: permissions from token (ADR-0020), `@pbl/auth` stays generic (ADR-0009), pagination and error shape, `@ApiAuth` decorators (they use `@ApiBearerAuth` + `@RequireRoles`), i18n errors, cross-tenant tests (int-spec tenant tests exist for integration Test L/P; finance not checked), CI/gateway/compose registration (not checked in WT).

## 7. Assessment

| Service | Verdict | Required changes | Effort |
|---|---|---|---|
| integration | **Adopt with changes** (as a base, not as-is) | (a) switch to `@RequirePermission` with `channels.*`, drop the lib guard hack; (b) add contract routes: PATCH connection, GET oauth callback (public, state-nonce validated), `availableProviders`, stats shape, 4 admin routes, `integration.sku.mapped/unmapped`, `sync_job.retrying/resolved`; (c) add `tiktok_shop` and `website` providers (website needs `webhookUrl/webhookSecret`, no OAuth); (d) remove master-key fallback in production, drop in-memory Sales fallback and test hooks from services; (e) add an in-app worker/scheduler; (f) align events/pagination/errors; (g) real HTTP clients behind adapters if Shopee sandbox is wanted | L. 12.5k lines to review and rework, depends on events and a Sales omnichannel route that main lacks. Adapters are the right shape, so a rewrite is not needed |
| finance | **Not now** for the screens; **adopt later with changes** for supplier debt/payments | Core need today is small (supplier AP, PO payments, customer debt fields, shipping providers); take only `payables` + `receivables` (12 routes) behind `purchasing.*`/`customers.*`, plus a new `shipping_providers` table. The rest (cash book, journal, refunds, COD, recon) has no screen and no contract | Subset: M. Full: L (16.6k lines, 22 tables, new `finance` permission module, branch scope, role-based auth to convert) |

Landing order (each step needs the previous):
1. Shared base from main: events lib parity (`@pbl/contracts` event constants, `@pbl/events` inbox/outbox/`@OnEvent`/`enableTenantRlsPolicy`), checked against what WT `libs/events` adds. Without it neither service builds.
2. Upstream emitters: inventory (`stock.changed`, `stock.received`, `purchase_order.approved`), catalog (`variant.*`), sales (`orders/omnichannel`, `order.completed`, `refund.requested`).
3. integration (needs 1, 2 and the `channels.*` permissions that already exist); mark providers sandbox-only.
4. finance subset after inventory PO flow and customer debt fields exist; keep PO payments in inventory until then (my open question 3).
5. Remaining finance modules only when a screen appears.

Unverified overall: whether the shared libs in WT diverge from main enough to block step 1 (not diffed); runtime behaviour (nothing was executed); DB role grants; gateway/CI registration of both apps in WT.
