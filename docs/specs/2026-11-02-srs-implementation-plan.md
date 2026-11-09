# SRS v1.1 → code: what is built, and the plan for the rest

Source: *SRS – Nền tảng SaaS quản trị bán lẻ đa kênh*, v1.1. Every requirement below was checked against the code, not
against the specs in this folder (several of them are behind or ahead of the code; see [Doc drift](#doc-drift)).
Read on 2026-11-02 at pbl-api `feat/m8-system-integration-and-sagas` 5107f1c, pbl-web `main` 2270f99,
pbl-infra 70dfd32. Paths are relative to pbl-api unless they name another repo.

Status: **Built** does what the SRS row says; **Partial** exists but misses part of the row (the gap column says what);
**Missing** has no code. Status is about the backend. The web app is a separate column, because most of the
backend has no screen yet.

## Where things stand

| | Built | Partial | Missing | Total |
|---|---|---|---|---|
| All functional requirements | 29 | 40 | 13 | 82 |
| Priority *Cao* (required for 1.0) | 21 | 25 | 5 | 51 |

- **The backend is far ahead of the screens.** Of the 15 pbl-web routes, 4 call the API for real (staff, settings,
  reports, orders list), 4 mix real calls with mock data (overview, inventory, POS, suppliers), and the rest are mock or
  placeholders, including products and customers whose services are complete CRUD. There is no admin portal, and
  pbl-mobile is an untouched Flutter template.
- **The weakest module is M01, platform administration** (no admin identity, no plans, no subscriptions), followed by
  the password and email flows of M02 and M12.
- **SRS §8.2 asks for 100% of the *Cao* rows.** That is 30 rows still to close: 25 partial, 5 missing (FR-M01-02,
  -03, -04, FR-M02-04, FR-M11-02).

## Phase 0 — fix what is wrong today

These are defects or exposures in code that already ships. Each is small, and each was confirmed in the code.

| # | Problem | Where | Fix |
|---|---|---|---|
| 0.1 | Marketplace stock shortages are dropped: sales flags the shortage, the client replaces it with `shortageDetected: false`, so no `SHORTAGE_HOLD` or conflict is ever raised outside tests (UC-03 4b, FR-M07-06). | `apps/integration/src/infrastructure/sales-client/sales-order.client.ts:132` | Map the shortage fields from the sales response; add a test against the real client, not `test/support/in-memory-sales-order.client.ts`. |
| 0.2 | Nothing runs queued sync jobs: `claimAndProcessBatch` has no caller outside tests, so webhook orders stay `PENDING` (UC-03 step 4). | `apps/integration/src/modules/sync-jobs/sync-jobs.service.ts:117` | A polling worker in the integration process (interval plus lease, as `reservation-expiry.job.ts` does in inventory). |
| 0.3 | Warehouse reservations (the path sales uses) never expire, so abandoned checkouts keep stock reserved forever (FR-M05-08). | `apps/inventory/src/stock/reservations.service.ts:1355` is never called; `stock/reservation-expiry.job.ts:36` only expires the legacy table | Call `expireDueWarehouseReservations` from the expiry job. |
| 0.4 | Test switches accepted in production: `simulateFailureAfter*` lets anyone with `pos.create` push checkouts into recovery states. | `apps/sales/src/modules/checkout/checkout.dto.ts:137-145`, `checkout.service.ts:376,409` | Ignore them unless `NODE_ENV=test`. |
| 0.5 | Discount limit bypass: any non-empty `discountApprovedBy` skips the limit, and the `sales.pos.discount.override` permission it checks is not in the catalog (FR-M06-03). | `apps/sales/src/domain/sales-domain.ts:615-620` | Verify the approver (an account with `orders.approve` in the tenant); add the permission to `libs/contracts/src/permissions.ts`. |
| 0.6 | The web build ships a demo login (`admin@gmail.com` / `admin@gmail.com`) that mints fake tokens in the browser and shows mock data. Not a backend hole, but it is live at `app.sapo`. | pbl-web `src/api/auth.ts:11` | Remove it, or build it only in dev. |
| 0.7 | Token lifetimes are 1 day / 365 days; the SRS target is 15 minutes / 7 days (FR-M02-03). | `.env.*`, infra `terraform/services.tf` | Lower them **after** pbl-web refreshes tokens (phase 3); today it would log users out every 15 minutes. |
| 0.8 | Gateway routes with no handler (404): attribute value PATCH/DELETE, `GET /integration/.../providers`, `POST .../connections/{id}/refresh-token`, `POST /finance/.../settlements`. | `krakend/krakend.json` | Remove them, or build the handler. |
| 0.9 | Platform's cross-tenant tests (`test/tenancy.e2e-spec.ts`, `platform.int-spec.ts`) are not in CI; SRS §8.1 makes the tenant isolation suite mandatory. | `.github/workflows/ci.yml` | Run them in the integration job. |

## Phase 1 — platform administration (M01)

Nothing of the admin side exists: `platform_admin` is only a name in `libs/auth/src/auth.types.ts:4`, the gateway has
no `/admin` route, and `GET /tenants/current/context` returns a hard-coded `free` plan
(`apps/platform/src/api/tenant/tenant.service.ts:223`). The design is in
[04-platform-admin.md](2026-10-28-api-contracts/04-platform-admin.md) (52 endpoints) and the Figma frames `40:*`.

What already helps:

- `TenantService.create` (`tenant.service.ts:67-153`) creates a store, its five seeded roles, the owner membership and a
  default branch in one transaction. FR-M01-01's "create a tenant with its owner and a default branch" wraps it.
- `TenantStatus.SUSPENDED` exists (`tenant.entity.ts:13`) and `membership.service.ts:65` already hides suspended stores
  from login. Nothing sets the status yet.
- Redis session revocation (`libs/auth/src/redis-session-revocation.ts`) can end every session of a locked store at once.
- `TenantScopedRepository` keeps store data isolated; the admin needs the one sanctioned cross-tenant path the contract
  calls `AdminRepository`.

CLAUDE.md lists the admin identity as deliberately deferred. It touches auth, so it needs an ADR (extending ADR-0004
and ADR-0008) and its own approved design spec in this folder before code; the decisions below are its open points.

Decisions to make before building:

1. **First super admin.** The contract never says how the first `super_admin` is created. Proposal: a one-off command,
   run like the platform migration task in `deploy.yml`, that takes an email and a password from SSM.
2. **Where the admin UI lives.** Proposal: a separate route tree with its own login in pbl-web (`/admin`), served from
   `app.sapo` at first. `admin` is already a reserved store subdomain (`create-tenant.req.dto.ts`).
3. **How other services learn plan limits.** Proposal: platform owns `Plan` and `Subscription` and publishes
   `platform.tenant.plan_changed` with the limits; catalog (products) and uploads (storage) keep a projection and check
   locally, as SRS C08 requires (no synchronous calls between services).
4. **What "locked" means.** Proposal: members cannot sign in or refresh, open sessions are revoked, data is kept, and the
   admin can reactivate.

| Step | Requirements | Work | Done when |
|---|---|---|---|
| 1.1 | (prerequisite) | `platform_admin` table and migration; the bootstrap command (decision 1); `POST /admin/auth/login`, `/refresh`, `/logout`, `GET /admin/me`; tokens with `sub_type = platform_admin` and no `tid`; `@RequirePlatformAdmin()` in `libs/auth`; the routes in KrakenD | A super admin signs in; a store token is refused on `/admin/*`, and an admin token is refused on store routes. |
| 1.2 | FR-M01-01 | Store list, detail, create (with an owner invite email and a default branch), edit, lock and reactivate; locking revokes sessions; every write goes to the audit log with `scope = platform` | Lock, then the owner's next request fails; reactivate, then they sign in again. |
| 1.3 | FR-M01-02, -03, -05 | `plan`, `plan_quota`, `subscription` (effective and expiry dates, history); plan CRUD for super admins; assign, upgrade, downgrade; an "expiring soon" list; the real plan in `tenants/current/context` in place of the placeholder | A store shows its real plan and expiry date. |
| 1.4 | FR-M01-04 | Quota checks for branches (`branch.service.ts:89`), members (`member.service.ts`), products (catalog, from the projection) and storage (catalog uploads), with one error code and an upgrade hint | Exceeding the Free branch limit returns that error; the web shows the hint. |
| 1.5 | FR-M01-06 | Platform-wide read models in insight (active stores, orders per day), service health from each `/health`, recent failures (DLQ alarms, failed sync jobs) | The admin overview screen shows live numbers. |
| 1.6 | screens | pbl-web admin: login, overview, businesses (list, detail, create, edit, lock), plans, subscriptions (Figma `40:*`) | The admin can do 1.2–1.5 without curl. |
| later | FR-M01-07, -08 (*Thấp*) | Platform notices; read-only support sessions with an end-session banner and audit | |

## Phase 2 — accounts and mail (M02, M12-03)

| FR | Pri | Status | Code today | Gap → task |
|---|---|---|---|---|
| FR-M02-01 | Cao | Partial | `POST /auth/email/register` (`apps/platform/src/api/auth/auth.service.ts:275`); verification email via SQS and pbl-mail-service | No phone at sign-up. `GET /auth/verify/email` is a stub (`auth.controller.ts:102`), accounts start `active` with no verified flag. → Verify the token, add `email_verified_at`, block sign-in until verified (or decide not to). |
| FR-M02-02 | Cao | Partial | Lockout after 5 failures for 15 min (`login-lockout.constant.ts`, `auth.service.ts:188`) | The count has no 15-minute window, and login is email only. → Count failures inside a window; accept phone. |
| FR-M02-03 | Cao | Built | RS256 + JWKS, rotating refresh tokens with reuse detection, `logout-all`, session list | Lifetimes, see 0.7. |
| FR-M02-04 | Cao | **Missing** | `forgot-password`, `verify/forgot-password`, `reset-password` return strings (`auth.controller.ts:84-100`) | Single-use token valid 15 min (the config default is 7 days); reset email template. |
| FR-M02-05/06/07 | Cao | Built | `ROLE_CODES` and `PERMISSION_CATALOG` (`libs/contracts/src/permissions.ts`), custom roles (`role.controller.ts`), branch scope (`account_tenant_branch`, `@AllowedBranches`) | Branch changes apply at the next refresh. |
| FR-M02-08 | Thấp | Missing | — | Email OTP for owners. |
| FR-M12-03 | Trung bình | Partial | pbl-mail-service has one DTO and one template (`email-verification.hbs`) | Route by message type; add reset, owner invite (1.2) and end-of-day report. |
| NFR-SE-06 | | Missing | No throttler; no `qos/ratelimit` in KrakenD | 100 req/min per user and 10 logins/min per IP in KrakenD. |

## Phase 3 — screens for the backend that exists

The largest gap for acceptance testing. In pbl-web:

1. Use the real API for **products** (catalog has about 48 routes), **customers**, **suppliers** and **channels**, and
   replace the mock catalog in **POS** and **inventory**.
2. A global working branch from `GET /tenants/current/context` (FR-M03-04); today only inventory and POS have a branch
   picker each.
3. Hide actions by permission from the same context (NFR-SE-04); staff roles come from `/roles`, not a fixed
   owner/manager/cashier list.
4. Refresh tokens, so 0.7 can go ahead.
5. Notifications (`/insight/.../notifications`), and reports through insight's export jobs, not a CSV built in the
   browser.
6. Remove `/users`: no backend route exists.
7. Vietnamese strings into `src/locales` (C04, NFR-PO-01).

## Phase 4 — the remaining *Cao* rows, by module

Backend work, except where a row says web.

### M03 Branches

| FR | Status | Code today | Gap → task |
|---|---|---|---|
| FR-M03-01 | Partial | `/branches` CRUD, soft delete, last branch protected (`apps/platform/src/api/branch/branch.controller.ts:60-119`) | Opening hours field. |
| FR-M03-02 | Partial | `/inventory/.../warehouses`, kinds BRANCH/CENTRAL/QUARANTINE (`apps/inventory/src/modules/warehouses/warehouses.service.ts`) | Create a default warehouse when `platform.branch.created` arrives (`branch-projection.handler.ts` only stores the branch); a CENTRAL warehouse without a branch. |
| FR-M03-04 | Partial | `switch-tenant`; allowed branches in the context | Web, phase 3 item 2. |

### M04 Products

| FR | Status | Code today | Gap → task |
|---|---|---|---|
| FR-M04-01 | Built | Tree of at most 3 levels (`apps/catalog/src/domain/catalog-domain.ts:71`) | |
| FR-M04-02 | Partial | `/catalog/.../products` CRUD, images by upload id | Product code; at most 5 images (code allows 10, `catalog-domain.ts:73`). |
| FR-M04-03 | Partial | `products/{id}/variants/generate`, per-variant SKU, barcode, price; the attributes a product varies on (`products/{id}/attributes`, [ADR-0023](../decisions/0023-product-attributes.md)) | Cost price per variant. ADR-0013 keeps cost in inventory (`avg_unit_cost`); either show inventory's cost in the variant view or amend the SRS. |
| FR-M04-05 | Partial | Price lists, `catalog.price.changed` (`modules/pricing/pricing.service.ts`) | Wholesale price; a price history table (items are overwritten in place). |
| FR-M04-07 | Partial | `GET products` (name, status, category, brand), `GET variants` (name, SKU, barcode) | Price range filter; brand on variants; SKU and barcode search on products. |

### M05 Inventory

| FR | Status | Code today | Gap → task |
|---|---|---|---|
| FR-M05-01, -02, -07 | Built | Stock views, receipts with weighted-average cost, `stock_balance_ledger` with actor and before/after | `POST stock-receipts/{id}/post` and PO receive skip approval; see BR-03/04. |
| FR-M05-03 | Partial | `stock-issues` with damage, sample, disposal, supplier return | Sales leave through the reservation commit. Accept that as "sale" and document it. |
| FR-M05-04 | Partial | Transfers: dispatch moves stock to in-transit, receive adds it, discrepancy status (`modules/transfers/transfers.service.ts`) | Cancel in transit returns stock with a reason (`documents.service.ts:215` refuses it); shortage check at create as well as at dispatch; a task or notification for discrepancies. |
| FR-M05-05 | Partial | Stocktakes with snapshot, variance, approve | Count by barcode, not only by SKU id. |
| FR-M05-06 | Partial | `stock_threshold`; `inventory.stock.below_min` turns into an insight notification | It is emitted only when a threshold is saved (`stock-views.service.ts:558`). Emit it whenever available stock crosses the threshold. |
| FR-M05-08 | Partial | Reservations with commit and release | Expiry, 0.3. |
| BR-03, BR-04 | Partial | Documents drive stock | Remove or restrict `POST /stock-balances/receipts` and the legacy branch receipt, which change stock without a document; build reversal documents (the schema has `REVERSAL` and `reversal_of_ledger_id`, nothing writes them). |

### M06 POS

| FR | Status | Code today | Gap → task |
|---|---|---|---|
| FR-M06-01 | Partial | `GET /pos/products/lookup` exact SKU or barcode (`apps/sales/src/modules/pos/pos.service.ts:43`) | Search and available stock in the lookup; the grid comes from catalog. |
| FR-M06-03 | Partial | Line and order discounts, limits by role | Configurable limits; 0.5. |
| FR-M06-04 | Partial | Customer and loyalty hold at checkout | Group pricing: sales never reads the customer group or `price_list_customer_groups`. |
| FR-M06-06 | Partial | `GET /orders/{id}/print?paper=58mm\|80mm` | Store name and address in the print data; email receipt. |
| FR-M06-05, -07, -08 | Built | Split tenders, returns with restock and refund, shifts with cash variance | |
| UC-01 7a | Missing | Inventory refuses negative stock (`inventory-domain.ts:438`) | A tenant setting plus manager approval for selling below zero. |

### M07–M12

| FR | Status | Code today | Gap → task |
|---|---|---|---|
| FR-M07-01/02/03/06 | Built | Unified order list and filters, lifecycle actions, manual orders, conflict queue | The SRS lifecycle is three fields in code (order status, fulfilment stage and status); amend the SRS or map it in the UI. |
| FR-M08-01 | Built | Customer CRUD, phone unique per tenant | |
| FR-M08-02 | Partial | Groups with `default_discount_rate`, four seeded | Apply the discount at checkout (with FR-M06-04). |
| FR-M08-03 | Partial | Purchase projection from sales events | Average order value; a handler for `sales.order.cancelled` (subscribed, not handled). |
| FR-M09-01 | Built | Members with role and branches | Adding staff needs an existing account; build an invite flow (with 1.2's invite email). |
| FR-M09-02 | Partial | `GET /pos/shifts` with cash figures | Invoice count, revenue across tenders, date filter, staff name. |
| FR-M10-01 | Partial | Suppliers with tax code | Payment terms. |
| FR-M11-01/03/04 | Built | Dashboard with previous-period comparison, sales and inventory reports | |
| FR-M11-02 | **Missing** | No WebSocket or SSE anywhere | SSE per tenant and branch from insight, or 5-second polling (§6.7 allows it); measure the end-to-end delay against NFR-PF-04. |
| FR-M12-01 | Partial | Notifications for completed orders, low stock, mapping required, failed sync | New orders on creation, documents awaiting approval, transfers to receive. |
| FR-M12-04 | Partial | `audit_log` from 5 event types | Create/update/delete of important data with before and after values; plus NFR-SE-08 (below). |
| BR-05 | Partial | `HD-yyyyMMdd-######` from a counter | Four digits and configurable; the date in UTC+7 (sales before 07:00 get yesterday's date); remove the legacy `DH-` format. |
| BR-08 | Partial | Soft deletes on products, variants, customers | Categories and customer groups are hard-deleted (guarded). |

## Phase 5 — *Trung bình* and *Thấp*

Grouped, in suggested order:

- **Real marketplace connectors** (FR-M07-04/05): the adapters only talk to an in-memory simulator
  (`apps/integration/src/infrastructure/rate-limiting/provider-rate-limiter.service.ts`). This depends on SRS open issue 1
  (which marketplace gives API access first). There is no TikTok code.
- **Exports** (FR-M11-06, FR-M04-06, FR-M08-06): a real .xlsx (insight writes SpreadsheetML 2003 XML), a PDF that renders
  Vietnamese, export for every report, Excel import; import files up to 10 MB (code allows 5 MB).
- **Shipping** (FR-M07-07): carrier webhooks or polling; failed delivery and returned-to-sender states.
- **Mobile push** (FR-M12-02): device tokens are stored; nothing sends.
- **Small features:** barcode generation and labels (FR-M04-04), branch price lists (FR-M03-05), currency and receipt
  templates per branch (FR-M03-03), audit search by user, module and date (FR-M12-05), branch growth in the ranking
  (FR-M11-07), offline POS batch sync with the sale's own timestamp (FR-M06-09).
- ***Thấp*:** combos (FR-M04-08, only an unused table), lots and expiry (FR-M05-09), commission (FR-M09-04), email
  OTP (FR-M02-08).
- **pbl-mobile** has no app yet; the SRS needs one (§2.1). It is a separate track.

## Phase 6 — non-functional and acceptance

| NFR | Status | Task |
|---|---|---|
| NFR-SE-03 | Built in 7 services | Force RLS in insight (`force=false` today); RLS for platform's tables, which rely on the repository only; 0.9. |
| NFR-SE-05 | Partial | `helmet` in every service, not only platform. |
| NFR-SE-08 | Missing | Make `audit_log` append-only (revoke UPDATE and DELETE, or a trigger) and keep 12 months. |
| NFR-SC-01 | Partial | Move the integration rate limiter's state from process memory to Redis. |
| NFR-SC-03 | Partial | Run insight export jobs in the background; they are built inside the request today. |
| NFR-MA-02 | Missing | Measure coverage in CI with a 60% threshold for domain code. |
| NFR-MA-03 | Partial | Check that KrakenD routes match the controllers (0.8 found four that do not). |
| NFR-AV-02 | Not checked | Daily backups, 7 kept, RPO 24 h: confirm what the Neon plan keeps, or add a dump job. |
| §8.1 | Partial | Playwright for UC-01 to UC-03; k6 for NFR-PF-01 to -05. |

## Doc drift

Fix these so the next reader is not misled:

- **SRS §6.4** ("current implementation"), §6.5, §6.8: written when four services worked. All eight have real modules.
  RLS exists in seven services, and roles are dynamic (not owner/manager/cashier). Appendix C item 7 is done: the stack
  runs on AWS. The traceability matrix (Appendix A) can take its rows from this document.
- `docs/specs/2026-10-28-screen-api-contracts.md:126` says forgot, reset and verify exist. They are stubs.
- `docs/specs/2026-11-01-adopt-m1-m6/phase-4-inventory.md:66` says `below_min` has no subscriber; insight subscribes.
- `docs/specs/2026-11-01-adopt-m1-m6/phase-4-sales.md` lists print, summary and export as missing; they are built.
- `docs/security.md:91` describes rate limiting with express-rate-limit, which is not installed.
- `docs/specs/2026-10-29-first-wave/catalog.md:32` describes `costPrice` on variants, which the code no longer has.
