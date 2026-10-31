# Phase 4: customer (M4) screen endpoints

Rules: [phase-4-rules.md](phase-4-rules.md). Gap list: `2026-10-31-reconciliation/customer.md`. Contract:
`2026-10-28-api-contracts/03-sales-channels-customers.md` (customer part). Only `apps/customer/**` and this file were edited
(no `events.ts` change). Their routes and shapes are kept; everything below is additive or a new route.
Service routes are served under both `/v1/...` and `/api/v1/...`; the gateway maps `/customer/api/v1/...` to `/api/v1/...`.

## Route table

Gateway prefix is `/customer/api/v1`. "new gw" = the parent must add the entry to `krakend.json` (protected, `auth/validator`).
Query strings already pass (`input_query_strings: ["*"]`); the import route needs multipart passed through (no-op encoding) and
`Content-Type` allowed in `input_headers`; the two CSV routes return `text/csv`.

| Method, service path | Gateway | Permission | Covers | gw |
|---|---|---|---|---|
| GET `/api/v1/customers/summary` | `/customer/api/v1/customers/summary` | `customers.view` | missing: KPI cards and group counts (`month`) | new |
| GET `/api/v1/customers/export` | `/customer/api/v1/customers/export` | `customers.view` (phones masked unless `customers.update`) | different: direct `text/csv` of the list filters, max 5000 rows | new |
| GET `/api/v1/customers/import-template` | `/customer/api/v1/customers/import-template` | `customers.create` | missing: CSV template | new |
| POST `/api/v1/customers/import` (multipart `file`, `dryRun`) | `/customer/api/v1/customers/import` | `customers.create` | different: file import with dry run, 200 `{total,created,updated,failed,errors}` | new |
| GET `/api/v1/customer-tags` | `/customer/api/v1/customer-tags` | `customers.view` | missing: `{data:[{id,name}]}` | new |
| POST `/api/v1/customer-tags` | `/customer/api/v1/customer-tags` | `customers.update` | missing: 201 `{id,name}` | new |
| DELETE `/api/v1/customer-groups/:id` | `/customer/api/v1/customer-groups/{id}` | `customers.delete` | missing: 204; seeded or non-empty gives 409 | new |
| GET `/api/v1/customers/:id/loyalty-transactions` | `/customer/api/v1/customers/{id}/loyalty-transactions` | `customers.view` | different: `{data,pagination}` with `earn/redeem/adjust/expire/reverse`, `orderCode` | new |
| POST `/api/v1/customers/:id/loyalty-adjustments` | `/customer/api/v1/customers/{id}/loyalty-adjustments` | `customers.update` | different: body `{points,reason}`, 201 `{transaction,balance,availablePoints,replayed}` | new |
| GET `/api/v1/loyalty-settings` | `/customer/api/v1/loyalty-settings` | `customers.view` | different: `{enabled,earnAmountPerPoint,redeemValuePerPoint,pointsExpireMonths}` + extras | new |
| PATCH `/api/v1/loyalty-settings` | `/customer/api/v1/loyalty-settings` | `customers.update` | different: same body shape | new |

Existing routes extended (already in the gateway): GET `/customers`, POST/PATCH/GET `/customers/:id`, `/customers/lookup`,
DELETE `/customers/:id`, GET `/customer-groups` (see Shape additions). `summary`, `export` and `import-template` are declared
before `:id` in the controller, so they are not captured by the uuid route (tested).

## Shape additions

- **GET /customers**: new optional query `group` (comma codes, case-insensitive, `all` ignored), `spendMin`, `spendMax` (`@IsInt`),
  `tagId`, `sort` (`totalSpent|lastPurchaseAt|createdAt`), `order`. `q` also matches email. Existing `items,total,page,limit,nextCursor`
  unchanged; added `data` (contract rows: `id, code, name, phone, phoneMasked, email, group{id,code,name}, orderCount, totalSpent,
  loyaltyPoints, lastPurchaseAt`) and `pagination{limit,currentPage,nextPage,totalRecords,totalPages}`. `orderCount/totalSpent/lastPurchaseAt`
  come from `customer_purchase_projections` (net of returns; no new write path). The cursor works only for the default order.
- **Phone rule on every response that carries one**: `phone` is real only for `customers.update`. The new `data` rows give `phone: null`
  (contract) and `phoneMasked` ("090 ••• •• 28") to everyone else; the existing `items`, detail, create, update, lookup keep the phase 2
  `091***5678` string and now also have `phoneMasked`. Detail `addresses[].recipientPhone` is masked the same way. Export masks unless
  update. Import, tags, loyalty, summary responses hold no phone (tests check that no phone digits appear).
- **Customer record** (create 201, update, GET `:id`, lookup) now also has: `phoneMasked, dob, memberCode, joinedAt, tier{id,code,name},
  addresses[{id,recipientName,recipientPhone,province,district,ward,addressLine,isDefault}], tags[{id,name}], orderCount, totalSpent,
  lastPurchaseAt, loyaltyPoints, group{id,code,name,...}, loyalty.enabled`.
- **POST /customers** extra optional fields: `addresses[]` (province, district, ward, addressLine required, 422 otherwise; not with
  `initialAddress`; one default), `groupId` (alias of `customerGroupId`), `dob` (alias), `tagIds[]` (404 `CUSTOMER_TAG_NOT_FOUND` if unknown),
  `loyalty{enabled,initialPoints}` (`memberCode` `MB000001` when enabled; `initialPoints` writes one `MANUAL_ADJUSTMENT` ledger row and the
  existing `customer.loyalty.points_earned` event; the tier is resolved from those points). `gender` is case-insensitive (`female` accepted).
- **PATCH /customers/:id**: `groupId`, `dob`, `tagIds` (replaces; `[]` clears), `loyalty{enabled}`.
- **DELETE /customers/:id**: now 409 `CUSTOMER_HAS_OUTSTANDING_DEBT` when `currentDebt > 0` (contract C003).
- **GET /customer-groups**: each row has `customerCount` and `isSeeded`. The four seeded groups (`retail, member, vip, wholesale`) are
  created idempotently on the first read (list or KPI summary) per tenant.
- **Schema** (baseline migration edited in place, RLS on the new tables): `customer_groups.is_seeded`; `customers.member_code` (unique per tenant
  when set), `customers.loyalty_enabled`; new tables `customer_tags`, `customer_tag_links`. New error codes: `CUSTOMER_GROUP_SEEDED`,
  `CUSTOMER_TAG_NOT_FOUND`, `CUSTOMER_TAG_ALREADY_EXISTS`, `CUSTOMER_HAS_OUTSTANDING_DEBT`.
- **Bug fixed on the way**: the composite FKs `customers -> customer_groups` and `-> membership_tiers` used `ON DELETE SET NULL`, which would null
  `tenant_id` (NOT NULL) when a group or tier is deleted; now `SET NULL ("customer_group_id")` / `("membership_tier_id")` (needs PG 15+; the stack uses 17).

## Contract mismatches left (breaking to change, or by service style)

1. GET `/customer-groups` returns a bare array, contract wants `{data:[...]}`; POST group is `customers.create` (contract: update).
2. DELETE `/customers/:id` returns 200 with the record, contract 204; it deactivates (soft delete) as before.
3. Error codes and statuses: word codes with 409 (`CUSTOMER_ALREADY_EXISTS`, `CUSTOMER_TAG_ALREADY_EXISTS`, `INSUFFICIENT_LOYALTY_POINTS`, debt) where the
   contract has `C001/C003/C004/C005` with 400; duplicate-phone detail carries `existingCustomerId`.
4. Enums are uppercase (`gender: FEMALE`, `source: STORE`, status `ACTIVE`); input is case-insensitive for `gender`, `source` is uppercased as before.
5. `phone` for non-update holders on the old shapes is a masked string, not `null` (only `data` rows follow the contract).
6. Pre-existing shapes kept: `PUT /loyalty/settings`, `/loyalty/transactions` (`items`), `/loyalty/adjustments` (`pointsDelta`), import/export jobs.
7. Event names are `customer.created/updated/...` (contract text says `customer.customer.created`); `sales.order.returned` is not consumed
   (they consume `sales.return.completed`).
8. `pointsExpireMonths` is `round(days / 30)`; setting it stores `months * 30` days.
9. `DELETE /customer-groups/:id` uses `customers.delete` per the Phase 2 mapping rule (contract says update).

## Deferred

- XLSX import (no parser dependency; CSV only, file at most 5 MB, 5000 rows) and `addresses` replacement on PATCH (use the existing address routes).
- Per-customer `loyalty.enabled=false` is stored and shown but the earn handler does not honour it (nor the tenant `isEnabled`; unchanged from M4).
- Seeded groups appear on first read, not at tenant creation (that is platform's event; no subscriber added). A pre-existing group named like a seed
  (`VIP`) blocks that seed row (name unique), so the tenant then has fewer than four seeded groups.
- Customer-level `returningRate` ignores returned orders (counts completed orders in the month).

## Events added

None. Tag, loyalty and initial-points writes reuse `customer.updated`/`customer.loyalty.points_earned` through the existing outbox; no payload types added,
no topology change.

## Decisions to review

- The `data`/`pagination` keys sit beside `items/total` in the list (double payload) instead of a `?shape=` switch.
- `members` in the KPI is the `member` group count, `vip` the `vip` group count (the contract numbers match group counts).
- Import matches existing customers by `code` only (update); a phone owned by another customer fails with `duplicate` rather than overwriting.
- Delete is refused for debt even with `anonymize=true`.
- Gateway: the import route needs multipart bodies and the `Content-Type` header forwarded; check the `input_headers` whitelist.

## How verified

- `tsc -p apps/customer/tsconfig.app.json --noEmit` clean; `eslint apps/customer` clean; `prettier --check apps/customer` clean.
- `jest apps/customer/src`: 6 suites, 99 tests pass (new: permission matrix rows for all 11 new routes, 403/owner, route order, 422 validation of
  query and bodies, CSV content types, multipart import, settings and adjustment mapping, helper specs).
- Integration against a throwaway `pgvector/pgvector:pg17` (port 55621, removed afterwards): `customer.int-spec.ts` (10) and the new
  `customer-screen.int-spec.ts` (11: seeding, tags, create with addresses/tags/points, list filters/sort/spend/pagination/phone rule/tenant isolation,
  KPI, update, debt block, group delete, import dry run, export, ledger, adjustment floor) all pass. The earlier two phone-mask failures of phase 3 are gone.
