# ADR-0008: Tenant comes from the token; every business row is tenant-scoped

- **Status:** Accepted (2026-10-10). Implemented by P0 of the [catalog & commerce roadmap](../specs/2026-10-10-catalog-commerce-roadmap.md) ([P0 design](../specs/2026-10-10-p0-platform-tenancy-design.md)).
- **Date:** 2026-10-10
- **Scope:** all services, `@pbl/auth`, every business table

## Context

Sapo Clone is multi-tenant SaaS: one deployment serves many stores, and
each store has branches. Every ERD table outside platform's global tables
carries `tenant_id`. Platform had no Tenant/Branch, and tokens had no tenant
(ADR-0004 step 5 pending), so catalog/commerce could not be built correctly.

## Decision

- **Model (platform):** `account` (a person who signs up), `tenant` (store),
  `account_tenant(account_id, tenant_id, role)`, `branch(tenant_id, …)`. One
  account may own or belong to several stores.
- **One tenant per token.** The access token carries `tid` (selected store)
  and `roles`. A token without `tid` can only use platform's account-level
  routes: register, create store, list stores, switch store. Switching store
  issues a new token family (`POST /auth/switch-tenant`).
- **Tenant only from the token.** Services read it with `@CurrentTenant()`
  from `@pbl/auth`, never from body, query, path or headers. `X-Tenant-Id`
  from the gateway is informational only.
- **Every business table has `tenant_id`.** Every query filters by it, using
  the tenant-scoped repository base introduced in P1. Unique constraints that
  are per store include `tenant_id`, e.g. branch `code`, product `sku_code`.
- **Isolation answers 404**, not 403, so other stores' ids are not revealed.
- **Non-platform services require a tenant by default**
  (`PblAuthModule.forRemoteJwks()` → `tenant: 'required'`).
- **Roles:** P0 has `owner`; `@RequireRoles()` checks the token's `roles`.
  Fine-grained permissions (`perms`, `@RequirePermission`) arrive with
  Staff/RBAC.

## Consequences

- Every new entity, query, unique index and test must include the tenant.
  Reviewers check for it.
- Mobile/web must handle the store picker (login without `tid`) and the
  create-store screen.
- Cross-tenant tests (tenant B cannot see tenant A's data) are mandatory
  for every new resource.

## Alternatives considered

- **A fixed default tenant from config until later:** faster for mobile,
  but every service would need rework once real tenants exist.
- **Database or schema per tenant:** strong isolation, but heavy for many
  small stores on a free-tier Postgres; row-level `tenant_id` matches the ERD.
- **Postgres row-level security:** a good later hardening layer, but it
  needs per-request session settings through TypeORM. Revisit once
  repositories are centralised.
