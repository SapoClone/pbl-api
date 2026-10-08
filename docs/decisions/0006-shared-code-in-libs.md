# ADR-0006: Code shared across services lives in Nest libraries under `libs/`

- **Status:** Proposed
- **Date:** 2026-10-08
- **Scope:** monorepo structure, `nest-cli.json`, `tsconfig.json`

## Context

All reusable building blocks (guards, decorators, DTO helpers, exception
filter, config validation, logging, pagination) currently live inside
`apps/platform/src`, and the root `tsconfig.json` `@/…` aliases resolve
only there. The other 5 services will need the same blocks — first of all
the JWT guard (ADR-0004) — and must not import from another app (ADR-0001).

## Decision

- Shared code becomes a Nest library: `nest g library <name>` →
  `libs/<name>/src`, registered in `nest-cli.json` with type `library`.
- Import alias `@pbl/<name>` (e.g. `@pbl/auth`, `@pbl/common`), added to
  root `tsconfig.json` `paths` and to each app's jest `moduleNameMapper`.
- Candidates, in order: `auth` (JWT/JWKS guard, `@CurrentUser`,
  `@RequirePermission`), `common` (field decorators, error DTOs,
  `GlobalExceptionFilter`, pagination), `config` (`validateConfig`,
  base app config), `logging` (pino factory, redact paths).
- Move code out of `apps/platform` only when a second service needs it;
  move it as-is (behavior-preserving refactor with tests), then switch
  platform to import from the library.
- Libraries contain no service-specific entities or business rules.

## Consequences

- A library change affects every service that imports it; CI already
  builds/tests each service separately, which catches breakage.
- The platform-only `@/…` aliases stay until code is moved; don't add new
  `@/…` aliases for shared code.

## Alternatives considered

- **Copy code into each app:** fast but drifts immediately (security code
  especially must not drift).
- **Separate npm packages:** versioning/publishing overhead with no benefit
  inside one monorepo.
