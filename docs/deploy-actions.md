# Deploy actions for the auth, gateway and tenancy changes

Required before the next production deploy of pbl-api. Items are ordered;
do them top to bottom. Each one says which repo it touches.

**Background:** branches `feat/fix-login-via-api-gateway` and
`feat/rs256-jwks-auth` (already merged as #3 and #5) changed how
authentication works (see
[ADR-0004](decisions/0004-authentication-and-tokens.md)). Platform now signs
access tokens with an RSA private key instead of a shared secret, refresh
tokens moved from the `session` table to `refresh_token`, and the build
output path changed. Branch `feat/p0-platform-tenancy` adds tenancy (see
[ADR-0008](decisions/0008-tenancy.md) and the
[P0 design](specs/2026-10-10-p0-platform-tenancy-design.md)). The AWS
resources are currently torn down, so these steps also apply to the first
re-deploy.

## 1. Merge order (pbl-api)

- [ ] Merge `feat/p0-platform-tenancy` into `main`. The two earlier
  branches (`feat/fix-login-via-api-gateway`, `feat/rs256-jwks-auth`) are
  already merged, as #3 and #5.
- [ ] Also merge pbl-infra `fix/p0-deploy-config` (section 2).
- [ ] Order matters: merging to `main` triggers `deploy.yml` immediately
  (it also has `workflow_dispatch`). Merge only after the section 2 apply
  and the section 3 migration, or re-run `deploy.yml` from the Actions tab
  (workflow_dispatch) afterwards.

## 2. Replace the token secrets (pbl-infra) — blocking

Platform no longer reads `AUTH_JWT_SECRET` or `AUTH_REFRESH_SECRET`, and it
refuses to start without `AUTH_JWT_PRIVATE_KEY` and `AUTH_JWT_KEY_ID`.

The Terraform edits below are **already done** on the pbl-infra branch
`fix/p0-deploy-config` (review only, do not redo them). What is left is
generating the key, filling `secrets.tfvars` and applying. Before you apply:
`auth_jwt_private_key` must be set in `secrets.tfvars`, and the old
`auth_jwt_secret` / `auth_refresh_secret` lines must be removed from any
existing `secrets.tfvars`. The plan deletes the two old SSM parameters if
they exist in state (AWS is currently torn down, so there may be none).

- [ ] Generate the production signing key **once**, outside the repo:
  ```bash
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
  ```
  Keep it at 2048 bits: the base64 value is about 2.3 KB, which fits an SSM
  standard-tier parameter (4 KB limit). A 4096-bit key would not fit.
  Never reuse the local key committed in `.env.docker.platform`.
- [ ] `terraform/secrets.tf`, `local.pbl_api_secrets`: remove
  `AUTH_JWT_SECRET` and `AUTH_REFRESH_SECRET`; add
  `AUTH_JWT_PRIVATE_KEY = var.auth_jwt_private_key`.
- [ ] `terraform/variables.tf`: remove `auth_jwt_secret` and
  `auth_refresh_secret`; add `auth_jwt_private_key` (`sensitive = true`).
- [ ] `live/prod/secrets.tfvars.example`: same rename, with the openssl
  command above as the comment. Put the real value in `secrets.tfvars`
  (gitignored).
- [ ] `terraform/ecs.tf`, `module "pbl_api"`:
  - `secrets`: remove the `AUTH_JWT_SECRET` and `AUTH_REFRESH_SECRET`
    lines; add `AUTH_JWT_PRIVATE_KEY = aws_ssm_parameter.pbl_api["AUTH_JWT_PRIVATE_KEY"].arn`.
  - `environment`: add `AUTH_JWT_KEY_ID = "prod-1"` (not secret; change it
    whenever the key changes), `AUTH_JWT_ISSUER = "platform"`,
    `AUTH_JWT_AUDIENCE = "pbl6"`, and `APP_URL = "https://api.<domain>"`
    (platform builds links from it).
  - Consider lowering `AUTH_REFRESH_TOKEN_EXPIRES_IN` from `"365d"` (for
    example `"30d"`). Refresh tokens now slide on every use, so active
    users stay logged in either way.
- [ ] Update the "Secrets reference" table in the pbl-infra README.
- [ ] `terragrunt apply` from `live/prod`, then check the plan creates
  `/pbl-api/AUTH_JWT_PRIVATE_KEY` and deletes the two old parameters.

## 3. Run the database migration (pbl-api) — blocking

Migration `1791476400000-replace-session-with-refresh-token` creates
`refresh_token` and **drops `session`**.

- [ ] Run `pnpm migration:up` against Neon, with production credentials in
  a local `.env` (same procedure as the pbl-infra README, step 7).
- [ ] Expect every user to be logged out once: existing sessions and refresh
  tokens stop working and users must sign in again.
- [ ] The P0 migration `1791563000000-introduce-tenancy` renames `user` to `account` and **drops `post`**. Take a database backup first; existing accounts keep working and have no store until they create one.
- [ ] Migrations use unqualified table names (as all earlier ones do) and TypeORM does not set `search_path`, so they always create tables in `public`. Do **not** set `DATABASE_SCHEMA` in production until migrations are made schema-aware; otherwise the app looks for tables in a schema the migrations never created. (Local Docker is unaffected: it uses `DATABASE_SYNCHRONIZE=true`.)

## 4. Deploy the platform image (pbl-api) — blocking

- [ ] Let `.github/workflows/deploy.yml` build and deploy after the merge.
  The production entry point moved to
  `dist/apps/platform/apps/platform/src/main.js`; the Dockerfile `CMD`
  already points there, and the task definition is unaffected.
- [ ] Verify after the deploy:
  ```bash
  API=https://api.sapo.makeasy.id.vn
  curl -s $API/health                      # 200
  curl -s $API/.well-known/jwks.json       # {"keys":[{"kty":"RSA","kid":"prod-1",...}]} with no "d"
  # register + login, then check the access token header: {"alg":"RS256","kid":"prod-1"}
  # POST /api/v1/auth/refresh with the refreshToken returns a new 43-character refreshToken
  # P0 checks, with the access token from the login above:
  # GET  /api/v1/accounts/me                  -> 200
  # POST /api/v1/tenants {"name":"Smoke","subdomain":"smoke-<date>"}
  #                                           -> 201; auth.accessToken carries "tid"
  # GET  /api/v1/branches (with that token)   -> 200 with branch CN01
  ```
- [ ] `deploy.yml` now also triggers on `libs/**` changes and installs with
  `--frozen-lockfile` (and lints with `pnpm lint:check`), so a stale lockfile
  fails the build.

## 5. Production gateway and the other services (pbl-infra) — before clients use the gateway

pbl-infra deploys only platform (ALB → one ECS service). KrakenD and the
five other services exist only in the local docker stack. Until this is
done, production clients call platform directly.

- [ ] If clients call platform directly for now, set `APP_CORS_ORIGIN` in
  `ecs.tf` to the real web origin(s). It is `"false"` today, which blocks
  every browser call.
- [ ] To deploy the gateway:
  - **Build the image from `krakend/Dockerfile`** (KrakenD 2.6.3 + the
    `pbl-error-body` plugin) and push it to a registry (ECR); do not use the
    stock `devopsfaith/krakend` image: the config references the plugin and
    KrakenD refuses to start without it. The plugin must match the KrakenD
    version exactly, so rebuild both together when bumping. `deploy.yml` does
    not build this image yet.
  - Add an ECS service for KrakenD with a **production** `krakend.json`.
  - `jwk_url` must be the https URL
    (`https://api.sapo.makeasy.id.vn/.well-known/jwks.json`), and
    `disable_jwk_security` must be removed (it exists only for the local
    http URL).
  - Set `security/cors.allow_origins` to the production web origin(s).
  - Point backend `host` values at each service's internal address.
  - Keep `X-Request-Id` in each endpoint's `input_headers` and in the CORS
    `allow_headers`/`expose_headers`; the services echo and log it, and a
    request id is the thread that ties a gateway error to the service logs.
  - Introduce per-environment config (KrakenD flexible config or a
    separate file) so the local and production settings don't diverge.
- [ ] To deploy catalog, inventory, sales, customer, finance, integration and
  insight: give each an image (build with `--build-arg APP_NAME=<service>`;
  `deploy.yml` still builds and pushes only `platform`), an ECS service and the env var
  `AUTH_JWKS_URL=https://api.sapo.makeasy.id.vn/.well-known/jwks.json`
  (they refuse to start without it). They also read the logout deny-list
  from Redis, so set `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` and
  `REDIS_TLS_ENABLED` (same values as platform). Without `REDIS_HOST` a
  service starts but cannot see revoked tokens.
- [ ] Once the gateway serves production, set pbl-mail-service's
  `API_PUBLIC_URL` to `https://<gateway-host>/platform`: the verification
  link is `${API_PUBLIC_URL}/api/v1/auth/verify/email`.

## 6. Clients (pbl-web, pbl-mobile) — before shortening token lifetime

The base URL is `<gateway>/platform/api/v1`.

- [ ] pbl-web: point `API_URL` and the Vite dev proxy at the gateway
  (`<gateway>/platform/api/v1`). They still target the deleted ALB hostname.
- [ ] pbl-mobile: branch `feat/home-bao` already uses
  `/api/v1/auth/email/login|register|logout`; only `REST_API_ENDPOINT` must
  become `<gateway>/platform`.
- [ ] Both clients: handle the store flow. A login without `tid` leads to a
  store picker (`tenants[]` in the response) or to creating a store
  (`POST /tenants`); use `switch-tenant` to change store; a 403 means "no
  store selected".
- [ ] Both clients: add refresh handling. On a 401, call `/auth/refresh`
  once, store the **new** refresh token, and retry the request. Never run
  two refreshes in parallel: two simultaneous refreshes with the same token
  count as reuse and log the user out (ADR-0004).

## 7. Later (no deploy blocker)

- [ ] Publishing the shared libraries (`@sapoclone/pbl-auth`,
  `@sapoclone/pbl-common`) needs no secret you create: `publish-libs.yml`
  authenticates to GitHub Packages with the workflow's built-in `GITHUB_TOKEN`
  (`packages: write`). Release by pushing a tag `pbl-auth-vX.Y.Z` or
  `pbl-common-vX.Y.Z` ([ADR-0009](decisions/0009-shared-libraries-and-versioning.md)).
  GitHub Packages (npm) needs authentication to install even inside the org,
  so every consumer (services here, the `pbl-*` sibling repos, CI) needs a
  token with `read:packages` in its `.npmrc`.
- [ ] When both clients refresh correctly: lower
  `AUTH_JWT_TOKEN_EXPIRES_IN` from `1d` to 5–15 min. Keep the Redis logout
  deny-list: every service now checks it, which gives immediate logout and
  switch-store revocation everywhere (ADR-0004 §7).
- [ ] Key rotation: `AccessTokenService` serves one key. Add a second
  verification-key slot before the first rotation, so the old and new keys
  can be published side by side.
- [ ] ADR-0004 step 5 remainder: `perms` + `@RequirePermission` with
  Staff/RBAC.
