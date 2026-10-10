# P0 — Platform tenancy: design

- **Date:** 2026-10-10
- **Status:** Approved design, awaiting implementation plan
- **Roadmap:** [catalog & commerce roadmap](2026-10-10-catalog-commerce-roadmap.md), sub-project P0
- **Decisions:** [ADR-0008 tenancy](../decisions/0008-tenancy.md); builds on [ADR-0004](../decisions/0004-authentication-and-tokens.md) step 5 (tenant part only)

## Purpose

Every catalog and commerce table belongs to a store (tenant) and often a
branch, but platform has no Tenant or Branch yet and tokens carry no tenant.
P0 adds the minimum so that later services can take the tenant from the
token from their first line of code:

- a signed-up **account** can create a **store** (tenant) and becomes its owner;
- a store has **branches** (one created automatically);
- tokens carry `tid` (selected store) and `roles` (role in that store);
- `@pbl/auth` gives every service `@CurrentTenant()` and `@RequireRoles()`.

## Out of scope

Staff logins, RBAC permissions (`perms`), plans/subscriptions, BranchSetting,
TenantUsage, PlatformAdmin/SupportSession, password change/reset, and any
pbl-mobile or pbl-web change.

## Data model (schema `platform`)

| Table | Columns | Notes |
|---|---|---|
| `account` (renamed from `user`) | `id` uuid PK, `email` (unique among non-deleted), `password` (argon2), `name` varchar(100) not null default `''`, `phone` varchar(20) null, `status` varchar(20) not null default `'active'` (`active`/`disabled`), `deleted_at`, audit columns | `username`, `bio`, `image` dropped. The password-hash `@AfterLoad` guard from `user.entity.ts` moves along. |
| `tenant` | `id` uuid PK, `name` varchar(150), `subdomain` varchar(30), `phone` null, `email` null, `address` null, `status` varchar(20) default `'active'` (`active`/`suspended`), `deleted_at`, audit columns | `UQ_tenant_subdomain` partial on `deleted_at IS NULL` |
| `account_tenant` | `account_id` uuid FK→account, `tenant_id` uuid FK→tenant, `role` varchar(32), `created_at` | PK `(account_id, tenant_id)`. P0 role values: `owner`. |
| `branch` | `id` uuid PK, `tenant_id` uuid FK→tenant, `name` varchar(150), `code` varchar(20), `address` null, `phone` null, `is_warehouse` bool default true, `status` varchar(20) default `'active'`, `deleted_at`, audit columns | `UQ_branch_tenant_code` on `(tenant_id, code)` partial on `deleted_at IS NULL`; index on `tenant_id` |
| `refresh_token` (existing) | `tenant_id` now filled | Rotation copies it; switching tenant starts a new family |

Removed: `post` table, `PostEntity`, post module/controller/DTOs/factory/seeder.
The user factory/seeder become account factory/seeder.

Migration `…-introduce-tenancy.ts` (reversible): rename `user` → `account`
(and its `PK_`/`UQ_` names), drop the three columns, add `name`/`phone`/`status`,
create `tenant`, `account_tenant`, `branch`, drop `post`. Existing accounts keep
working and simply have no tenant.

## Token claims

Added to the RS256 access token (ADR-0004 §3):

- `tid` — selected tenant id; **absent** when no tenant is selected.
- `roles` — the account's role(s) in that tenant, e.g. `["owner"]`; `[]` without `tid`.

`sub_type` stays `account`. `perms` and `branches` come with Staff/RBAC.
`AuthUser` (in `@pbl/auth`) gains `tenantId?: string` and `roles: string[]`.

## Flows

1. **Register** — `POST /auth/email/register {email, password, name?}` creates an
   account only. `name` is optional so existing clients keep working.
2. **Create store** — `POST /tenants {name, subdomain, phone?, email?, address?}`,
   authenticated, no `tid` needed. In **one transaction** it creates the
   tenant, adds the caller as `owner`, and creates branch
   `{code: "CN01", name: "Chi nhánh chính", is_warehouse: true}`. Then it
   behaves like a tenant switch: the caller's current refresh family is
   revoked, and a new token pair with `tid` is returned with the tenant.
3. **Login** — `POST /auth/email/login {email, password, tenantId?}`:
   - `tenantId` given: must be an active membership, else **404** (no leak).
   - not given, exactly one active membership: selected automatically.
   - not given, zero or several: token without `tid`.

   The response keeps `userId`, `accessToken`, `refreshToken`, `tokenExpires`
   (pbl-mobile reads `userId`; it holds the account id). It adds
   `tenantId: string | null` and `tenants: [{id, name, subdomain, role}]` so
   the app can show a store picker or the create-store screen.
4. **Switch store** — `POST /auth/switch-tenant {tenantId}`, authenticated:
   the membership must exist and be active (else 404). The current family
   is revoked and its `sid` denied (same as logout), and a new family with
   `tid` is issued. The response has the same shape as login.
5. **Refresh** — rotation keeps `tenant_id`. When the row has a tenant, the
   membership is re-checked and roles re-read. If the account was removed
   from the tenant, or the tenant is suspended, the family is revoked → 401.
6. **Disabled account** (`status = disabled`) — login and refresh answer 401.

## API (platform; gateway prefix `/platform/api/v1`)

| Method & route | Access | Behaviour |
|---|---|---|
| `POST /auth/email/register` | public | adds optional `name` |
| `POST /auth/email/login` | public | `tenantId?`; response adds `tenantId`, `tenants[]` |
| `POST /auth/switch-tenant` | authenticated | new token pair for the tenant |
| `POST /auth/refresh`, `POST /auth/logout` | as today | keep/drop `tid` as above |
| `GET /accounts/me` | authenticated | `{id, email, name, phone, status, createdAt}` |
| `PATCH /accounts/me` | authenticated | `{name?, phone?}` |
| `GET /tenants` | authenticated | stores the caller belongs to, with role |
| `POST /tenants` | authenticated | create store (flow 2) |
| `GET /tenants/current` | `tid` | the selected store |
| `PATCH /tenants/current` | `tid` + `owner` | `{name?, phone?, email?, address?}` (subdomain is immutable) |
| `GET /branches` | `tid` | paginated, filter `status` |
| `POST /branches` | `tid` + `owner` | `{name, code, address?, phone?, isWarehouse?}` |
| `GET /branches/{id}` | `tid` | 404 if not in the tenant |
| `PATCH /branches/{id}` | `tid` + `owner` | partial update incl. `status` |
| `DELETE /branches/{id}` | `tid` + `owner` | soft delete; refuses the last active branch |

Removed: `GET/POST /users`, `GET /users/load-more`, `GET/PATCH/DELETE /users/{id}`,
`POST /users/me/change-password` (placeholder), `GET /users/me` → `/accounts/me`,
and all `/posts` routes. This also closes the known gap of `/users/{id}`
having no ownership check.

Validation: `subdomain` is lowercase `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`
(3–30 chars) and not reserved (`www`, `api`, `admin`, `app`, `static`,
`platform`, `catalog`, `commerce`, `finance`, `insight`, `integration`);
branch `code` is `^[A-Z0-9_-]{1,20}$`. Invalid input → 422 (global
ValidationPipe).

## `@pbl/auth` changes (all services)

- `AccessTokenVerifier` maps `tid` → `tenantId`, `roles` → `roles` (default `[]`).
- `@CurrentTenant()` param decorator → the `tid`; throws **403** when the token has none.
- `@RequireRoles(...roles)` metadata, enforced by the global guard → **403** when
  the caller lacks every listed role (implies a tenant is required).
- `PblAuthModule` option `tenant: 'required' | 'optional'`:
  - `forRemoteJwks()` defaults to `required`: on non-`@Public()` routes a
    token without `tid` gets 403. A `@TenantOptional()` decorator exists for
    exceptions.
  - Platform uses `optional`, since register, create store and switch happen
    before a tenant is selected. Its tenant routes use `@CurrentTenant()`.

## Gateway

- New routes added to `krakend/krakend.json`; `/users/*` and `/posts/*` removed.
- `propagate_claims` adds `["tid", "X-Tenant-Id"]`; `X-Tenant-Id` is added to the
  protected endpoints' `input_headers` (informational, services still verify).
- `scripts/verify-local-stack.sh` adds the flow: register → create store →
  token has `tid` → create branch → list branches.

## Errors and security

- Another tenant's branch, or a tenant the caller is not a member of → **404**.
- New `ErrorCode`s (400 via `ValidationException`, messages in `en`/`vi`/`jp`):
  - `T001` `tenant.error.subdomain_exists`
  - `B001` `branch.error.code_exists`
  - `B002` `branch.error.last_branch`
- Missing tenant on a tenant route → 403; missing role → 403.
- Every branch query includes `tenant_id = :tid`. Tests assert cross-tenant isolation.
- Store creation and membership changes run in a single transaction.

## Testing

- **Unit:**
  - tenancy service (create store transaction, subdomain conflict);
  - login matrix (0/1/many memberships, explicit `tenantId`, non-member);
  - switch-tenant (revokes old family, issues `tid`);
  - refresh (keeps `tid`, removed member → revoked);
  - branch service (code conflict, last-branch rule, tenant filter);
  - `@pbl/auth` (verifier maps `tid`/`roles`, `@CurrentTenant`, `@RequireRoles`, tenant modes).
- **Migration:** up/down/up on an empty database.
- **E2E (gateway):** the verify-script flow, plus tenant B gets 404 on tenant A's branch.

## Acceptance criteria

1. A new user can register, create a store, and receive a token whose
   `tid` is that store, in two calls.
2. Login selects the only store automatically; with several stores it
   returns the list and no `tid`; `switch-tenant` selects one.
3. Branch CRUD works for the owner, and is invisible across tenants.
4. A service using `PblAuthModule.forRemoteJwks()` rejects a token without `tid`
   with 403 on protected routes, verified by `@pbl/auth` module tests: the
   stubs only have public `/health` routes so far.
5. All platform, lib and stub tests pass; `verify-local-stack.sh` passes.
6. CLAUDE.md, ADR-0008 and `docs/deploy-actions.md` (migration note) are updated.
