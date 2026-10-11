# pbl-api — agent guide

Backend for **Sapo Clone** (PBL6, GitHub org `SapoClone`): a multi-tenant
retail/POS SaaS. This repo is a **Nest CLI monorepo with one app per
microservice**. Read this file before changing anything; it is binding.
The *why* behind each rule lives in [docs/decisions/](docs/decisions/) —
read the matching record before changing anything it covers.

## Sources of truth (in priority order)

1. This file + [docs/decisions/](docs/decisions/) (architecture decision records, "ADRs").
2. `pbl-infra/docs/architecture.html` (target architecture) and
   `pbl-infra/docs/erd_viewer.html` (ERD per service: Platform, Catalog,
   Commerce ×5, Finance, Integration, Insight) in the sibling `pbl-infra` repo.
3. The code and its enforced tooling (eslint/prettier, commitlint, husky, CI).
4. `docs/*.md` (VuePress site) — **partly stale**: written for the
   pre-monorepo layout (`src/...` paths, old CORS snippet). When it
   conflicts with 1–3, follow 1–3 and fix the doc if you touch it.

Sibling repos: `pbl-infra` (Terraform/Terragrunt on AWS), `pbl-mail-service`
(SQS-triggered Lambda that sends emails via Resend), `pbl-web` (React SPA),
`pbl-mobile` (Flutter).

## Current state vs target — do not confuse them

| Area | Today | Target (build toward this) |
|---|---|---|
| Services | `platform` has business logic; `catalog`, `commerce`, `finance`, `integration`, `insight` only expose `GET /health` | 6 services owning the ERD domains ([ADR-0001](docs/decisions/0001-monorepo-one-app-per-service.md)) |
| Tenancy | Implemented (P0): stores, branches, `tid` + `roles` in tokens, `@CurrentTenant()`/`@RequireRoles()` ([ADR-0008](docs/decisions/0008-tenancy.md)) | Staff logins, RBAC `perms`, plans/subscriptions |
| Data | One Postgres DB `pbl`, one schema per service; platform has `account`, `tenant`, `account_tenant`, `branch`, `refresh_token` | Platform ERD (Account, Tenant, Branch, Staff, Role/Permission, Plan/Subscription, RefreshToken, …) ([ADR-0002](docs/decisions/0002-database-schema-per-service.md)) |
| Gateway | KrakenD routes every platform endpoint + each stub's `/health`; validates RS256 tokens (`auth/validator`) on protected routes against platform's JWKS | Same, with an https JWKS URL and per-environment config for production ([ADR-0003](docs/decisions/0003-krakend-api-gateway.md)) |
| Auth | Platform signs RS256 access tokens and serves `/.well-known/jwks.json`; KrakenD **and** every app (via `@pbl/auth`) verify them; opaque rotating refresh tokens with reuse detection; Redis deny-list for logout; tokens carry `sub`/`sid`/`sub_type` plus `tid`/`roles` | Step 5: `perms` claim + `@RequirePermission` (with Staff/RBAC); short access-token TTL (the deny-list stays: every service uses it) ([ADR-0004](docs/decisions/0004-authentication-and-tokens.md)) |
| Events | Only SQS `email-verification` → pbl-mail-service ([ADR-0005](docs/decisions/0005-async-work-via-sqs.md)) | Outbox → SNS → SQS with idempotent inboxes; services share data only through events and read models ([ADR-0007](docs/decisions/0007-event-bus.md)) — **not built** (roadmap P1) |
| AWS | All AWS resources were deleted to save credits; pbl-infra keeps the Terraform | Re-apply pbl-infra when deploying |

Never describe a target item as implemented, and never "simplify" code
back away from the target direction.

## Repo layout

```
apps/
  platform/src/        auth · account · tenant · branch — the only app with logic
  catalog|commerce|finance|integration|insight/src/   main.ts, app.module.ts, health.controller(.spec).ts
libs/
  auth/src/            @pbl/auth — token verification, global AuthGuard, Public/AuthOptional/CurrentUser
krakend/krakend.json   gateway routes (every client-facing route must be declared here)
docker/                postgres-init-schemas.sql (creates the 6 schemas), elasticmq.conf (local SQS)
docker-compose.yml     full local stack: 6 apps + postgres + redis + elasticmq + krakend
scripts/verify-local-stack.sh   end-to-end check (health of all 6 + register/login via gateway)
docs/decisions/        ADRs — add one for every new architectural decision
```

The `@/...` path aliases in the root `tsconfig.json` resolve **only into
`apps/platform/src`**; stub apps reset `paths` to the `@pbl/*` libraries only.
Code shared by several services goes in a Nest library under `libs/<name>`
imported as `@pbl/<name>` — see [ADR-0006](docs/decisions/0006-shared-code-in-libs.md);
never import one app's code from another app. A new library needs: a
`nest-cli.json` project (type `library`), `@pbl/<name>` in the root
`tsconfig.json` `paths` **and** in each stub's `tsconfig.app.json` `paths`,
and a `moduleNameMapper` entry in `package.json` `jest` and
`apps/platform/jest.config.json`.

Because apps import from `libs/`, `tsc` keeps repo-relative paths: the
entry is **`dist/apps/<app>/apps/<app>/src/main.js`** (`nest-cli.json`
`entryFile`, `start:prod`, Dockerfile `CMD`), and platform's assets (i18n)
are copied there via an explicit asset `outDir`.

## Service boundaries (from pbl-infra architecture)

- **platform**: auth, tenant, branch, staff, RBAC, subscription — **issues JWTs**
- **catalog**: products, SKU, combos, price lists
- **commerce**: POS, inventory, purchasing, promotions, CRM — kept together so one sale is one DB transaction
- **finance**: cash book, receivables/payables, shipping, COD reconciliation
- **integration**: e-commerce marketplaces (Shopee/Lazada/TikTok), SKU mapping, webhooks
- **insight**: reports, notifications, audit log (read-only)

Rules:
- A service reads/writes **only its own schema**. No cross-schema joins, no
  foreign keys across schemas, no shared entities. Need another service's
  data → internal REST call or (later) an event.
- Put each feature in the service that owns its ERD entity. If ownership is
  unclear, stop and ask; do not default to `platform`.

## Gateway rules (KrakenD) — [ADR-0003](docs/decisions/0003-krakend-api-gateway.md)

- Clients (web, mobile) call **only** `http://<gateway>:8080`. Never point a
  client at a service port.
- Path convention: **gateway path = `/<service>` + the service's own path**.
  `POST /platform/api/v1/auth/email/login` → `platform:3000/api/v1/auth/email/login`.
- **Every new or renamed controller route needs a matching entry in
  `krakend/krakend.json`** (one entry per method+path; `{id}` for params).
  KrakenD 404s anything undeclared. Copy an existing entry: keep
  `output_encoding`/backend `encoding` = `"no-op"`, the `input_headers`
  whitelist, `input_query_strings: ["*"]`, and the backend's
  `qos/circuit-breaker` block (name `<service>-cb`).
- A route that is protected in the service **must also carry the
  `auth/validator` block** in its gateway entry (copy one from a `branches/*`
  route, including the `X-User-Id`/`X-Session-Id`/`X-Subject-Type`/
  `X-Tenant-Id`/`X-Roles` headers in `input_headers` and `propagate_claims`).
  Public routes have no validator. Gateway and service must
  agree on which routes are public.
- Add a forwarded header to the gateway's `input_headers` **and** to
  `security/cors.allow_headers`, and to the service's `enableCors` list.
- Validate after editing:
  `docker compose run --rm --no-deps krakend check -t -c /etc/krakend/krakend.json`
  (use the built image: a plain `devopsfaith/krakend` image lacks the
  `pbl-error-body` plugin). After editing `krakend/plugins/error-body`, run
  `docker compose build krakend && docker compose up -d krakend`.
- Gateway-generated errors (401, bodiless 500 -> 503) get a JSON body from the
  `pbl-error-body` plugin; new forwarded headers also need `X-Request-Id`-style
  entries in `input_headers` and CORS.

## Auth rules — [ADR-0004](docs/decisions/0004-authentication-and-tokens.md)

- Only `platform` creates tokens (`AccessTokenService`, RS256, key from
  `AUTH_JWT_PRIVATE_KEY` + `AUTH_JWT_KEY_ID`). No other service gets the
  private key. Never add HS256, a shared secret, or an `alg` taken from the token.
- Every app imports `PblAuthModule` from `@pbl/auth` exactly once: platform
  via `forRootAsync` in `auth.module.ts` (local key + Redis deny-list), every
  other app via `PblAuthModule.forRemoteJwks()` (needs `AUTH_JWKS_URL`;
  it also reads `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS_ENABLED`
  and honours the logout deny-list when `REDIS_HOST` is set). It
  registers a **global** guard: every route is protected unless `@Public()`.
- Platform handlers use `@ApiAuth(...)` (protected) / `@ApiPublic(...)`
  (public) from `decorators/http.decorators.ts`; other apps use `@Public()` /
  `@AuthOptional()` from `@pbl/auth`. Read the caller with `@CurrentUser()`
  (an `AuthUser`: `id`, `sessionId`, `subjectType`, `exp`).
- `PblAuthModule` tenant mode: other services are `required` (a token without `tid` gets 403 unless `@TenantOptional()`); platform is `optional` and uses `@CurrentTenant()` on store routes.
- In `tenant: 'required'` services an `@AuthOptional()` route still answers 403 when a token *without* `tid` is sent; add `@TenantOptional()` too if the route must accept such tokens.
- Services verify the token themselves; never trust `X-User-Id` etc.
  forwarded by the gateway on their own.
- Tenant/user identity comes **from the token**, never from body, query or path.
- Refresh tokens are opaque and handled only by `RefreshTokenService`
  (hashed, rotated, reuse ⇒ family revoked). Never put them in a JWT or log them.

## API conventions

Every endpoint follows [docs/conventions/api-conventions.md](docs/conventions/api-conventions.md):
URLs, status codes, JSON (camelCase, ISO UTC timestamps, integer VND,
snake_case enums), `{ data, pagination }` lists (`limit` max 100), the error
shape and status table, headers, tenancy and the new-endpoint checklist.

## Platform code conventions

**Feature module** (`apps/platform/src/api/<feature>/`): `<feature>.module.ts`,
`.controller.ts`, `.service.ts`, `dto/`, `entities/`, and a `.spec.ts`
next to each controller/service. Register the module in `api/api.module.ts`.

**Controllers**: `@Controller({ path: '<plural>', version: '1' })` → served
at `/api/v1/<plural>` (URI versioning + `API_PREFIX=api`). Every handler gets
`@ApiAuth` or `@ApiPublic` (also generates Swagger at `/api-docs`). Use
`ParseUUIDPipe` for id params.

**DTOs**: request DTOs named `<action>-<thing>.req.dto.ts`, response
`<thing>.res.dto.ts`. Use the field decorators in
`decorators/field.decorators.ts` (`StringField`, `EmailField`,
`PasswordField`, `UUIDField`, `EnumField`, `*Optional`, …) instead of raw
class-validator — they also emit Swagger metadata. Response DTOs are
`@Exclude()` at class level with `@Expose()` per field (never leak entity
fields like `password`). Convert with `plainToInstance(Dto, x)` or
`entity.toDto(Dto)`. Global `ValidationPipe` uses `whitelist: true` and
returns **422** on validation errors.

**Errors**: throw `ValidationException(ErrorCode.Xnnn)` for business
validation errors (→ 400) or Nest's `HttpException`s (`UnauthorizedException`, …).
`ErrorCode` values are i18n keys: add the key to `i18n/en`, `i18n/vi` **and**
`i18n/jp`. `GlobalExceptionFilter` formats every error — don't
catch-and-reformat in controllers. `findOneByOrFail` → 404 automatically.

**Entities**: extend `AbstractEntity` (adds `created_at/by`,
`updated_at/by`; set `createdBy/updatedBy` to the actor id, or
`SYSTEM_USER_ID` for system actions). UUID PKs. snake_case column names via
`name:`. Explicit constraint names: `PK_<table>_id`, `FK_<table>_<ref>`,
`UQ_<table>_<column>`. Soft delete with `@DeleteDateColumn deleted_at`, and
unique indexes partial on `"deleted_at" IS NULL`. Constructor pattern
`constructor(data?: Partial<X>) { super(); Object.assign(this, data); }`.
Entity lifecycle hooks must be idempotent on **loaded** entities (see the
password-hash `@AfterLoad` guard in `account/entities/account.entity.ts` — a past bug).

**Migrations**: hand-written, reversible SQL in `database/migrations/`
(`<timestamp>-<verb>-<thing>.ts`), `up` and `down` both required.
`DATABASE_SYNCHRONIZE=true` is a **local docker convenience only**; every
schema change still needs a migration, and production runs with
synchronize off.

**Config**: one folder per concern with `<x>.config.ts` =
`registerAs('<x>', …)` + a class-validator `EnvironmentVariablesValidator`
run through `validateConfig`, plus `<x>-config.type.ts`, added to
`AllConfigType` and loaded in `utils/modules-set.ts`. Read config only via
`ConfigService<AllConfigType>` with `{ infer: true }`. `process.env` is read
only by `*.config.ts`, `database/data-source.ts` (TypeORM CLI), and the
Observe bootstrap in `app.module.ts`/`main.ts` — never in services,
controllers or guards.
Add every new env var to `.env.example`, `.env.docker.platform`, and — for
deployment — `pbl-infra/terraform/ecs.tf` (secrets via SSM in `secrets.tf`).

**Other building blocks**: cache keys only via the `CacheKey` enum +
`createCacheKey()`; pagination via `utils/offset-pagination.ts`
(`paginate`, `PageOptionsDto`) or `utils/cursor-pagination.ts`
(`buildPaginator`); passwords only via `utils/password.util.ts` (argon2);
add sensitive request fields to `loggingRedactPaths` in `constants/app.constant.ts`.

**Async work**: never call email providers from the API. Publish to SQS
(`QueueService`) and let `pbl-mail-service` render and send —
[ADR-0005](docs/decisions/0005-async-work-via-sqs.md).

## Shared libraries

`libs/auth` and `libs/common` are also published to GitHub Packages as
`@sapoclone/pbl-auth` and `@sapoclone/pbl-common`
([ADR-0009](docs/decisions/0009-shared-libraries-and-versioning.md)). Apps in this
repo keep importing `@pbl/*`; only the lib build rewrites `@pbl/common` to the
published name.

- Semver. Removing or renaming an export of a lib's `src/index.ts` is a **major**
  bump (CI fails the PR otherwise); other breaking changes (signatures, behaviour,
  peer ranges) also bump the major, enforced by the CHANGELOG and review.
- Every version needs a `## [X.Y.Z]` section in `libs/<name>/CHANGELOG.md`.
- Release by pushing tag `pbl-auth-vX.Y.Z` / `pbl-common-vX.Y.Z` (workflow
  `publish-libs.yml`); never publish by hand. `pnpm pack:libs` and
  `npm publish --dry-run` in the lib folder check a tarball locally.
- `@pbl/common` must not import `@pbl/auth` at runtime. A new third-party import
  in a lib goes into that lib's `package.json` (`dependencies` or `peerDependencies`).
- Tests of the release scripts: `pnpm test:scripts` (node:test).

## Adding a service

Do not copy a stub by hand: run `node scripts/new-service.mjs <name> [--port N] [--dry-run]`.
It creates `apps/<name>` from `templates/service/` and registers the service in
`nest-cli.json`, `package.json`, `docker-compose.yml`, `krakend/krakend.json`, the CI
matrix, `docker/postgres-init-schemas.sql` and `scripts/verify-local-stack.sh`. Keep
`templates/service/` in step with the stubs. Guide: [docs/guides/new-service.md](docs/guides/new-service.md).

## Running and verifying

There is no host `node_modules` by default; everything runs in Docker.

```bash
docker compose up --build -d                 # whole stack; gateway on :8080, platform also on :3000
bash scripts/verify-local-stack.sh           # must print "Stack verified." before you claim success
docker compose up -d --build platform        # REQUIRED after editing platform code: the container
                                             # has no source mount, so watch mode never sees your edit
# run tests/lint inside the image: mount the repo at /work and borrow the image's node_modules
# (Git Bash on Windows: MSYS_NO_PATHCONV=1 and $(pwd -W) instead of $PWD)
docker compose run --rm --no-deps -v "$PWD:/work" -w /work platform sh -c \
  "ln -s /app/node_modules node_modules; pnpm exec jest --config apps/platform/jest.config.json; rm node_modules"
#   libs + stub apps: pnpm exec jest libs apps/catalog/src ...     lint: pnpm exec eslint <files>
# after changing package.json / pnpm-lock.yaml: docker compose build (images bake node_modules)
```

Local SQS is ElasticMQ; queued messages:
`http://localhost:9324/000000000000/email-verification?Action=ReceiveMessage`.

## Testing

- Bug fix → first a failing test that reproduces it, then the fix.
- Unit specs live next to the code (`*.spec.ts`); mock repositories with
  `getRepositoryToken(Entity)` as in `auth.service.spec.ts`.
- New stub-service endpoints get a spec like `health.controller.spec.ts`.
- CI (`.github/workflows/ci.yml`) runs lint once and build+test **per
  service** in a matrix (plus `libs`: `build:libs`/`test:libs`); a new app
  must be added to that matrix, to `nest-cli.json` (with
  `entryFile: apps/<app>/src/main`), `package.json` scripts,
  `docker-compose.yml` (with `AUTH_JWKS_URL`), `docker/postgres-init-schemas.sql`
  (its schema), `krakend.json`, and must import `PblAuthModule.forRemoteJwks()`.

## Git

- Branch: `^(feature|feat|chore|fix|bugfix|hotfix|docs|refactor|test|build|perf|style|ci|release|merge)/([a-zA-Z0-9-]+(/[a-zA-Z0-9-]+)*)$`
  (enforced by `.husky/pre-commit`), e.g. `feat/gateway-jwt-validation`.
- Commits: Conventional Commits (`@commitlint/config-conventional`),
  e.g. `fix(platform): …`, `feat(gateway): …`. Explain the *why* in the body.
- Pre-commit runs lint-staged (`pnpm lint` + `pnpm format`); pre-push runs tests.
- Windows checkouts get CRLF (`core.autocrlf=true`) and prettier then
  reports `Delete ␍` on every line — that's the checkout, not your code.
  Lint an LF copy (`tr -d '\r' < f | … eslint --stdin --stdin-filename f`) to see real issues.

## Known traps

- `database "pbl" does not exist` → the Postgres volume predates the init
  script (init only runs on an empty volume). `docker compose down -v`.
- `.env` is in `.dockerignore` on purpose: `Dockerfile.dev` does `COPY . .`
  and `ConfigModule` would load a host `.env` inside the container.
- KrakenD without `no-op` encoding turns backend 4xx into gateway 500s and
  drops bodies.
- `.env.docker.platform` contains a **committed local-only RSA key**; tests
  generate a throwaway key in `setup-jest.mjs`. Never reuse either elsewhere.
- `krakend.json` uses `disable_jwk_security: true` (http JWKS URL) — valid
  for the local stack only.
- The README links `docs/specs/…monorepo-service-split-design.md`,
  which is not in the repo; ADR-0001–0003 capture its decisions.

## Known open work (don't rediscover, don't depend on)

- Auth endpoints `forgot-password`, `verify/forgot-password`,
  `reset-password`, `verify/email`, `verify/email/resend`
  are placeholders returning a string.
- No rate limiting (despite `docs/security.md`).
- Register saves the account before enqueueing; if SQS fails the account exists
  without a verification email and there is no working resend.
- Access tokens still live `1d` (pbl-web has no refresh logic yet), so the
  Redis logout deny-list stays; every service shares it (ADR-0004 §7).
- Production is not yet updated for the auth/gateway changes (pbl-infra
  still provisions `AUTH_JWT_SECRET`/`AUTH_REFRESH_SECRET` until pbl-infra branch `fix/p0-deploy-config` is merged and applied; no gateway or
  stub services in AWS). The ordered checklist is
  [docs/deploy-actions.md](docs/deploy-actions.md); tick items off there.

## Roadmap

Catalog/commerce work follows [docs/specs/2026-10-10-catalog-commerce-roadmap.md](docs/specs/2026-10-10-catalog-commerce-roadmap.md)
(P0 tenancy → P1 event bus → P2 catalog → P3–P5 commerce → P6 insight → P7–P9).
Each sub-project needs its own approved design spec in `docs/specs/`
(committed; `docs/superpowers/` is gitignored for personal drafts only)
before implementation; do not start a later sub-project's code early, and
apply the roadmap's cross-cutting rules (tenant from token, data across
services only via events, integer VND money).

## Recording decisions

Any change to service boundaries, data ownership, gateway, auth, messaging,
or a cross-cutting convention needs a new ADR in `docs/decisions/` (copy
[the template](docs/decisions/0000-template.md), next number, status
`Proposed` until the team accepts it) **and** an update to this file in the
same PR. Superseding an ADR: mark the old one `Superseded by ADR-XXXX`;
never delete it.
