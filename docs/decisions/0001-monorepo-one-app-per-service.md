# ADR-0001: Nest monorepo with one app per microservice

- **Status:** Accepted
- **Date:** 2026-09-28 (recorded 2026-10-08)
- **Scope:** whole repo

## Context

Sapo Clone is split into 6 bounded contexts (pbl-infra
`docs/architecture.html`): platform, catalog, commerce, finance,
integration, insight. The team is small, works on a course schedule, and
shares one toolchain (NestJS 11, TypeORM, pnpm, Node 24). The original
single NestJS app (from the vndevteam boilerplate) was moved into
`apps/platform` in PR #2; the other five were scaffolded as stubs that only
expose `GET /health`.

## Decision

- One Nest CLI monorepo (`nest-cli.json` `"monorepo": true`), one
  application per service under `apps/<service>/`, each with its own
  `main.ts`, `AppModule`, `tsconfig.app.json`, build output
  `dist/apps/<service>`, and Docker container.
- Each app is deployed and scaled independently (target: one ECS Fargate
  task per service) and listens on port 3000 inside its container.
- Apps never import from each other. Shared code goes through `libs/`
  (ADR-0006).
- Service boundaries follow the ERD in pbl-infra `docs/erd_viewer.html`;
  `commerce` deliberately keeps POS, inventory, purchasing, promotions and
  CRM together so that a sale and its stock movement commit in one
  database transaction.

## Consequences

- One `package.json`/lockfile: a dependency bump affects every service, so
  CI builds and tests every service separately (`ci.yml` matrix).
- Adding a service requires updating, in one PR: `nest-cli.json` projects,
  `package.json` scripts (`start:dev:<s>`, `build:<s>`, `test:<s>`),
  `docker-compose.yml`, `docker/postgres-init-schemas.sql`,
  `krakend/krakend.json`, the CI matrix, and pbl-infra.
- The root `tsconfig.json` `@/…` aliases point into `apps/platform/src`
  only (inherited from the single-app era); other apps use relative imports.

## Alternatives considered

- **Polyrepo (one repo per service):** duplicated tooling and dependency
  drift across 6 repos is too costly for this team.
- **Modular monolith (one deployable):** simpler, but the course goal and
  the target architecture are independently deployable microservices.
