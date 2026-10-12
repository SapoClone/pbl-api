# Service Foundations (GW-1, PLT-2, PLT-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining acceptance criteria of three Jira tickets:
- **SCRUM-33 (GW-1):** structured gateway errors.
- **SCRUM-27 (PLT-2):** a service template, the shared package published with semver, trace-id, and readiness.
- **SCRUM-32 (PLT-7):** an automatic tenant filter in the data layer, and tenant propagation across HTTP calls and events.

**Architecture:**
- **New shared lib `libs/common` (`@pbl/common`).** It holds what every service needs, next to `libs/auth`:
  - error shape and filter;
  - request id / trace logging;
  - health and readiness;
  - a `bootstrapService()` helper;
  - tenant context in AsyncLocalStorage;
  - a tenant-scoped TypeORM repository;
  - an event envelope;
  - an internal HTTP client.
- **Stubs and the template:** the five stub services and the new service template are built on `@pbl/common`.
- **Gateway:** KrakenD gets a small Go handler plugin that fills gateway-generated error responses with the standard JSON shape.
- **Publishing:** both libs are published to GitHub Packages from this monorepo, as `@sapoclone/pbl-auth` and `@sapoclone/pbl-common`. GitHub Packages requires the npm scope to match the org `SapoClone`. Inside the monorepo the import paths stay `@pbl/auth` / `@pbl/common`.

**Tech Stack:** NestJS 11, TypeORM 0.3, nestjs-pino, @nestjs/terminus, @nestjs/axios, Node AsyncLocalStorage, KrakenD 2.6.3 + Go plugin (krakend/builder:2.6.3), GitHub Actions, GitHub Packages.

**Authority:**
- Jira acceptance criteria for SCRUM-33, SCRUM-27 and SCRUM-32 (quoted in each task).
- ADR-0003 (gateway), ADR-0004 (auth), ADR-0008 (tenancy).
- `docs/conventions/api-conventions.md`, `CLAUDE.md`.
- Decisions by the user on 2026-10-11:
  - keep the `/<service>/api/v1/...` gateway paths;
  - publish the libs from the monorepo;
  - do all four work items now.

## Global Constraints

- Never add `Co-Authored-By` or "Generated with" lines. Use Conventional Commits. No push, no merge, no deploy, no publish to the real registry. Publishing is verified with `pnpm pack` / `npm publish --dry-run` only.
- Never run `docker compose down -v`.
- **Tenant comes only from the verified access token (ADR-0008).**
  - Tenant context is set by `@pbl/auth`'s guard from `AuthUser.tenantId`, never from a header, body or query.
  - Events carry `tenantId` from the context.
  - The internal HTTP client forwards the caller's `Authorization` header, so the callee verifies the token and derives the tenant itself.
  - The client never sends an `X-Tenant-Id` the callee would trust.
- **Error shape** (api-conventions §6):
  - fields: `{ timestamp, statusCode, error, message, errorCode?, details? }`;
  - `stack`/`trace` appear only with `APP_DEBUG=true`.
  - Gateway-generated errors use the same fields, without `errorCode`/`details`.
- Request id header is `X-Request-Id`. It is accepted from the client, otherwise generated (uuid v4). It is echoed in the response, logged on every line as `req.id`, and forwarded on internal HTTP calls and in events as `traceId`.
- The KrakenD image is pinned to `devopsfaith/krakend:2.6.3`; plugins require an exact version match.
- Platform's existing behaviour, tests, and `scripts/verify-local-stack.sh` must keep passing. Platform keeps its own i18n `GlobalExceptionFilter`; only the stubs and the template use the lib filter.
- Tests run inside the platform image. On Windows/Git Bash:
  ```bash
  export MSYS_NO_PATHCONV=1
  docker compose run --rm --no-deps -v "$(pwd -W):/work" -w /work platform sh -c 'ln -sf /app/node_modules node_modules; <COMMAND>; rm -f node_modules'
  ```
  The tasks call this `IN_IMAGE`. In the image, `REDIS_HOST=redis` is set by env_file; tests that build `forRemoteJwks()` must control it.
- Lint runs on an LF copy:
  ```bash
  git -c core.autocrlf=false archive HEAD | docker compose run --rm --no-deps -T platform sh -c 'mkdir -p /tmp/lf && tar -x -C /tmp/lf && cd /tmp/lf && ln -s /app/node_modules node_modules && pnpm lint:check'
  ```
- In Git Bash, `curl -o /dev/null` occasionally returns exit 23. If the verify script fails on that, rerun it before investigating.
- **New dependencies:** use only packages already resolvable in `node_modules` where possible (`uuid`, `nestjs-pino`, `@nestjs/terminus`, `@nestjs/axios`, `axios`). If a new direct dependency is needed:
  - add it with the lockfile-only method: `pnpm add <pkg>@<exact> --lockfile-only` in `node:24-alpine` with `corepack prepare pnpm@9.12.3`, on a scratch copy of `package.json`, `pnpm-lock.yaml` and `.npmrc`;
  - then `docker compose build`.

## Review Focus

1. **No path lets a client choose the tenant.**
   - Not via a header through the HTTP client.
   - Not via the event envelope on the consumer side: the consumer takes the tenant from the envelope, and only internal producers write envelopes.
   - Not by running a repository call outside a tenant context: that must throw, never return all tenants' rows.
   - Pinned in Tasks 3–4.
2. **The tenant-scoped repository must filter every read and write.**
   - Reads: `find`, `findOne`, `count`, `exists`, query builders.
   - Writes: `update`, `softDelete`, `delete`, `save` — `save` sets `tenantId` and refuses a mismatching one.
   - Inside transactions too.
   - Pinned in Task 3 with a real Postgres test.
3. **The gateway plugin must not swallow or alter service responses.**
   - A service's own JSON error (e.g. a 404 with body) passes through unchanged.
   - Only empty-body error responses generated by KrakenD itself are rewritten.
   - Pinned in Task 1.
4. **The published packages must not ship test files, local keys or source maps pointing to absent files, and must declare their peer dependencies.** Pinned in Task 6.

---

### Task 1: Structured gateway errors (KrakenD plugin)

**Jira (SCRUM-33):** "Service lỗi hoặc timeout thì gateway trả lỗi có cấu trúc, không để lộ stack trace."

**Files:**
- Create `krakend/plugins/error-body/` (`go.mod`, `main.go`, `main_test.go`) and `krakend/Dockerfile`.
- Modify `krakend/krakend.json`, `docker-compose.yml` (krakend service: `build: ./krakend`, image tag), `scripts/verify-local-stack.sh`, `docs/decisions/0003-krakend-api-gateway.md`, `docs/conventions/api-conventions.md` §6, and `CLAUDE.md` (gateway rules, validate command).

**Design:**
- **Plugin type:** an HTTP server plugin (`plugin/http-server`) named `pbl-error-body`. It wraps the whole router.
- **Response wrapper:**
  - Records the status from `WriteHeader`.
  - Passes every body byte through untouched.
  - When the handler returns, if status ≥ 400 and **zero** body bytes were written, it writes:
    - header `Content-Type: application/json`;
    - body `{"timestamp":"<RFC3339 ms UTC>","statusCode":<s>,"error":"<http.StatusText>","message":"<msg>"}`.
  - Use a JSON encoder; no string concatenation.
  - Headers must not be flushed before the decision. Buffer the status until the first `Write` or the end of the handler.
- **Status mapping:**
  - Gateway-generated 500 (backend unreachable, circuit open, timeout) → **503** "Service Unavailable", message `"Upstream service unavailable"`.
  - 401 → "Unauthorized", message `"Missing or invalid access token"`.
  - 403 → `"Forbidden"`.
  - Others → `http.StatusText(s)`.
  - A 500 **with** a body comes from a service and passes through as 500.
- **`krakend.json`:**
  - Add `"plugin": {"pattern": ".so", "folder": "/opt/krakend/plugins/"}` at the root.
  - Add `"plugin/http-server": {"name": ["pbl-error-body"]}` to the root `extra_config`.
  - Add `router.error_body` for 404 and 405 with the same JSON shape (static timestamp is not possible, so omit `timestamp` there and document it).
  - Add `X-Request-Id` to every endpoint's `input_headers`, to `security/cors.allow_headers`, and to `expose_headers`.
- **`krakend/Dockerfile`:** multi-stage.
  - Stage 1: `krakend/builder:2.6.3`, `go build -buildmode=plugin -o pbl-error-body.so`.
  - Stage 2: `devopsfaith/krakend:2.6.3`, copy the `.so` to `/opt/krakend/plugins/`.
  - Run `krakend check-plugin` (or `krakend test-plugin`) against the `go.sum` in the build stage, if available in 2.6.
  - Compose keeps mounting `krakend.json` from `./krakend`.
- **Go tests** (`main_test.go`, run in the builder image with `go test ./...`):
  - empty 500 → 503 JSON;
  - empty 401 → 401 JSON;
  - a 404 with a JSON body → unchanged;
  - a 200 → unchanged;
  - a 500 with a body → unchanged (status and bytes).

**Steps:**
- [ ] **Step 1:** Write `main_test.go` with the five cases. Run it in the builder image. Expect FAIL to compile or to pass.
- [ ] **Step 2:** Implement `main.go` (registerer pattern for KrakenD 2.6 http-server plugins: `var HandlerRegisterer = registerer("pbl-error-body")`, `RegisterHandlers`, `RegisterLogger`). Make the tests pass.
- [ ] **Step 3:** Write the Dockerfile and compose change. Then:
  - `docker compose build krakend && docker compose up -d krakend`;
  - `krakend check -t` against the config inside the new image.
- [ ] **Step 4:** Live checks:
  - stop `catalog`; `GET /catalog/health` → 503 JSON; start `catalog`;
  - `GET /platform/api/v1/accounts/me` with no token → 401 JSON;
  - `GET /nope` → 404 JSON;
  - a platform 422 still has its `details`;
  - `X-Request-Id` sent by the client is echoed by platform through the gateway.

  Add the 401-JSON, 404-JSON and request-id checks to `verify-local-stack.sh`. The script must end with "Stack verified.".
- [ ] **Step 5: Docs.**
  - ADR-0003: the plugin, why CE needs it, how to rebuild it, and the pinned version.
  - api-conventions §6: replace "401 from the gateway has an empty body" with the new shape. Clients still decide on the status code.
  - CLAUDE.md gateway rules: the validate command must use the built image (`docker compose run --rm krakend check -t -c /etc/krakend/krakend.json`), because a plain `devopsfaith/krakend` image lacks the plugin.
- [ ] **Step 6: Commit.** `feat(gateway): structured JSON errors for gateway-generated failures`, plus a separate `docs:` commit.

### Task 2: `@pbl/common` foundation: errors, request id, health/readiness, bootstrap

**Jira (SCRUM-27):** "Template có sẵn: config, logger JSON kèm trace-id, health và readiness, Swagger, format lỗi chuẩn (code/message/details), Dockerfile, harness test."

**Files:**
- Create `libs/common/` with `tsconfig.lib.json`, `src/index.ts`, `src/errors/*`, `src/logging/*`, `src/health/*`, `src/bootstrap/*`, and specs.
- Modify `tsconfig.json` paths (`@pbl/common`, `@pbl/common/*`), jest module mappers (root jest config and `apps/platform/jest.config.json`), `package.json` scripts (`build:libs` covers both libs; `test:libs` stays `jest libs`), and `nest-cli.json` (add the `common` library project like `auth`).
- Modify the five stubs `apps/{catalog,commerce,finance,integration,insight}/src/{main.ts,app.module.ts,health.controller*.ts}`.
- Modify `apps/platform/src/utils/logger-factory.ts` (use the lib's `genReqId`) and the platform health controller (add `GET /health/ready`).
- Modify `krakend/krakend.json`: no new client routes. Readiness is for orchestrators and is not routed.

**Design:**
- **`errors`:**
  - `ErrorResponse` interface matching api-conventions §6;
  - `PblExceptionFilter`, a Nest `ExceptionFilter`. It maps `HttpException` to the shape, keeping class-validator `details` when a `ValidationPipe` with `exceptionFactory` creates them; the lib exports `validationExceptionFactory` producing `{property, code, message}[]` and status 422. Any other error → 500 "Internal Server Error", logged with stack. `stack` is added only when `APP_DEBUG === 'true'`.
- **`logging`:**
  - `genReqId` (moved from platform, same behaviour: header or uuid v4, echoed as `X-Request-Id`);
  - `pinoLoggerOptions(serviceName)` returning `nestjs-pino` params: JSON lines, `req.id`, redaction of `authorization`/`cookie`, and `service` in base.
- **`health`:** `PblHealthModule.forRoot({ readiness?: Array<() => Promise<HealthIndicatorResult>> })` provides:
  - `GET /health`, liveness: `{status:'ok', service}`, `@Public()`;
  - `GET /health/ready`, readiness via terminus with the given checks, `@Public()`. Stubs with `REDIS_HOST` check Redis with a ping through the same ioredis instance pattern as Task-4's revocation or a lightweight one.
- **`bootstrap`:** `bootstrapService(AppModule, { name, port? })` does:
  - `bufferLogs` + pino logger;
  - `enableShutdownHooks()`;
  - global `ValidationPipe` (whitelist, transform, the lib `exceptionFactory`);
  - the global `PblExceptionFilter`;
  - CORS off (the gateway owns CORS);
  - Swagger at `/api-docs` when `APP_SWAGGER_ENABLED !== 'false'`;
  - listen on `PORT ?? 3000`.

  Stubs' `main.ts` becomes one call. Platform keeps its own `main.ts` and only adopts `genReqId` and readiness.
- **Tests:**
  - filter: HttpException, validation 422 with `details`, unknown error → 500 without stack unless debug;
  - `genReqId`: header kept, else uuid, echoed;
  - health endpoints: e2e with a Nest testing module and supertest;
  - `bootstrapService`: covered by one stub e2e spec booting the module on a random port and hitting `/health`, `/health/ready`, and an unknown route (404 JSON).

**Steps:**
- [ ] **Step 1:** Write the failing specs listed above.
- [ ] **Step 2:** Implement the lib and register the paths and mappers.
- [ ] **Step 3:**
  - Move the stubs to `bootstrapService` and `PblHealthModule`; delete their hand-written health controllers and specs, which are replaced by the lib's tests plus one stub e2e spec per service, or one shared parametrised spec.
  - Platform: switch to the lib's `genReqId`, and add `GET /health/ready` (DB + Redis).
- [ ] **Step 4:** Run the full platform, libs and stub suites; `tsc` for every app; LF lint; `docker compose up -d --build`; the verify script. Add to the script: `/health/ready` → 200 for platform, directly on `:3000`, not via the gateway.
- [ ] **Step 5: Commit.** `feat(common): shared error shape, request id logging, health/readiness and service bootstrap`

### Task 3: Tenant context and tenant-scoped repository

**Jira (SCRUM-32):**
- "Mỗi service có tầng truy cập dữ liệu tự động chèn điều kiện tenant_id."
- "Mỗi service có test chứng minh truy cập dữ liệu của tenant khác bị từ chối."

**Files:**
- Create `libs/common/src/tenancy/{tenant-context.ts, tenant-scoped.repository.ts, tenancy.module.ts, *.spec.ts}`.
- Modify `libs/auth/src/auth.guard.ts` (+ spec): after successful verification, enter the tenant context. Choose a design that does not create a circular lib dependency: `@pbl/common` must not import `@pbl/auth` for this. Options:
  - `@pbl/auth` imports `TenantContext` from `@pbl/common`; `@pbl/common` stays auth-agnostic. **Use this.**
- Modify `apps/platform/src/api/branch/branch.service.ts` (+ spec) to use the scoped repository.
- Create `apps/platform/test/tenancy.e2e-spec.ts`: real Postgres, using the `pbl` DB in the running stack with a dedicated schema `tenancy_test` created and dropped by the test, or a transaction rolled back.

**Design:**
- **`TenantContext`:**
  - `run<T>(tenantId: string | null, fn: () => T): T` and `current(): string | undefined`, built on `AsyncLocalStorage`;
  - `require(): string` throws `MissingTenantContextError` (a plain Error → 500; it is a programming bug, not a client error).
- **Wiring:** a global interceptor or middleware is not reliable for guards ordering. Wrap the request in `TenantContext.run(user.tenantId ?? null, …)` from a Nest **interceptor** registered by `PblAuthModule` (APP_INTERCEPTOR). It runs after guards and wraps the handler observable, including async continuations. Document this choice in the lib.
- **`TenantScopedRepository<T extends { tenantId: string }>`:**
  - constructed from a TypeORM `Repository<T>`, or created with `forEntity(dataSource or EntityManager, Entity)`;
  - methods `find`, `findOne`, `findOneBy`, `count`, `exists`, `findAndCount`, `save`, `update`, `softDelete`, `delete`, `createQueryBuilder(alias)`;
  - every method adds `tenantId: TenantContext.require()` to `where` (arrays of where-objects included). A caller-supplied `tenantId` in `where` that differs → throw;
  - `save` sets `tenantId` when absent, and throws when present and different;
  - `createQueryBuilder` returns a builder with `alias.tenantId = :__tenantId` already applied;
  - `withManager(em)` returns the same wrapper bound to a transaction's `EntityManager`.
- **Platform adoption:** `BranchService` uses `TenantScopedRepository<BranchEntity>` for list/get/create/update/remove. The tenant-row lock from the follow-up plan stays: it locks `TenantEntity` by `TenantContext.require()`, using `withManager(em)` for the branch queries. `tenantId` parameters to the service methods are removed only where the controller passed `@CurrentTenant()`. Keep the controller's `@CurrentTenant()` usage if needed elsewhere.
- **Tests:**
  - **Unit (mocked repository):** where-injection for every method, mismatched tenant throws, no context throws, `save` sets the tenant.
  - **Real Postgres e2e** (Review Focus 2):
    - two tenants' rows; inside tenant A's context `find`, `findOne` by B's id, `count`, `update` and `softDelete` of B's row see or affect nothing;
    - outside any context, every method throws;
    - a query builder only returns A's rows.
  - **Guard/interceptor:** a request with a `tid` token sees that tenant in `TenantContext.current()` inside the handler; a token without `tid` (optional mode) sees `null`.

**Steps:**
- [ ] **Step 1:** Failing unit specs, then the e2e spec. Write a jest e2e config for it if `apps/platform/test/jest-e2e.json` cannot reach Postgres from the image: the image's `DATABASE_HOST=postgres` works with `docker compose run` without `--no-deps`.
- [ ] **Step 2:** Implement `TenantContext`, the interceptor in `@pbl/auth`, and the repository.
- [ ] **Step 3:** Migrate `BranchService`. All existing branch tests and the verify script must still pass.
- [ ] **Step 4:** Run the full suites, `tsc`, the LF lint and the verify script.
- [ ] **Step 5: Commit.** `feat(common): tenant context and tenant-scoped repository`, then `refactor(platform): branch service uses the tenant-scoped repository`.

### Task 4: Tenant and trace propagation across HTTP calls and events

**Jira (SCRUM-32):** "Mọi lời gọi giữa service và mọi event đều mang theo tenant_id."

**Files:**
- Create `libs/common/src/propagation/{request-context.ts, internal-http.client.ts, event-envelope.ts, *.spec.ts}`.
- Modify `libs/common/src/index.ts`.

**Design:**
- **`RequestContext`:** in the same AsyncLocalStorage style as `TenantContext`, or one combined store. It holds `requestId` and `authorization` (the raw `Authorization` header), set by the same interceptor as Task 3. `@pbl/auth` owns the interceptor; it already sees the request.
- **`InternalHttpClient`:**
  - a thin wrapper over `@nestjs/axios` `HttpService`, provided by `PblPropagationModule.forRoot()`;
  - every request forwards `Authorization` and `X-Request-Id` from the context;
  - it never sets `X-Tenant-Id` or any `X-User-*` header;
  - it throws when called outside a request context unless `{ asService: true }` is passed. Service-to-service auth without a user is out of scope; document it as a follow-up.
- **`EventEnvelope<T>`:**
  - fields `{ id (uuid), type, version, occurredAt (ISO), tenantId, actor: { id, type } | null, traceId, payload: T }`;
  - `createEvent(type, version, payload)` fills `tenantId` from `TenantContext.require()`, `traceId` from the context, and the actor from the auth context (store `userId`/`subjectType` in the request context too);
  - `consumeEvent(envelope, handler)` validates the envelope shape and runs the handler inside `TenantContext.run(envelope.tenantId, …)` with the trace id.
- **No producer changes.** Platform's existing SQS email message is consumed by pbl-mail-service, so changing its format would break that repo. Do not wrap it; document it.
- **Tests:**
  - client forwards `Authorization` and the request id, and never adds tenant headers even when the context has a tenant;
  - client throws outside a context;
  - `createEvent` takes the tenant from the context and throws without one;
  - `consumeEvent` runs the handler with `TenantContext.current() === envelope.tenantId` and rejects an envelope without `tenantId`.

**Steps:**
- [ ] **Step 1:** Failing specs.
- [ ] **Step 2:** Implement and export.
- [ ] **Step 3:** Run the lib + platform suites and `tsc`.
- [ ] **Step 4: Commit.** `feat(common): propagate tenant and trace ids through internal HTTP calls and events`

### Task 5: Service template and generator

**Jira (SCRUM-27):** "Sinh một service mới từ template và chạy được trong dưới 15 phút."

**Files:**
- Create `templates/service/` (files with `__name__` / `__Name__` placeholders, mirroring a stub after Task 2, plus a tenant-scoped example entity is NOT included — keep it minimal).
- Create `scripts/new-service.mjs` (Node, no extra deps) and `docs/guides/new-service.md`.
- Modify `README.md` (link) and `CLAUDE.md` ("adding a service" section points to the generator).

**Design:**
- **`node scripts/new-service.mjs <name> [--port <host port>]`:**
  - validates the name: `^[a-z][a-z0-9-]{1,30}$`, not existing;
  - copies the template to `apps/<name>`, replacing placeholders;
  - registers the service in:
    - `nest-cli.json` projects;
    - `package.json` scripts (`start:dev:<name>`, `build:<name>`, `test:<name>`);
    - `docker-compose.yml` (a service block cloned from `catalog` with env `AUTH_JWKS_URL` and `REDIS_*`);
    - `krakend/krakend.json` (`/<name>/health` route);
    - the `.github/workflows/ci.yml` service matrix;
    - `scripts/verify-local-stack.sh` service list, if it has one;
    - `docker/postgres-init-schemas.sql` (schema `<name>`) if the stubs have schemas there.
  - Edit JSON files by parse/serialise, preserving 2-space indent and trailing newline. Edit YAML/SQL/sh files with anchored text insertions, failing loudly if an anchor is missing.
  - prints next steps.
- **Verification:**
  - run the generator on a throwaway copy of the repo (`git worktree add` into the scratchpad, or a `git archive` copy) for a service named `demo`;
  - then `pnpm exec tsc -p apps/demo/tsconfig.app.json --noEmit`, the `demo` tests, and `docker compose up -d --build demo krakend` in that copy with an alternate `COMPOSE_PROJECT_NAME`, or skip compose there and only run `nest build demo` and start it with node, then `curl /health`;
  - time the whole flow and report it;
  - never leave `demo` in the real repo.

**Steps:**
- [ ] **Step 1:** Write the template from the post-Task-2 catalog stub.
- [ ] **Step 2:** Write the generator, with a `--dry-run` that prints the planned edits.
- [ ] **Step 3:** Verify on a throwaway copy as above, and record the timing.
- [ ] **Step 4:** Write the docs.
- [ ] **Step 5: Commit.** `feat: service template and generator`

### Task 6: Publish the shared libs to GitHub Packages with semver

**Jira (SCRUM-27):**
- "Package dùng chung được publish lên GitHub Packages và đánh phiên bản theo semver."
- "Thay đổi phá vỡ tương thích ở package dùng chung phải tăng major version."

**Files:**
- Create `libs/auth/package.json`, `libs/common/package.json`, `libs/*/CHANGELOG.md`, `libs/*/README.md`, `.github/workflows/publish-libs.yml` and `scripts/check-lib-version.mjs`.
- Modify both `tsconfig.lib.json` (real emit to `dist/libs/<name>`, declarations, no spec files), `package.json` (`build:libs` emits; `pack:libs` script), `.github/workflows/ci.yml` (libs job: build, test, version check) and `docs/decisions/` (new ADR-0009 "Shared libraries and versioning").

**Design:**
- **Package names:** `@sapoclone/pbl-auth` and `@sapoclone/pbl-common`, starting at version `1.0.0`.
  - `publishConfig.registry`: `https://npm.pkg.github.com`.
  - `repository` field pointing at `SapoClone/pbl-api`.
  - `files: ["dist", "README.md", "CHANGELOG.md"]`, with `main` / `types` pointing into `dist`.
  - **peerDependencies:** `@nestjs/common`, `@nestjs/core`, `rxjs`, `typeorm` (for common), `ioredis` and `jwks-rsa` / `jose` (whatever auth really imports) as `dependencies`.
- **Cross-import:** `@pbl/common` → the published auth must import `@sapoclone/pbl-common`, not `@pbl/common`. Inside the monorepo the path alias keeps working. Rewrite at build time with a `tsc` path rewrite step, or `tsconfig.lib.json` `paths` plus a tiny post-build replace script that rewrites `require("@pbl/common")` → `require("@sapoclone/pbl-common")` in `dist`. Pick one, test it, and state it in ADR-0009.
- **Workflow `publish-libs.yml`:**
  - triggered by tags `pbl-auth-v*` and `pbl-common-v*`;
  - runs install, build, test, `scripts/check-lib-version.mjs`, then `pnpm publish --no-git-checks` from the lib folder;
  - `permissions: packages: write, contents: read`; `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
  - `check-lib-version.mjs` asserts that the tag version equals `package.json`'s version, and that `CHANGELOG.md` has a section for it.
- **Major-version rule:**
  - CI on PRs runs `scripts/check-lib-version.mjs --pr`. If a lib's `src/index.ts` export list lost or renamed an export versus `origin/main` (compare exported names via the TypeScript compiler API, already a dependency), the lib's `package.json` major must be greater than main's; otherwise fail.
  - Removed or renamed exports are the breaking changes it can detect. Signature changes are covered by the CHANGELOG rule and review; say so in ADR-0009.
- **Verification:**
  - `pnpm build:libs`;
  - `pnpm pack` in both lib folders, then list the tarball files (Review Focus 4);
  - `npm publish --dry-run` (no token, so expect only the auth error at the end, or use `--registry` dry-run);
  - install both tarballs into a scratch Nest app outside the repo and import `PblAuthModule` and `bootstrapService` to prove they resolve and type-check;
  - unit-test `check-lib-version.mjs` with fixture files.

**Steps:**
- [ ] **Step 1:** Write the failing tests for `check-lib-version.mjs`.
- [ ] **Step 2:** Add the package manifests and the build emit; pack and inspect.
- [ ] **Step 3:** Run the scratch-consumer check.
- [ ] **Step 4:** Add the workflows, ADR-0009, and the `CLAUDE.md` section "Shared libraries".
- [ ] **Step 5: Commit.** `build: publish @sapoclone/pbl-auth and @sapoclone/pbl-common to GitHub Packages`

### Task 7: Docs sweep

**Files:**
- `CLAUDE.md`, `README.md`, `docs/decisions/0008-tenancy.md` (the tenant-scoped repository now exists, earlier than P1), `docs/specs/2026-10-10-catalog-commerce-roadmap.md` (P1 no longer needs to build the repository base), `docs/conventions/api-conventions.md` (`X-Request-Id`), and `docs/deploy-actions.md`:
  - the krakend image must be built (plugin);
  - `X-Request-Id`;
  - lib publishing needs no secret beyond `GITHUB_TOKEN`.

- [ ] **Step 1:** Update every doc listed. Check that every statement matches the code. Fix relative links.
- [ ] **Step 2: Commit.** `docs: shared libs, tenant-scoped data access, gateway errors`
