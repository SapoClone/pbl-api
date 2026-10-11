# ADR-0003: All client traffic goes through the KrakenD gateway

- **Status:** Accepted
- **Date:** 2026-09-28; routing completed 2026-10-08
- **Scope:** `krakend/krakend.json`, every controller route, pbl-web, pbl-mobile

## Context

With 6 services, clients must not know service hostnames/ports, and
cross-cutting concerns (CORS, later JWT validation, rate limiting) belong
in one place. KrakenD is stateless, config-driven (one JSON file), fast,
and its Community Edition covers what we need. Initially only
`/<service>/health` was routed, so the web app had to call platform on
:3000 directly — and failed in the browser on CORS.

## Decision

- Clients (pbl-web, pbl-mobile) call **only the gateway** (`:8080` locally).
- **Path convention:** gateway path = `/<service>` + the service's own path.
  `POST /platform/api/v1/auth/email/login` → `http://platform:3000/api/v1/auth/email/login`.
  Client base URL for platform: `http://<gateway>/platform/api/v1`.
- Routes are declared **explicitly**, one entry per method+path (path params
  as `{id}`). No wildcard/catch-all routes (Enterprise-only, and explicit
  routes double as a reviewed list of what is public).
- Each endpoint is a transparent proxy:
  - `output_encoding: "no-op"` and backend `encoding: "no-op"`, so status
    codes, bodies and headers pass through unchanged (401/422 stay 401/422).
  - `input_headers`: `Authorization`, `Content-Type`, `Accept`,
    `Accept-Language`, `x-lang` only. `Origin` is deliberately **not**
    forwarded, so services never add a second CORS header.
  - `input_query_strings: ["*"]`.
- **CORS is answered by the gateway** (`extra_config."security/cors"`),
  including preflights, for the allowed web origins. Services keep their
  own `enableCors` only for direct local calls.
- Gateway `timeout` is 10s (argon2 hashing on register/login).

## Consequences

- **Every new or renamed controller route needs a `krakend.json` entry in
  the same PR**; KrakenD returns 404 for undeclared paths.
  `scripts/verify-local-stack.sh` checks health of all services and
  register/login through the gateway.
- A new forwarded header must be added in three places: `input_headers`,
  `security/cors.allow_headers`, and the service's `enableCors.allowedHeaders`.
- Validate config with `krakend check -t` (command in CLAUDE.md).
- Production allowed origins must be added to `security/cors.allow_origins`
  (and per-environment config introduced) before deploying the web app.
- Protected routes carry `auth/validator` (RS256 against platform's JWKS,
  issuer/audience checked) and propagate `X-User-Id`, `X-Session-Id`,
  `X-Subject-Type`, `X-Tenant-Id` and `X-Roles` (comma-separated). KrakenD
  overwrites client-sent values for those headers, and blanks them when the
  claim is absent (a token without `tid` arrives with an empty `X-Tenant-Id`,
  whatever the client sent; verified 2026-10-11). Services still trust only
  the verified token (ADR-0004); the headers are informational.
  A route's public/protected status must match the service (ADR-0004).
- Every backend carries a `qos/circuit-breaker` named `<service>-cb`
  (`max_errors` 5 consecutive failures within `interval` 60 s, opens for
  `timeout` 10 s). Only connection errors and timeouts count; 4xx/5xx passed
  through with `no-op` encoding do not, so failed logins cannot open it.
  With the breaker open the gateway answers 500 at once instead of waiting
  on a dead service. The global `timeout` is 10 s.
- **Structured gateway errors (SCRUM-33).** KrakenD CE answers an empty body
  with 500 when a backend is unreachable, times out or its circuit breaker is
  open, 401 with an empty body for bad tokens, and Lua `post` modifiers do not
  run on that error path; `router.error_body` only covers 404/405. So
  `krakend/plugins/error-body` is an `http-server` plugin (`pbl-error-body`)
  that wraps the router: it passes every response with a body through
  untouched and, for an error status with zero body bytes, writes
  `{timestamp, statusCode, error, message}` (500 -> 503
  `Upstream service unavailable`, 401 -> `Missing or invalid access token`).
  This applies to any empty-body error response, including a service's own
  bodiless error: a service answering 500 without a body also becomes 503.
  A rewritten response gets the request's `X-Request-Id` when it has none
  (a well-formed id only), so the client can still quote it.
  404/405 use `router.error_body` (`{error, message}`; static, keys are
  lower-cased by KrakenD, so no `timestamp`/`statusCode`).
- **Plugin build and pinning.** Plugins require the exact KrakenD version and
  toolchain, so `krakend/Dockerfile` builds with `krakend/builder:2.6.3` and
  runs on `devopsfaith/krakend:2.6.3` (compose image `pbl-krakend:2.6.3`).
  Bump both together. Rebuild: `docker compose build krakend && docker compose up -d krakend`;
  unit tests: `docker run --rm -v "$PWD/krakend/plugins/error-body:/src" -w /src krakend/builder:2.6.3 go test ./...`
  (they also run during the image build). Validate config with
  `docker compose run --rm --no-deps krakend check -t -c /etc/krakend/krakend.json`.

## Alternatives considered

- **AWS API Gateway / ALB path routing:** ties local and cloud setups
  apart, ALB can't do CORS or JWT validation as flexibly; also AWS
  resources are currently torn down to save credits.
- **NGINX/Traefik:** fine reverse proxies, but JWT/JWKS validation and
  claim propagation need plugins; KrakenD has them built in.
- **A NestJS BFF:** another service to build and maintain.
