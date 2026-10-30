# ADR-0011: Enforce PostgreSQL RLS and per-service DB role isolation

- **Status:** Accepted
- **Date:** 2026-10-27
- **Scope:** `libs/common`, `libs/events`, `docker/postgres-init-schemas.sql`, all `apps/*/src/**/migrations/`

## Context

[ADR-0002](0002-database-schema-per-service.md) establishes one PostgreSQL schema per microservice (`platform`, `catalog`, `inventory`, `sales`, `customer`, `finance`, `integration`, `insight`), and [ADR-0008](0008-tenancy.md) enforces application-layer tenant scoping via `TenantContext` and `TenantScopedRepository`.

However, application-layer repository wrappers alone cannot protect against:
1. Raw SQL queries (`EntityManager.query(...)`, custom CTEs, or atomic `UPDATE ... RETURNING` stock reservation statements) that accidentally omit `WHERE tenant_id = $1`.
2. Accidental cross-schema queries if all services connect with a shared superuser or owner role (`postgres`) that has privileges across all schemas and bypasses Row-Level Security (`BYPASSRLS`).
3. Session-level `SET app.tenant_id` leaking across pooled connections when a connection is returned to the pool.

## Decision

1. **Per-service runtime PostgreSQL roles:**
   - Every service schema `<service>` has a dedicated runtime role `<service>_app` created with `NOLOGIN` or `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`.
   - `<service>_app` has `USAGE` on schema `<service>` only, and `SELECT, INSERT, UPDATE, DELETE` on tables and `USAGE, SELECT, UPDATE` on sequences inside `<service>` only (`ALTER DEFAULT PRIVILEGES` included).
   - `<service>_app` has **no** privileges on any other service's schema (`REVOKE ALL ON SCHEMA <other> FROM <service>_app`). Cross-schema reads or writes fail immediately at the PostgreSQL permission layer.
2. **Transaction-local tenant setting (`app.tenant_id`):**
   - Tenant context in PostgreSQL is always set transaction-locally via `SELECT set_config('app.tenant_id', $1, true)` (equivalent to `SET LOCAL app.tenant_id = ...`), never session-globally (`set_config(..., false)`).
   - `TenantScopedRepository.transaction()` and `runInTenantTransaction(dataSource, work)` in `@pbl/common` automatically invoke `SELECT set_config('app.tenant_id', $1, true)` at the start of the transaction using `TenantContext.require()`.
3. **Row-Level Security (`ENABLE` + `FORCE ROW LEVEL SECURITY`):**
   - Tenant-owned business tables enable and force RLS:
     ```sql
     ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
     ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
     CREATE POLICY <table>_tenant_isolation ON <table>
       USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
     ```
   - When `app.tenant_id` is unset or empty, `NULLIF(current_setting('app.tenant_id', true), '')::uuid` evaluates to `NULL`, causing `tenant_id = NULL` to be false (fail-closed).
4. **Infrastructure / outbox / inbox tables:**
   - System worker tables (`outbox_event`, `inbox_processed`) polled across tenants by background workers do not force tenant RLS, or carry explicit tenant metadata inside their payload envelope (`EventEnvelope.tenantId`), which `EventConsumerService` restores into `TenantContext` before invoking handler logic.

## Consequences

- Defense-in-depth: both `TenantScopedRepository` (application layer) and PostgreSQL RLS + schema role permissions (database layer) enforce tenant and service boundaries.
- Raw SQL inside `runInTenantTransaction` or `TenantScopedRepository.transaction` automatically inherits transaction-scoped `app.tenant_id` without connection pool leakage.
- Integration tests can connect as `<service>_app` (or `SET LOCAL ROLE <service>_app`) to prove both cross-schema denial and RLS enforcement under `NOBYPASSRLS`.

## Alternatives considered

- **Application-only filtering (`TenantScopedRepository` without RLS):** Rejected for v2 because high-concurrency SQL (`UPDATE stock_balance ... RETURNING`) and reporting queries use raw parameterised SQL where a missing predicate could leak tenant data.
- **Session-level `SET app.tenant_id`:** Rejected because pooled connections in TypeORM/`pg` can reuse sessions across requests if a reset fails.
