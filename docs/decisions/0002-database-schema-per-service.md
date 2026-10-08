# ADR-0002: One Postgres database, one schema per service

- **Status:** Accepted
- **Date:** 2026-09-28 (recorded 2026-10-08)
- **Scope:** all services, `docker/postgres-init-schemas.sql`, TypeORM config

## Context

Microservices should own their data, but a separate database (or Neon
project) per service multiplies cost and operations for a student project
running on free tiers. Production uses Neon serverless Postgres (not RDS,
see pbl-infra README); locally, one `postgres:16` container.

## Decision

- One database (`pbl`, one Neon project in production) with **one schema
  per service**: `platform`, `catalog`, `commerce`, `finance`,
  `integration`, `insight`. `commerce` may use sub-schemas per area
  (sales, inventory, purchasing, promotion, customer) as in the ERD.
- Each service connects with `DATABASE_SCHEMA=<service>` (read by
  `database.config.ts` / `data-source.ts`) and touches only that schema.
- **Forbidden:** cross-schema joins, cross-schema foreign keys, sharing
  entity classes between services, reading another service's tables "just
  this once". References to another service's records are plain UUID
  columns ("soft FK"), resolved via internal REST or events.
- Schema changes go through reversible migrations. `synchronize=true` is
  allowed only in local Docker (`.env.docker.platform`).

## Consequences

- Splitting a schema out to its own database later is a config change,
  not a rewrite — as long as the rules above hold.
- Data that crosses services (e.g. product names on an order) is copied at
  write time or fetched via API, never joined.
- Postgres creates the database and runs `docker-entrypoint-initdb.d` only
  on an empty volume; changing the init SQL requires `docker compose down -v`
  locally (see CLAUDE.md "Known traps").
- Target: one DB role per service with grants on its own schema only, so
  the rule is enforced by Postgres rather than by convention.

## Alternatives considered

- **Database per service:** strongest isolation, but cost/ops overhead on
  free tiers; reconsider when a service needs independent scaling of storage.
- **Shared schema:** cheapest, but makes boundaries unenforceable and
  splitting later very expensive.
