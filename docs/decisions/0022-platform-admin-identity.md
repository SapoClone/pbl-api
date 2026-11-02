# ADR-0022: Platform admins are a separate identity with store-less tokens

- **Status:** Proposed
- **Date:** 2026-11-02
- **Scope:** `platform` (admin identity, auth, tenants, plans), `@pbl/auth` (guard), `krakend/krakend.json` (`/admin`
  routes), `pbl-web` (admin screens); extends [ADR-0004](0004-authentication-and-tokens.md) and
  [ADR-0008](0008-tenancy.md)

## Context

The SRS (module M01) and the 23 admin screens in Figma (`40:*`) need an operator who manages every store: create,
lock and reactivate stores, plans and subscriptions, plan limits. [Contract 04](../specs/2026-10-28-api-contracts/04-platform-admin.md)
specifies the endpoints. None of it exists: `platform_admin` is only a name in `libs/auth/src/auth.types.ts`, no
`/admin` route is declared in the gateway, and `GET /tenants/current/context` returns a hard-coded `free` plan.

Two rules shape it. [ADR-0019](0019-store-users-are-accounts.md) makes every store user an `Account` and reserves
`platform_admin` for this decision. [ADR-0008](0008-tenancy.md) makes the tenant come from the token, never from the
request, and every business read is scoped to that tenant; an admin works across tenants by definition.

## Decision

1. **A platform admin is a `platform_admin` row, not an `Account`.** It has its own email, Argon2 password hash, name,
   role (`super_admin` | `admin`) and status (`active` | `disabled`), the same lockout columns as `account`, and
   `last_login_at`. An admin cannot sign in to a store with it, and a store account cannot sign in to the admin.
2. **Admin tokens are platform's ordinary RS256 tokens with `sub_type = platform_admin` and no `tid`, `perms` or
   `branches`.** `roles` carries the admin role. Refresh tokens are `refresh_token` rows with
   `subject_type = platform_admin` and no `tenant_id`; `/admin/auth/refresh` accepts only those, and `/auth/refresh`
   refuses them.
3. **`@RequirePlatformAdmin(role?)` in `@pbl/auth` guards every admin route.** It accepts only
   `sub_type = platform_admin` (and the role when given). Store routes keep refusing a token without `tid` (services
   in `tenant: 'required'` mode, `@CurrentTenant()` in platform), so an admin token cannot act in a store.
4. **Admin routes live under `/<service>/api/v1/admin/...`** and are declared in KrakenD with the `auth/validator`
   block, like every protected route.
5. **Cross-tenant data access happens only in admin modules, through a repository named for it** (`AdminRepository`),
   never by widening `TenantScopedRepository`. In services with forced row-level security, an admin read sets a
   dedicated session flag after the guard has passed, with a SELECT-only policy, the pattern of
   `webhook_routing_select_policy`.
6. **Every admin write emits an event that insight records in the audit log** (actor `platform_admin`, the target
   tenant when there is one).
7. **The first `super_admin` is created by a one-off command**, run like the platform migration task: email from an
   argument, password from an SSM SecureString. It refuses to run when a `super_admin` exists, so running it twice is
   harmless. Later admins are created by a `super_admin` with a set-password email.
8. **Locking a store** sets `tenant.status = suspended`, revokes the refresh-token families whose `tenant_id` is that
   store, and puts their sessions on the Redis deny-list. Membership already hides suspended stores from sign-in and
   store switching. Data is kept; reactivation restores access.

## Consequences

- One more credential store to secure: lockout, password rules and audit apply to it as to accounts.
- `@pbl/auth` gains a decorator, a published-library change (minor version, CHANGELOG entry).
- Every admin endpoint in insight or integration needs its own cross-tenant policy and a test that a store token is
  refused.
- The token, refresh and deny-list machinery is reused; there is no second signing key.
- Revisit if admins must also act inside a store as members, or if a separate admin service is ever split out
  (ADR-0010 would need a reason).

## Alternatives considered

- **A flag on `Account` (`is_platform_admin`).** Fewer tables, but one identity would then sign in to both the
  stores and the admin, a store owner's credentials would reach every store's data, and ADR-0019 reserved the
  admin as a separate identity.
- **A separate admin service with its own signing key.** Stronger isolation, but a ninth service, a second JWKS for
  every service to trust, and no team to run it (ADR-0010).
- **Seed the first super admin in a migration.** Simple, but a migration would hold a password or a fixed email in the
  repository, and would run in every environment.
