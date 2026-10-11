# P0 Follow-ups and Deploy-Config Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the next production deploy configuration correct, and close the follow-ups left after P0: the last-branch race, revocation in non-platform services, end-to-end coverage, missing tests, and consistency items.

**Architecture:** Small, independent changes on top of P0. Pbl-api work continues on `feat/p0-platform-tenancy`; pbl-infra changes go on a new branch `fix/p0-deploy-config`. Nothing is applied or deployed.

**Tech Stack:** NestJS 11, TypeORM 0.3, ioredis 5.4.1, KrakenD 2.6, Terraform/Terragrunt, GitHub Actions.

**Spec:** [`docs/specs/2026-10-10-p0-platform-tenancy-design.md`](2026-10-10-p0-platform-tenancy-design.md); decisions in [ADR-0004](../decisions/0004-authentication-and-tokens.md) and [ADR-0008](../decisions/0008-tenancy.md); [`docs/conventions/api-conventions.md`](../conventions/api-conventions.md). Approved scope: the "A/B" list agreed in chat on 2026-10-11.

## Global Constraints

- Never add `Co-Authored-By` or "Generated with" lines. Use Conventional Commits.
- No `terraform apply`, no deploy, no push.
- Do not run `docker compose down -v`.
- Logout deny-list contract (verified live on 2026-10-11):
  - Redis key `auth:session-blacklist:<sid>` with no prefix;
  - value `true`;
  - TTL = the access token's remaining lifetime.
- `ioredis` is pinned to the version already in the lockfile: `5.4.1`.
- Revocation-store errors propagate (5xx), as in platform. A Redis outage is never treated as "not revoked".
- Tests and tools run inside the platform image. On Windows/Git Bash:
  ```bash
  export MSYS_NO_PATHCONV=1
  docker compose run --rm --no-deps -v "$(pwd -W):/work" -w /work platform sh -c 'ln -sf /app/node_modules node_modules; <COMMAND>; rm -f node_modules'
  ```
  The tasks below call this `IN_IMAGE "<COMMAND>"`. Whole-repo lint runs on an LF copy:
  ```bash
  git -c core.autocrlf=false archive HEAD | docker compose run --rm --no-deps -T platform sh -c 'mkdir -p /tmp/lf && tar -x -C /tmp/lf && cd /tmp/lf && ln -s /app/node_modules node_modules && pnpm lint:check'
  ```
  Run prettier/eslint only on files you change.

## Review Focus

1. **A Redis outage in a non-platform service** should fail the request loudly (5xx), not silently treat revoked tokens as valid. Pinned in Task 4.
2. **A service without `REDIS_HOST`** (e.g. a unit-test app) should still start and verify tokens, without revocation. Pinned in Task 4.
3. **Two owners deleting the last two active branches at the same time** must leave at least one active branch. Pinned in Task 3 (unit test asserts the lock is taken inside the transaction before counting).
4. **Infra var renames** must keep `terraform validate` passing, and must not leave a reference to the removed variables. Pinned in Task 2.
5. **Changing the shared `*FieldOptional` decorators** must not break endpoints that legitimately accept `null` (response DTOs use `nullable: true`). Pinned in Task 6 (full suite + a decorator test).

---

### Task 1: Deploy workflow and deploy-actions.md

**Files:** Modify `.github/workflows/deploy.yml`, `docs/deploy-actions.md`.

- [ ] **Step 1: `deploy.yml`.**
  - Add `- 'libs/**'` to `on.push.paths`, after `- 'apps/**'`.
  - Replace `- run: pnpm install` with `- run: pnpm install --frozen-lockfile`.
  - Replace `- run: pnpm lint` with `- run: pnpm lint:check`.
  - Leave everything else unchanged.
- [ ] **Step 2: Rewrite `docs/deploy-actions.md` to match the current state.** Keep its structure (ordered sections, checkboxes) and change:
  - **§1:** the merge order now reads: merge `feat/p0-platform-tenancy` into `main` (the two earlier branches are already merged, as #3/#5). Also merge pbl-infra `fix/p0-deploy-config`.
  - **§2:** say the Terraform edits are prepared on pbl-infra branch `fix/p0-deploy-config` (Task 2). Keep the key-generation, `secrets.tfvars` and `terragrunt apply` steps as to-do. Keep the 2048-bit/SSM note. Add that `APP_URL` is now set to `https://api.<domain>`.
  - **§4:** extend the verification block with the P0 checks:
    - `GET /api/v1/accounts/me` with the login token → 200;
    - `POST /api/v1/tenants {"name":"Smoke","subdomain":"smoke-<date>"}` → 201, and its `auth.accessToken` carries `tid`;
    - `GET /api/v1/branches` with that token → 200 with branch `CN01`.
  - **§4, new bullet:** `deploy.yml` now also triggers on `libs/**` and installs with `--frozen-lockfile`.
  - **§5:** add that once the gateway serves production, pbl-mail-service's `API_PUBLIC_URL` must become `https://<gateway-host>/platform`, because the verification link is `${API_PUBLIC_URL}/api/v1/auth/verify/email`. Add `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS_ENABLED` for the other services, since they read the logout deny-list (Task 4).
  - **§6 (clients):**
    - The base URL is `<gateway>/platform/api/v1`.
    - pbl-mobile `feat/home-bao` already uses `/api/v1/auth/email/login|register|logout`; only `REST_API_ENDPOINT` must become `<gateway>/platform`.
    - Both clients must handle the store flow: a login without `tid` → store picker (`tenants[]`) or create store (`POST /tenants`); `switch-tenant`; 403 means "no store selected".
    - Keep the refresh-handling bullet.
  - **§7:** the last bullet becomes "ADR-0004 step 5 remainder: `perms` + `@RequirePermission` with Staff/RBAC".
- [ ] **Step 3:** Check that every relative link in `deploy-actions.md` resolves, and validate the YAML with `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"` (use `pip install pyyaml` in the image or on the host if needed; or skip with a note if no YAML parser is available, and inspect by eye).
- [ ] **Step 4: Commit.** `ci: deploy on libs changes with a frozen lockfile and lint:check` (the workflow) and `docs: bring deploy-actions up to date after P0` (the doc). Two commits.

### Task 2: pbl-infra deploy configuration (repo `../pbl-infra`)

**Files:** in `C:/Users/ADMIN/Downloads/D/PBL6/pbl-infra`, modify `terraform/secrets.tf`, `terraform/variables.tf`, `terraform/ecs.tf`, `live/prod/secrets.tfvars.example`, `README.md`.

- [ ] **Step 1:** `git switch -c fix/p0-deploy-config` from up-to-date `main`. The working tree must be clean first.
- [ ] **Step 2: `secrets.tf`, `local.pbl_api_secrets`.** Remove `AUTH_JWT_SECRET` and `AUTH_REFRESH_SECRET`; add `AUTH_JWT_PRIVATE_KEY = var.auth_jwt_private_key`.
- [ ] **Step 3: `variables.tf`.** Remove the `auth_jwt_secret` and `auth_refresh_secret` variables. Add:
  ```hcl
  variable "auth_jwt_private_key" {
    description = "Base64 of a PEM RSA private key (2048-bit) that signs pbl-api access tokens (RS256). Generate: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0"
    type        = string
    sensitive   = true
  }
  ```
  Match the file's existing style; if neighbouring variables have no `type`, still keep `sensitive`.
- [ ] **Step 4: `ecs.tf`, `module "pbl_api"`.**
  - `secrets`: remove the two old lines; add `AUTH_JWT_PRIVATE_KEY = aws_ssm_parameter.pbl_api["AUTH_JWT_PRIVATE_KEY"].arn`.
  - `environment`: add
    - `APP_URL = "https://api.${var.domain_name}"`
    - `AUTH_JWT_KEY_ID = "prod-1"`
    - `AUTH_JWT_ISSUER = "platform"`
    - `AUTH_JWT_AUDIENCE = "pbl6"`
  - Keep `AUTH_REFRESH_TOKEN_EXPIRES_IN` as is.
- [ ] **Step 5: `live/prod/secrets.tfvars.example`.** Replace the two old lines with `auth_jwt_private_key = ""`, with the openssl command as a comment above it. Update the "four separate values" comment so it describes the remaining `auth_forgot_secret` and `auth_confirm_email_secret`.
- [ ] **Step 6: README "Secrets reference" table.** Replace the `AUTH_JWT_SECRET` / `AUTH_REFRESH_SECRET` row with `AUTH_JWT_PRIVATE_KEY` (pbl-api, generated with openssl as above, SSM SecureString → ECS secret). Note `AUTH_JWT_KEY_ID` as a plain env var. Update any other README text that names the removed secrets (grep for them).
- [ ] **Step 7: Validate without a backend:**
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/terraform:/tf" -w /tf hashicorp/terraform:1.9 fmt -check -diff
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/terraform:/tf" -w /tf hashicorp/terraform:1.9 init -backend=false -input=false
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/terraform:/tf" -w /tf hashicorp/terraform:1.9 validate
  ```
  Expected: fmt clean and "Success! The configuration is valid." Remove any `.terraform/` folder and `.terraform.lock.hcl` changes that `init` created inside `terraform/`; `.terraform/` is gitignored, but check `git status`.
  
  Also run `grep -rn "auth_jwt_secret\|auth_refresh_secret\|AUTH_JWT_SECRET\|AUTH_REFRESH_SECRET" .` (excluding `.git`). Expected: no hits.
- [ ] **Step 8: Commit** on `fix/p0-deploy-config`: `fix: provision the RS256 signing key and APP_URL for pbl-api`. Do not push.

### Task 3: Last-active-branch race (pbl-api)

**Files:** Modify `apps/platform/src/api/branch/branch.service.ts`, `apps/platform/src/api/branch/branch.service.spec.ts`.

**Design:** `update` (when deactivating an active branch) and `remove` (when deleting an active branch) run in `this.repository.manager.transaction(...)`. Inside the transaction, before counting active branches, they lock the store's row:
```ts
await em.createQueryBuilder(TenantEntity, 'tenant')
  .setLock('pessimistic_write')
  .where('tenant.id = :tenantId', { tenantId })
  .getOne();
```
Then they count active branches with `em` and perform the save/soft-delete with `em`. This serialises "last branch" changes per store. Writes that do not touch status (rename, code change) keep the current non-transactional path. `TenantEntity` is imported from `../tenant/entities/tenant.entity`.

- [ ] **Step 1: Write the failing tests.** With `repository.manager.transaction` mocked as `jest.fn((work) => work(em))`, where `em` provides `createQueryBuilder` (chainable mock returning itself; `getOne` resolves), `count`, `save` and `softDelete`:
  - `remove` of an active branch takes the lock (`setLock('pessimistic_write')`) **before** `count`, and uses `em.count`/`em.softDelete`. Assert the call order with `mock.invocationCallOrder`.
  - Deactivating an active branch: same, via `em.save`.
  - Deleting an inactive branch does not lock.
  - The existing B002 tests keep passing, now driven through `em.count`.
- [ ] **Step 2:** Run `IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json branch"`. Expect FAIL.
- [ ] **Step 3:** Implement as in the design. `assertNotLastActive(tenantId, em)` takes the manager.
- [ ] **Step 4:** Run the full platform suite and `tsc` (`IN_IMAGE "pnpm exec jest --config apps/platform/jest.config.json && pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit"`). Expect PASS.
- [ ] **Step 5: Commit.** `fix(platform): lock the store row so concurrent changes cannot remove its last active branch`

### Task 4: Logout deny-list in every service (`@pbl/auth`)

**Files:**
- Create `libs/auth/src/redis-session-revocation.ts` and `libs/auth/src/redis-session-revocation.spec.ts`.
- Modify `libs/auth/src/auth.constants.ts`, `libs/auth/src/pbl-auth.module.ts`, `libs/auth/src/pbl-auth.module.spec.ts`, `libs/auth/src/index.ts`, `apps/platform/src/constants/cache.constant.ts`, `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `docs/decisions/0004-authentication-and-tokens.md` (§7 and the status table), `docs/decisions/0008-tenancy.md` (the deny-list consequence bullet) and `CLAUDE.md` (auth rules: `forRemoteJwks()` reads `REDIS_*`).

**Design:**
- **Shared key constant.** `auth.constants.ts` exports:
  ```ts
  /** Logout/switch deny-list written by platform; read by every service (ADR-0004 §7) */
  export const SESSION_DENY_LIST_KEY_PREFIX = 'auth:session-blacklist:';
  export const sessionDenyListKey = (sessionId: string) => `${SESSION_DENY_LIST_KEY_PREFIX}${sessionId}`;
  ```
  Platform's `CacheKey.SESSION_BLACKLIST` must stay byte-identical (`'auth:session-blacklist:%s'`). Add a platform unit test asserting `createCacheKey(CacheKey.SESSION_BLACKLIST, 'x') === sessionDenyListKey('x')`, so the two can never drift.
- **`RedisSessionRevocation`:**
  - **Constructor:** takes an `ioredis` `Redis` instance.
  - **`isSessionRevoked(user: AuthUser): Promise<boolean>`:** returns `(await redis.exists(sessionDenyListKey(user.sessionId))) === 1`. Errors propagate.
  - **Construction helper:** `static fromEnv(env: { host?: string; port?: string; password?: string; tls?: string }): RedisSessionRevocation | null`. It returns `null` when `host` is empty. Otherwise it builds `new Redis({ host, port: Number(port ?? 6379), password: password || undefined, tls: tls === 'true' ? {} : undefined, lazyConnect: false, maxRetriesPerRequest: 1 })`.
- **`forRemoteJwks()`:** reads `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` and `REDIS_TLS_ENABLED` via `ConfigService`. When `fromEnv` returns an instance, it passes `isSessionRevoked: (u) => revocation.isSessionRevoked(u)`; without `REDIS_HOST` there is no revocation check. The Redis connection must be closed when the Nest app shuts down: register the instance as a provider implementing `OnApplicationShutdown` → `redis.quit()`, or an equivalent that keeps tests from hanging with open handles.
- **Dependency:** add `"ioredis": "5.4.1"` to `dependencies` with a lockfile-only update, using the same approach as earlier: copy `package.json`, `pnpm-lock.yaml` and `.npmrc` to a scratch dir and run `pnpm add ioredis@5.4.1 --lockfile-only` in `node:24-alpine` with pnpm 9.12.3. Pin the version style the repo uses. Then `docker compose build`.
- **`docker-compose.yml`:** the five non-platform services get `REDIS_HOST: redis` and `REDIS_PORT: "6379"`.

- [ ] **Step 1: Failing tests.**
  - `redis-session-revocation.spec.ts`, with a mocked `Redis` whose `exists` is a `jest.fn()`:
    - revoked → `true`;
    - not revoked → `false`;
    - `exists` rejects → the promise rejects;
    - `fromEnv({})` → `null`;
    - `fromEnv({ host: 'r' })` → an instance (mock the `ioredis` module).
  - The platform key-equality test.
  - `pbl-auth.module.spec.ts`: one new `describe` where `REDIS_HOST` is set and `ioredis` is mocked with `jest.mock` so that `exists` returns 1 for the session `'session-revoked'` → `GET /closed` with that sid's token gives 401, while another sid gives 200. The existing suite runs without `REDIS_HOST` and keeps passing.
- [ ] **Step 2:** Run the lib + platform tests. Expect FAIL.
- [ ] **Step 3:** Implement per the design, and export the new symbols from `index.ts`. Update the docs:
  - ADR-0004 §7: every service checks the deny-list through `@pbl/auth` when `REDIS_HOST` is set.
  - ADR-0008: replace the consequence bullet. Revocation is now immediate everywhere; only a store suspended mid-session still works until refresh or expiry.
  - `CLAUDE.md` auth rules.
- [ ] **Step 4:** Run the full lib, stub and platform suites, `tsc`, and the LF-copy lint. Then `docker compose up -d --build` and `bash scripts/verify-local-stack.sh` ("Stack verified."). Add one live check to the report: log out, then confirm a stub service would reject the token. Stubs have only `/health`, so instead show `redis-cli EXISTS auth:session-blacklist:<sid>` = 1 and the module test as evidence.
- [ ] **Step 5: Commit.** `feat(auth): every service honours the logout deny-list` and, separately, `docs: revocation is immediate in every service`.

### Task 5: End-to-end coverage and missing unit tests

**Files:** Modify `scripts/verify-local-stack.sh`, `apps/platform/src/api/tenant/tenant.service.spec.ts`, `apps/platform/src/api/branch/branch.service.spec.ts`, `libs/auth/src/auth.guard.spec.ts`. Create `apps/platform/src/api/branch/dto/create-branch.req.dto.spec.ts`.

- [ ] **Step 1: Verify script.** After the existing branch checks, add these (using the existing `expect_code` helper or an equivalent for bodies):
  - `PATCH /branches/{id} {"name":"Kho 2b"}` → 200;
  - `PATCH /branches/{id} {"name":null}` → 422;
  - `GET /tenants/current` → 200;
  - `PATCH /tenants/current {"phone":"0900000000"}` → 200;
  - `DELETE /branches/{id}` (the KHO2 branch) → 204;
  - `DELETE` of the only remaining active branch (`CN01`; take its id from `GET /branches`) → 400, with body `errorCode` `B002`;
  - with the other store's account: `POST /auth/switch-tenant` into the first store → 404 (not a member).
  
  Extend `expect_code` to accept an optional JSON body, quoting it safely (`-d "$5"` only when set, built with an array). The script must still end with "Stack verified.".
- [ ] **Step 2: Unit tests (behaviour already implemented, so these should pass once written; if one fails, report it — do not change application code in this task):**
  - `TenantService`:
    - `listMine` maps memberships to `{id, name, subdomain, role}`;
    - `getCurrent` loads by id;
    - `updateCurrent` assigns only the fields sent, stores `null` for `phone`/`email`/`address` when sent as `null`, and sets `updatedBy`.
  - `BranchService`:
    - `list` adds the tenant condition, adds the `status` condition only when given, and adds the search condition only when `q` is given;
    - `save` maps a `UQ_branch_tenant_code` unique violation to B001 and rethrows other errors.
  - `CreateBranchReqDto`:
    - `' kho-2 '` → `'KHO-2'` and valid;
    - invalid codes (`'KHO 2'`, `'KHO.2'`, 21 chars) rejected.
  - Guard:
    - `@RequireRoles('owner','admin')` accepts `roles: ['admin']`;
    - `@Public()` with a token present does not call the verifier.
- [ ] **Step 3:** Run the full platform + lib suites; run the verify script.
- [ ] **Step 4: Commit.** `test: cover tenant/branch services, branch codes, guard roles and the full gateway flow`

### Task 6: Consistency and hardening

**Files:** Modify `apps/platform/src/decorators/field.decorators.ts` (+ create its spec if absent), `apps/platform/src/api/branch/branch.service.ts`, `libs/auth/src/access-token.verifier.ts` (+ spec), `apps/platform/src/api/auth/auth.service.ts` (+ spec), `apps/platform/src/database/migrations/1791563000000-introduce-tenancy.ts` (comment only), `CLAUDE.md`.

- [ ] **Step 1: `field.decorators.ts`.**
  - `NumberFieldOptional`, `PasswordFieldOptional`, `UUIDFieldOptional`, `URLFieldOptional`, `DateFieldOptional` and `ClassFieldOptional` use the same `optional()` helper as the String/Boolean/Email/Enum variants. They reject `null` unless `nullable: true`.
  - `optional()` passes `each` through to `ValidateIf`/`IsOptional`.
  - Write a spec with a small DTO per decorator: `undefined` passes, `null` is rejected, `null` with `nullable: true` passes.
  - Run the full suite to prove nothing else breaks (Review Focus 5).
- [ ] **Step 2: Branch search.** Make the escape explicit: `ILIKE :q ESCAPE '\\'`. Update the SQL assertion in the existing test.
- [ ] **Step 3: Verifier.** `roles` keeps only string elements (`claims.roles.filter((r): r is string => typeof r === 'string')`). Test with `roles: ['owner', 1, {}]` → `['owner']`.
- [ ] **Step 4: Timing.**
  - In `AuthService.signIn`, when the account is missing or not active, still run one `verifyPassword` against a constant dummy argon2 hash before throwing 401, so response time does not reveal whether the email exists or is disabled.
  - Generate the dummy hash once at module load with the project's `hashPassword` (lazily, cached), or as a precomputed constant hash of a random string.
  - Test: `verifyPassword` is called once for an unknown email and for a disabled account, and the result is still 401.
- [ ] **Step 5: Naming.** Rename leftover `user` identifiers in `auth.service.ts` / `auth.service.spec.ts` that refer to accounts (e.g. `userRepositoryValue` → `accountRepositoryValue`). Do not change `userId` in DTOs/API, `AuthUser`, `CurrentUser` or `@CurrentUser('id')`.
- [ ] **Step 6: Migration comment.** Add to the class doc comment of `1791563000000-introduce-tenancy.ts`: "down() restores the schema but not the data: usernames, bios, images and posts are lost". Comment only.
- [ ] **Step 7: `CLAUDE.md` auth rules.** One line: in `tenant: 'required'` services an `@AuthOptional()` route still answers 403 when a token *without* `tid` is sent; add `@TenantOptional()` too if the route must accept such tokens.
- [ ] **Step 8:** Run the full suites, `tsc`, the LF lint and the verify script.
- [ ] **Step 9: Commit.** `refactor: consistent null handling in optional fields; harden login timing and role claims` (+ `docs:` for `CLAUDE.md` and the migration comment if you prefer separate commits).
