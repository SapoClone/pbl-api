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
| Data | One Postgres DB `pbl`, one schema per service; platform has only `user`/`refresh_token`/`post` | Platform ERD (Account, Tenant, Branch, Staff, Role/Permission, Plan/Subscription, RefreshToken, …) ([ADR-0002](docs/decisions/0002-database-schema-per-service.md)) |
| Gateway | KrakenD routes every platform endpoint + each stub's `/health`; validates RS256 tokens (`auth/validator`) on protected routes against platform's JWKS | Same, with an https JWKS URL and per-environment config for production ([ADR-0003](docs/decisions/0003-krakend-api-gateway.md)) |
| Auth | Platform signs RS256 access tokens and serves `/.well-known/jwks.json`; KrakenD **and** every app (via `@pbl/auth`) verify them; opaque rotating refresh tokens with reuse detection; Redis deny-list for logout; tokens carry only `sub`/`sid`/`sub_type` | Step 5: `tid`/`roles`/`perms` claims + `@RequirePermission` once Tenant/Staff/RBAC exist; short access-token TTL, then drop the deny-list ([ADR-0004](docs/decisions/0004-authentication-and-tokens.md)) |
| Events | Only SQS `email-verification` → pbl-mail-service ([ADR-0005](docs/decisions/0005-async-work-via-sqs.md)) | SNS/SQS event bus, ~20 domain events, outbox/inbox — **not built** |
| AWS | All AWS resources were deleted to save credits; pbl-infra keeps the Terraform | Re-apply pbl-infra when deploying |

Never describe a target item as implemented, and never "simplify" code
back away from the target direction.

## Repo layout

```
apps/
  platform/src/        auth · users · (posts: boilerplate leftover) — the only app with logic
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
  whitelist, and `input_query_strings: ["*"]`.
- A route that is protected in the service **must also carry the
  `auth/validator` block** in its gateway entry (copy one from a `users/*`
  route, including the `X-User-Id`/`X-Session-Id`/`X-Subject-Type` headers in
  `input_headers`). Public routes have no validator. Gateway and service must
  agree on which routes are public.
- Add a forwarded header to the gateway's `input_headers` **and** to
  `security/cors.allow_headers`, and to the service's `enableCors` list.
- Validate after editing:
  `docker run --rm -v "$PWD/krakend:/etc/krakend" devopsfaith/krakend:2.6 check -t -c /etc/krakend/krakend.json`

## Auth rules — [ADR-0004](docs/decisions/0004-authentication-and-tokens.md)

- Only `platform` creates tokens (`AccessTokenService`, RS256, key from
  `AUTH_JWT_PRIVATE_KEY` + `AUTH_JWT_KEY_ID`). No other service gets the
  private key. Never add HS256, a shared secret, or an `alg` taken from the token.
- Every app imports `PblAuthModule` from `@pbl/auth` exactly once: platform
  via `forRootAsync` in `auth.module.ts` (local key + Redis deny-list), every
  other app via `PblAuthModule.forRemoteJwks()` (needs `AUTH_JWKS_URL`). It
  registers a **global** guard: every route is protected unless `@Public()`.
- Platform handlers use `@ApiAuth(...)` (protected) / `@ApiPublic(...)`
  (public) from `decorators/http.decorators.ts`; other apps use `@Public()` /
  `@AuthOptional()` from `@pbl/auth`. Read the caller with `@CurrentUser()`
  (an `AuthUser`: `id`, `sessionId`, `subjectType`, `exp`).
- Services verify the token themselves; never trust `X-User-Id` etc.
  forwarded by the gateway on their own.
- Tenant/user identity comes **from the token**, never from body, query or path.
- Refresh tokens are opaque and handled only by `RefreshTokenService`
  (hashed, rotated, reuse ⇒ family revoked). Never put them in a JWT or log them.
- Known gap: `/users/:id` PATCH/DELETE have **no ownership or role check**
  yet; tokens carry no roles until step 5. Don't copy that pattern.

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
password-hash `@AfterLoad` guard in `user.entity.ts` — a past bug).

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
  `getRepositoryToken(Entity)` as in `user.service.spec.ts`.
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
- The README links `docs/superpowers/specs/…monorepo-service-split-design.md`,
  which is not in the repo; ADR-0001–0003 capture its decisions.

## Known open work (don't rediscover, don't depend on)

- Auth endpoints `forgot-password`, `verify/forgot-password`,
  `reset-password`, `verify/email`, `verify/email/resend`,
  `users/me/change-password` are placeholders returning a string.
- `posts` create/update/delete throw "not implemented"; `post`/`user` are
  boilerplate, to be replaced by the platform ERD (Account, Staff, …).
- No rate limiting (despite `docs/security.md`), no ownership checks.
- Register saves the user before enqueueing; if SQS fails the user exists
  without a verification email and there is no working resend.
- Access tokens still live `1d` (pbl-web has no refresh logic yet), so the
  Redis logout deny-list stays (ADR-0004 §7).
- pbl-infra still provisions `AUTH_JWT_SECRET`/`AUTH_REFRESH_SECRET`; before
  the next deploy it must provision `AUTH_JWT_PRIVATE_KEY` + `AUTH_JWT_KEY_ID`
  (SSM) for platform and `AUTH_JWKS_URL` for the other services.

## Recording decisions

Any change to service boundaries, data ownership, gateway, auth, messaging,
or a cross-cutting convention needs a new ADR in `docs/decisions/` (copy
[the template](docs/decisions/0000-template.md), next number, status
`Proposed` until the team accepts it) **and** an update to this file in the
same PR. Superseding an ADR: mark the old one `Superseded by ADR-XXXX`;
never delete it.
