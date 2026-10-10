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
  `X-Subject-Type`; KrakenD overwrites client-sent values for those headers.
  A route's public/protected status must match the service (ADR-0004).

## Alternatives considered

- **AWS API Gateway / ALB path routing:** ties local and cloud setups
  apart, ALB can't do CORS or JWT validation as flexibly; also AWS
  resources are currently torn down to save credits.
- **NGINX/Traefik:** fine reverse proxies, but JWT/JWKS validation and
  claim propagation need plugins; KrakenD has them built in.
- **A NestJS BFF:** another service to build and maintain.
