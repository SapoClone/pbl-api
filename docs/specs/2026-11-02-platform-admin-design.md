# Platform admin (M01): design

Status: **Accepted** with [ADR-0022](../decisions/0022-platform-admin-identity.md); build steps 1 to 4 are done (see [Build status](#build-status)). Phase 1 of the
[SRS plan](2026-11-02-srs-implementation-plan.md). Endpoint shapes are in
[contract 04](2026-10-28-api-contracts/04-platform-admin.md); this document decides what the contract leaves open
and the order of the work.

## Purpose

An operator signs in to an admin area and manages every store: creates one for a new owner, edits, locks and
reactivates it, assigns plans with dates, and sees usage against the plan's limits, which the services enforce
(SRS FR-M01-01 to -05).

## Out of scope

Platform-wide monitoring (FR-M01-06: the insight and integration `/admin` read models), announcements (FR-M01-07),
support sessions (FR-M01-08), the admin `accounts` screens, payment gateways (payments are recorded by hand, contract
D6). Each gets its own design when it is next.

## Data model (schema `platform`)

| Table | Columns | Notes |
|---|---|---|
| `platform_admin` | `id`, `email`, `name`, `password` (Argon2, null until set), `role` (`super_admin` \| `admin`), `status` (`active` \| `disabled`), `failed_login_count`, `locked_until`, `last_login_at`, audit columns, `deleted_at` | `UQ_platform_admin_email` partial on `deleted_at IS NULL`. Same password and lockout handling as `account`. |
| `plan` | `id`, `code`, `name`, `description`, `price_monthly` (bigint VND), `status` (`active` \| `hidden`), `is_featured`, `quota_branches`, `quota_users`, `quota_products`, `quota_storage_mb` | Not tenant-owned. `code` unique and immutable. Seeded: `free`, `basic`, `pro`. |
| `subscription` | `id`, `code` (`SUB-0001`), `tenant_id`, `plan_id`, `billing_cycle` (`monthly`), `status` (`trialing` \| `active` \| `past_due` \| `expired` \| `cancelled`), `started_at`, `expires_at` (null for `free`) | At most one current row per tenant: partial unique index on `tenant_id` where `status IN ('trialing','active','past_due')`. |
| `subscription_event` | `id`, `subscription_id`, `tenant_id`, `event_type` (`created` \| `upgraded` \| `downgraded` \| `renewed` \| `expired` \| `cancelled`), `plan_code`, `effective_until`, `actor_type` (`platform_admin` \| `account` \| `system`), `actor_id`, `note`, `created_at` | Append-only history behind the subscription detail screen. |
| `subscription_payment` | `id`, `code` (`PAY-00001`), `subscription_id`, `tenant_id`, `amount` (bigint), `method`, `period_start`, `period_end`, `paid_at`, `status` (`paid` \| `pending` \| `failed`), `note` | Recorded by an admin. |
| `tenant_usage` | `tenant_id` (PK), `branches_used`, `users_used`, `products_used`, `storage_mb_used`, `updated_at` | Platform counts branches and members; products and storage arrive as catalog events. |
| `tenant` (existing) | add `suspended_reason`, `suspended_at` | `status` already has `active` \| `suspended`. |

Migrations backfill: every existing store gets an `active` `free` subscription and a `tenant_usage` row with its
current branch and member counts.

## Tokens and guard

- Admin access token: `sub` = admin id, `sub_type = platform_admin`, `sid`, `roles = [<admin role>]`, no `tid`,
  `perms` or `branches`. Same key, issuer, audience and lifetime as store tokens.
- Refresh: `refresh_token` rows with `subject_type = platform_admin` and `tenant_id` null; rotation and reuse
  detection unchanged. `/admin/auth/refresh` accepts only those rows; `/auth/refresh` refuses them.
- `@RequirePlatformAdmin(role?)` in `@pbl/auth`: 403 unless `sub_type = platform_admin` (and the role matches when
  given). Admin controllers use it on the class; `super_admin`-only handlers add the role.
- A store token on an admin route answers 403; an admin token on a store route answers 403 (no `tid`).

## Flows

- **Bootstrap.** Run once per environment from a machine or container that can reach the database, with the same
  `DATABASE_*` settings as the platform service (a database role that may write `platform_admin`):

  ```bash
  PLATFORM_ADMIN_BOOTSTRAP_PASSWORD='…' \
    node dist/apps/platform/apps/platform/src/scripts/create-platform-admin.js --email you@example.com --name "Your Name"
  ```

  Locally, from the repository: `pnpm exec ts-node -r tsconfig-paths/register apps/platform/src/scripts/create-platform-admin.ts …`.
  Exit code 0 created, 2 a super admin already exists (nothing changed), 1 bad input or an error. Running it as an ECS
  one-off task would need the password as a task-definition secret, not a `--overrides` value, which stays visible in
  the task description; that is an infra change, not made yet. There is no recovery path if the only super admin
  loses the password (no admin password reset yet): a break-glass fix is done in the database.
- **Admin sign-in.** As account sign-in: lockout after 5 failures, constant-time comparison, `platform.admin.logged_in`
  for the audit log.
- **Create a store for an owner.** In one transaction: the owner account (created with no password, or the existing
  account with that email), the tenant, the five seeded roles, the owner membership, the default branch (the
  existing `TenantService.create` steps), the subscription and its `created` event, `tenant_usage`. Then an
  `owner-invite` email on the mail queue (a new template in pbl-mail-service).
- **Self-serve store creation** (`POST /tenants`) also starts a `free` subscription.
- **Lock.** `tenant.status = suspended` with a reason; revoke refresh-token families with that `tenant_id`; deny-list
  their `sid`s; `platform.tenant.status_changed`. **Reactivate** reverses the status (`trial` while trialing).
- **Change plan.** `change-plan/check` compares `tenant_usage` with the target plan's quotas; `change-plan` refuses
  (`S001`) when any key is over, closes the current subscription's period and opens the new one, writes the event,
  and publishes `platform.subscription.changed` with the quotas.
- **Quota enforcement.** Platform checks branches (branch create) and members (member add) against the current plan.
  Catalog keeps a `tenant_plan_quota` projection from `platform.subscription.changed` and `platform.plan.changed` and
  checks products and storage itself (no synchronous call, SRS C08). Over the limit: **409 `Q001`**,
  `details: { key, used, limit, planCode }`, which the web turns into the upgrade hint.

## Gateway

Every route of contract 04 that a step below builds is added to `krakend/krakend.json` under
`/platform/api/v1/admin/...` with the `auth/validator` block; the three auth routes (`login`, `refresh`) are public.

## Errors

Codes as in contract 04 (`A001`–`A003`, `A010`, `A011`, `T002`, `T005`–`T007`, `P001`, `P002`, `S001`–`S003`), plus
`Q001` (plan limit reached, 409). New platform codes need the `en`, `vi` and `jp` i18n keys.

## Testing

- Guard: a store token is refused on every admin controller, and an admin token on store routes (per service when its
  admin routes arrive).
- Admin sign-in: lockout, disabled admin, refresh rotation, `/auth/refresh` refusing an admin token and the reverse.
- Bootstrap: creates the first `super_admin`, refuses a second run.
- Lock: the owner's next request fails after locking, sign-in works again after reactivation (e2e on Postgres).
- Plans: change-plan refuses when usage is over the target's quota; quota enforcement in platform and catalog
  (int specs), including the 409 shape.
- Cross-tenant: an admin list returns every store; a store route with a store token still sees only its own.

## Build order (one PR each)

1. **Admin identity:** `platform_admin` and its migration, the bootstrap command, admin `login` / `refresh` /
   `logout` / `me`, `@RequirePlatformAdmin`, the KrakenD routes, the ADR accepted.
2. **Stores:** admin list, detail, create for an owner, edit, lock and reactivate, with the session revocation and
   the events. Needs the `owner-invite` template in pbl-mail-service (its own PR there).
3. **Plans and subscriptions:** the tables, the seed and backfill, plan CRUD for `super_admin`, subscriptions list and
   detail, change plan, payments, the real plan in `GET /tenants/current/context`.
4. **Usage and limits:** `tenant_usage`, enforcement in platform, the catalog projection and its check, the usage
   endpoints.
5. **Screens (pbl-web):** an `/admin` route tree with its own sign-in, then businesses, plans, subscriptions and usage
   (Figma `40:*`).

## Build status

| Step | State |
|---|---|
| 1. Admin identity | Done (PR #33). |
| 2. Stores | Done: list, detail, create for an owner, edit, lock, reactivate. Not done: the `owner-invite` email (needs a pbl-mail-service template and the set-password flow, so an owner created without a password cannot sign in yet). |
| 3. Plans and subscriptions | Done: the tables, the seed and backfill, plan list/read/create/edit (`super_admin` writes), subscription list, detail, history, manual payments, change of plan with its check, and the real plan in `GET /tenants/current/context`. |
| 4. Usage and limits | Done: the usage endpoints and `tenant_usage` (branches and members counted live); enforcement of branches and members in platform (`QuotaService`); catalog keeps `tenant_plan_quota` from `platform.subscription.changed` and `platform.plan.changed`, refuses a product or a stored file over the plan itself, and reports products and storage in `catalog.usage.changed`, which platform writes to `tenant_usage`. All answer 409 `Q001` with `details: { key, used, limit, planCode }`. |
| Accounts, admins, settings | Done: `GET /admin/accounts` (list, detail, sessions, revoke-sessions), `GET/POST/PATCH /admin/admins` with `A010` and `A011`, `GET/PATCH /admin/settings` (one `platform_setting` row per key, defaults for keys never set). `account.code` (`US00001`) is issued at sign-up and backfilled. Not done: events for these actions (no store to carry them), applying the security settings to the sign-in lockout, support sessions. |
| 5. Screens | Branch `feature/web-admin-01` has the 23 screens on mock data; [the guide](../guides/platform-admin-api.md) maps its calls onto these endpoints. |

Decisions taken while building, where the contract or this document left room:

- **Store code.** `tenant.code` (`TN0001`) is a column, as in contract 04; the data model table above omitted it. Codes
  of stores, subscriptions (`SUB-0001`) and payments (`PAY-00001`) are issued by the application under an advisory
  lock, not by database sequences or defaults, so the entity-synchronised local stack gets them too.
- **One subscription row per store, changed in place.** A change of plan updates the row (plan, period) and appends a
  `subscription_event`; contract 04 shows one history across plan changes. The partial unique index still allows closed
  rows if a later flow needs them.
- **Plans are seeded twice on purpose**: the migration seeds them, and an empty `plan` table is filled at startup (the
  local stack never runs migrations). An existing plan table is never touched.
- **Storage** is `quota_storage_mb` (integer) in the table and gigabytes with decimals in the API.
- **`platform.plan.changed` is emitted once per store on the plan**, because events carry a tenant and a plan has none;
  nothing is emitted when a plan is created. Insight subscribes to the three tenant events only (this matches what
  pbl-infra already applies); plan and subscription events have no consumer yet.
- **Plan limits.** Archived and soft-deleted products do not count; stored files do (images and import files, by their
  stored size); members count whatever their status, branches count unless deleted. A store with no row in catalog's
  `tenant_plan_quota` (older than the events) is not limited until its next plan event; every new store announces its
  first plan. Catalog's usage event carries absolute numbers, and platform ignores one measured before the row's last
  update. Two adds of the same store are serialised by an advisory lock, so both cannot pass at limit - 1.
- **Platform consumes events now**: its data source has the inbox table, and pbl-infra has a queue for it.
- **Accounts may have no password** (`account.password` is nullable) so an admin can create an owner who has not set one;
  sign-in treats it like a wrong password.
- **Error codes keep the repository's numbering** (`T001` subdomain taken; new `T006` to `T008`, `P001` to `P003`,
  `S010` to `S012`), because contract 04's `T002` and `S001` were already used for other errors.
- **`created_by` of a store opened by an admin** is the admin's id (a `platform_admin`, not an account).

## Acceptance criteria

- A `super_admin` created by the bootstrap command signs in to `/admin` and nowhere else.
- The admin creates a store for a new owner; the owner gets the invite email, sets a password and finds the store
  with its default branch and a `free` plan.
- Locking a store stops its members within one request; reactivating restores them; both appear in the audit log.
- A store on `free` cannot create a second branch (409 `Q001`) until the admin upgrades it.

## Open questions for the team

1. Plan prices and quotas (SRS appendix C, item 2). The seed uses the contract's examples (`free` 1 branch, 3 users,
   100 products, 1 GB; `basic` 2 / 10 / 2,000 / 10 GB; `pro` 5 / 30 / 10,000 / 50 GB, 599,000 VND) until decided.
2. Trial length, and whether a new self-serve store starts on a `pro` trial or on `free`.
3. How storage is measured while uploads are on local disk (catalog `file-storage.ts`).
4. Whether admins need a second factor before production use (SRS FR-M02-08 covers owners only).
