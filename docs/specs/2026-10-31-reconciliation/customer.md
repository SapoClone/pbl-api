# Reconciliation: customer service (THEIRS M4 vs MINE)

Theirs = `WT/apps/customer` (WT = `/tmp/claude-1000/-home-truong-Code-PBL6/25df95e7-b007-408f-a3ea-a382b0d5d4e9/scratchpad/wt17`). Mine = `apps/customer`. Contract = `docs/specs/2026-10-28-api-contracts/03-sales-channels-customers.md` lines 469-600 (19 endpoint items). "NV" = not verified.

## 1. Scope and size

| Item | Theirs | Mine |
|---|---|---|
| Source lines (src+test, `wc -l`) | about 9.3k (loyalty.service 1577, profiles.service 1186, data-management.service 809) | about 3.7k (customers.service 706) |
| Routes | 40 (profiles 10, loyalty 11, data-mgmt 6, addresses 5, groups 4, memberships 4); 6 under `internal/v1` | 19 (customers 12, groups 3, tags 2, loyalty-settings 2) |
| Tables | 12 (customers, customer_groups, membership_tiers, customer_addresses, loyalty_settings/accounts/transactions/holds, customer_purchase_projections, customer_merge_history, customer_data_jobs, customer_code_sequence) | 8 (customer, customer_group, customer_tag, customer_tag_link, customer_address, loyalty_transaction, loyalty_setting, code_sequence) |
| Migrations | 1: `1791900000200-create-m4-customer-core.ts` | 1: `1792000000000-create-customer-tables.ts` |
| Test files / cases (`it(` grep) | 4 spec/int files: e2e 11, int 10 (their doc says Tests A-O, 28 unit passed), domain 13, architecture 4 = 38; plus `test/performance/customer-benchmark.ts` (8 scenarios, per `M4_CUSTOMER_TEST_RESULTS.md`) | 4 files: e2e 11, int 24, service unit 2, phone unit 2 = 39 |

Only theirs: membership tiers with auto-upgrade on `qualifying_points`; point holds (HELD to COMMITTED/RELEASED/EXPIRED, idempotency key plus request hash, `FOR UPDATE`); immutable ledger with `balance_before/after`, `idempotency_key`, `original_transaction_id`; pro-rated return clawback (ADR-0016 2.5, negative balance allowed); out-of-order return handling; duplicate detection and merge with history; import/export jobs; optimistic `version` on customers; purchase projections per order; internal eligibility endpoint; RLS; outbox events; 100x contention benchmark.
Only mine: tags (`customer_tag`, link table, `tagId` filter); groups seeded retail/member/vip/wholesale with `isSeeded` (`src/entities/customer.entities.ts:25`); `member_code`; list filters spendMin/tagId/sort; dashboard-shaped list with `orderCount/totalSpent/lastPurchaseAt/loyaltyPoints` on the row; phone masking by permission (`phoneMasked`); `GET /customers/summary`; CSV export with masking; `RequirePermission('customers.*')`; `{data, pagination}` pages and `U00x` errors; DB CHECK `points_balance >= 0`.

## 2. Contract coverage (customer part)

Same path and shape: 0 of 19. Covered differently: 14. Missing: 5. (Mine: 16 covered, 3 missing: import, import-template, DELETE group.)

| Contract endpoint | Theirs | Key differences |
|---|---|---|
| GET /customers | differently `GET /v1/customers` (also `/api/v1`) | Returns `{items,total,page,limit,nextCursor,piiMasked,callerRoles}` (`profiles.service.ts:451-465`), not `{data,pagination}`. Filters: customerGroupId, membershipTierId, source, cursor, page, limit. No spendMin/spendMax, tagId, sort. No orderCount/totalSpent/lastPurchaseAt on rows (those live in `customer_purchase_projections`). `group` is an id, not `{id,code,name}` (NV exact row). |
| GET /customers/summary | missing | Theirs `GET v1/customers/:id/summary` and `/purchase-summary` are per-customer. No KPI/groupCounts endpoint. A `/customers/summary` call would hit `:id` (route order NV). |
| POST /customers | differently | `CreateCustomerDto` takes one `initialAddress`, `customerGroupId`; no `tagIds`, no `loyalty{enabled,initialPoints}`, no `memberCode`. Duplicate phone gives `CUSTOMER_ALREADY_EXISTS` (409 assumed, NV), not `C001` 400. Creates the loyalty account in the same tx. |
| GET /customers/{id} | differently | Adds tier, loyalty account, `debtLimit`/`currentDebt` (`customer.entities.ts:152-167`). No tags, no `tier` shape from contract. |
| PATCH /customers/{id} | differently | Optional `version`; mismatch gives `RESOURCE_VERSION_CONFLICT` (`profiles.service.ts:642`). |
| DELETE /customers/{id} | differently | Deactivates (status INACTIVE, `CUSTOMER_DEACTIVATED` event). Outstanding-debt check C003: NV. |
| POST /customers/import | differently | `POST v1/customers/import-jobs` plus `GET import-jobs/:id`, `conflictPolicy` SKIP/UPDATE; multipart NV. No dry-run seen. |
| GET /customers/import-template | missing | |
| GET /customers/export | differently | `POST export-jobs` then `GET export-jobs/:id`; CSV stored in `customer_data_jobs.result_csv` (text). Not a direct `text/csv`. |
| GET /customer-groups | differently | `GET v1/customer-groups`; no `customerCount`/`isSeeded`; groups are not seeded (no retail/vip rows found in src). |
| POST/PATCH /customer-groups | differently | Status ACTIVE/INACTIVE; code unique per tenant (migration:57 name unique). |
| DELETE /customer-groups/{id} | missing | Non-empty deactivation guard instead (`CUSTOMER_GROUP_NOT_EMPTY`). |
| GET, POST /customer-tags | missing (2) | No tag entity anywhere in `apps/customer/src`. |
| GET /customers/{id}/loyalty-transactions | differently | `GET v1/customers/:id/loyalty/transactions`; types are EARN/REDEEM/ADJUST/EARN_REVERSAL...; `orderCode` NV. |
| POST .../loyalty-adjustments | differently | `POST v1/customers/:id/loyalty/adjustments`; owner/manager only; can go negative? NV (clawback permits -80 by design). |
| GET/PATCH /loyalty-settings | differently | `GET`/`PUT v1/loyalty/settings` (PUT, not PATCH); fields `earnAmountPerPoint`, `redeemValuePerPoint` match; `points_expiration_days` instead of `pointsExpireMonths`; extra min/max redeem, `hold_ttl_seconds`. |

Their routes no contract endpoint needs (26 of 40): membership-tiers x3 and `customers/:id/membership`; address routes x5 (contract embeds addresses in the body); `customers/lookup`, `:id/summary`, `:id/purchase-summary`, `:id/orders`; `duplicates`, `merge`; `customers/:id/loyalty`, `POST loyalty/reconcile`; import/export job GETs; `assign-group`; internal: `loyalty/accounts/:customerId`, `loyalty/holds` x4, `customers/:id/eligibility`.

## 3. Data model and compatibility

| Aspect | Theirs | Mine |
|---|---|---|
| Table names | plural (`customers`, `customer_groups`) | singular (`customer`, `customer_group`) |
| code | `varchar(32)`, unique (tenant,code), `CustomerCodeGenerator` | `varchar(20)` unique (tenant,code), plus `member_code` |
| Phone | nullable; `phone_normalized` unique per tenant where active (`migration:126`, ADR-0016 2.1); normalizes +84 to 0 | NOT NULL; unique on raw `phone` where not deleted (`migration:67`); strips spaces/dots/dashes only (`common/phone.ts`), +84 not converted |
| Group vs tier | group FK plus separate `membership_tiers` and `membership_tier_id`; tiers by `min_points` | `group_id` only; `tier` in the contract detail is not derived (NV) |
| Tags | none | tag + link table |
| Addresses | `recipient_name`, `address_line`, province/district/ward varchar, single-default unique index | same idea (`UQ_customer_address_default`) |
| Loyalty | account table (`posted`, `held`, `lifetime_*`, `qualifying`) + ledger | `customer.points_balance` + `total_spent`, `order_count`, `last_purchase_at` on the customer row; ledger types earn/redeem/adjust only |
| Money | `numeric(18,2)` strings (debt, spend, rates) | `bigint` mapped to number, integer VND (CLAUDE.md convention) |
| Status | ACTIVE/INACTIVE/ANONYMIZED uppercase | active/inactive lowercase |

If both lived in schema `customer`: table names differ so DDL would not collide, but you would get two customer tables, two ledgers, two `loyalty_settings` shapes, and two entity sets mapping `customer` vs `customers`. Both migration classes would run, so the duplicate model is a data problem, not a DDL error. Merging means picking one and writing a migration: add their `loyalty_accounts` (or keep my columns), tags, `total_spent`/`order_count` read model (theirs would need a projection-to-customer rollup), enum case, bigint vs numeric.

## 4. Events and cross-service

| | Theirs | Mine |
|---|---|---|
| Consumes | `sales.order.completed` and `sales.checkout.completed` (`loyalty.service.ts:999,1036`), `sales.return.completed` (`:1293`); idempotent via `earn:order:<id>` key | `sales.order.completed` only (`loyalty/order-completed.handler.ts`); one tx updates spend, count, last purchase, points; unique `(tenant,type,ref_type,ref_id)` |
| Data source for spend | Reads `subtotal`, `discountTotal`, `grandTotal` from payload with fallback to `totalAmount` (`:1000-1030`); these fields are not in my `OrderCompletedPayload` (`libs/contracts/src/events.ts:81-96`), so theirs would use the fallback and earn on `totalAmount` incl. shipping. Spend lives in `customer_purchase_projections`, not on the customer | `totalAmount` plus `customerId` from my payload |
| Publishes | outbox: `customer.created/updated/deactivated`, `group_changed`, `membership_changed`, `loyalty.points_earned/redeemed/reversed`, `hold_created/committed/released/expired` (`libs/contracts/src/events.ts:498-558` in WT) | none (no outbox use in `apps/customer/src`); contract promises `customer.customer.created/updated` |
| `sales.order.returned` | not consumed (they use `sales.return.completed`, which my sales does not publish; NV on my side beyond no match in `libs/contracts`) | not consumed; contract says reverse |

Mine sales/insight: no reference to customer events or APIs found in `apps/sales/src`/`apps/insight/src` other than `customerId` in the order. Sales needs the customer list for the picker via gateway only. Their sales uses `SALES_CHECKOUT_COMPLETED`/`RETURN_COMPLETED` (their `apps/sales/src/modules/{checkout,returns}`); I found no sales client for holds or eligibility in their `apps/sales` (NV beyond grep).

## 5. Tenancy and authorization

| | Theirs | Mine |
|---|---|---|
| Tenant enforcement | PostgreSQL RLS via `enableTenantRlsPolicy` on all 12 tables (`migration` lines 35-178; `customer-architecture.spec.ts:54`), tx-local `set_config('app.tenant_id')` per service method, per-service DB role from `libs/events/src/database/pbl-database.module.ts:120-165`, plus explicit `tenant_id` in queries. Does not use `TenantScopedRepository` (raw `em.query`/QueryBuilder; 30 `user.tenantId!` uses) | `TenantScopedRepository` + `TenantContext` (`loyalty.service.ts:7`); no RLS, no DB role in migration |
| Authorization | `@RequireRoles(ROLES.OWNER, ROLES.MANAGER[, CASHIER])`: 24 routes with cashier, 15 owner/manager. Internal `/internal/v1/*` use the same user roles (no service token) | `@RequirePermission('customers.view/create/update/delete')` per route |
| Move to my catalog | Replace 39 decorators with a mapping: view=GET, create=POST, update=PATCH/PUT/adjust, delete=DELETE; map their hold/merge/import/tier routes to `customers.update` or new codes (catalog change in `libs/contracts/src/permissions.ts`); internal routes need a service-to-service guard (cashier role via a user token is not valid for sales to call). About a day of mechanical work plus tests (their e2e checks roles). |
| Phone visibility | No rule by permission. `maskPii` is a caller-supplied query flag (`profiles.controller.ts:96`, `profiles.service.ts:360`); default is unmasked for everyone incl. cashier | `phone` only with `customers.update`, else `null` + `phoneMasked` (`customers.controller.ts:46`) |

## 6. Quality signals

| Check | Theirs | Mine |
|---|---|---|
| Money integer VND (CLAUDE.md) | violates: numeric strings, BigInt helpers | follows |
| Error shape and codes | `{statusCode,errorCode,code,message,details,timestamp}` with word codes (`customer-http-error.ts`); contract wants letter+3 digits and gateway error body | `U001..U007` (`common/errors.ts`; contract says `C001`: letter differs, NV which is binding) |
| Pagination | `{items,total,page,limit,nextCursor}`; cursor mixes id keyset with created_at order (`profiles.service.ts:420-440`) | `{data,pagination{limit,currentPage,nextPage,totalRecords,totalPages}}` |
| Routes | `Controller(['', 'api'])` and `['v1','api/v1']`: every route duplicated under two prefixes | single `api/v1/...` |
| Concurrency | strong: `FOR UPDATE` on account/hold, idempotency + hash, optimistic `version`, tested 10x contention | atomic `UPDATE ... SET x = x + $n` in event handler; CHECK points >= 0; no holds |
| Tests on real PG | yes (int 10 plus benchmark) | yes (int 24) |
| Risks seen | (1) PII unmasked by default and client-controlled (`profiles.controller.ts:96`); (2) internal S2S routes guarded by user roles; (3) export CSV with PII stored in a DB text column `customer_data_jobs.result_csv`; (4) earn base falls back to `totalAmount` with my payload, so shipping earns points; (5) handler methods take `manager?` optional (`:1001`), falling back to non-inbox tx is possible (NV how consumer passes it) | (1) no RLS; (2) no events published, contract's `customer.customer.created/updated` unmet; (3) no `sales.order.returned` reversal; (4) phone unique on raw string, so `+84901...` and `0901...` can duplicate |

## 7. Assessment

| Question | Answer |
|---|---|
| Cost of adopting THEIRS | Large: contract coverage 0 same, 5 missing (summary, tags x2, import-template, group delete); list shape, pagination, money type, error codes, status case differ from contract and from my sales/insight/web expectations; add `customers.*` permissions (about 39 decorators), phone-by-permission rule, service-token guard for internal routes, order payload fields (`subtotal`, `discountTotal`) from my sales, tags, a customers-row read model for spend/orderCount, `/customers/summary`, aggregation filters. Roughly 3-5 days; unfamiliar 9k lines to own. |
| Cost of adopting MINE | Theirs loses holds, tiers, merge, projections, clawback, RLS (their sales/finance M5 depend on holds and `customer.*` events: `M4_TO_M5_FINANCE_HANDOFF.md`, NV). Their sales needs rewiring if it calls holds (NV). Port RLS and role setup is small (`enableTenantRlsPolicy` is already in `libs/events`). |
| Unique value theirs | RLS and role isolation, holds protocol for POS redeem, immutable ledger with idempotency and clawback, tiers, merge, events, benchmark, ADR-0016. |
| Unique value mine | Exact contract fit (shape, filters, masking, tags, seeded groups, summary), integer VND, permission catalog, small and consistent with my sales/insight. |

Recommendation: keep MINE as the base for the customer service (it is what the screens consume, and swapping costs more than extending). Then port from theirs, in order: (1) RLS migration (`enableTenantRlsPolicy`) on my 8 tables; (2) outbox publishing of `customer.customer.created/updated` and a `sales.order.returned` consumer; (3) the ledger fields (`balance_before`, idempotency key) only if holds are needed; (4) holds plus `eligibility` as a separate module behind a service-token guard only when POS redeem is scheduled; tiers and merge deferred. Missing in mine: import, import-template, group DELETE. Reason: their model satisfies the SRS beyond the Figma scope while failing the contract on 14 of 19 shapes; the RLS and holds ideas transfer without taking the rest.
