# ADR-0004: Platform is the sole token issuer; RS256 + JWKS verified at gateway and service

- **Status:** Accepted (direction: pbl-infra architecture says "Auth hiện
  dùng secret đối xứng; đích là RS256 + JWKS") · Proposed (the specifics
  below, written 2026-10-08, pending team review)
- **Date:** 2026-10-08
- **Scope:** `apps/platform/src/api/auth`, `guards/`, `krakend/krakend.json`, every service

## Context

Today (`auth.service.ts`, `guards/auth.guard.ts`): platform signs and
verifies HS256 access tokens with `AUTH_JWT_SECRET`; refresh tokens are
JWTs bound to a `session` row (hash rotated on refresh); logout puts the
session id in a Redis blacklist checked on every request; tokens carry
`role: ''`. This works for one service, but with a shared secret every
service that can verify a token can also forge one, and the Redis
blacklist couples every service to platform's Redis.

## Decision

1. **Only platform issues tokens.** No other service holds signing material.
2. **RS256 access tokens**, short-lived (5–15 min), signed with a private
   key kept in AWS Secrets Manager/KMS. Platform publishes public keys with
   a `kid` at `GET /.well-known/jwks.json`, routed publicly through the
   gateway.
3. **Claims** (aligned with the platform ERD):
   `iss`, `aud`, `sub`, `sub_type` (`account` | `staff` | `platform_admin` | `service`),
   `tid` (tenant — **one tenant per token**; switching tenant = token exchange),
   `branches`, `roles`, `perms` (Permission codes), `sid`, `jti`, `exp`, and
   `act` (acting platform admin during a `SupportSession`, read-only).
4. **Verification twice:**
   - KrakenD `auth/validator` on every protected endpoint (signature, exp,
     iss, aud, coarse role checks), with `propagate_claims` to
     `X-User-Id`/`X-Tenant-Id`/`X-Subject-Type` headers.
   - Each service **re-verifies the forwarded `Authorization` token**
     locally against cached JWKS through a shared `libs/auth` guard
     (ADR-0006). Services never trust `X-*` identity headers alone.
5. **Authorization stays in the owning service:** gateway does
   authentication + coarse roles; fine-grained permission checks
   (`@RequirePermission('order.create')`) and tenant scoping (every query
   filtered by the token's `tid`) happen in the service that owns the data.
6. **Refresh tokens are opaque**, stored hashed in the `RefreshToken`
   table (ERD), rotated on every use with reuse detection (reuse →
   revoke the family). Only platform handles them. This replaces the
   `session` table and the Redis blacklist.
7. **Revocation:** rely on short access-token TTL. Only if instant
   revocation is required, a small Redis deny-list keyed by `sid`, checked
   inside `libs/auth` — never a per-request call to platform.
8. **Service-to-service:** forward the user's token for on-behalf-of
   calls; platform-issued service tokens (`sub_type: service`) for
   background/system calls. Events carry `tenant_id` + actor id in the
   payload; consumers trust the bus via IAM, not JWTs.
9. **Key rotation:** publish current + next key, sign with the new `kid`,
   retire the old key after max token TTL + JWKS cache time.

## Migration plan (each step shippable on its own)

1. Platform: RS256 key pair, JWKS endpoint, `kid` signing; accept HS256
   and RS256 during the transition.
2. KrakenD: `auth/validator` + `propagate_claims` on protected routes
   (`disable_jwk_security: true` only for the local http JWKS URL).
3. Extract the guard into `libs/auth`; adopt it in all 6 apps; add
   `@RequirePermission`.
4. Move refresh tokens to the `RefreshToken` table; remove `session` and
   the Redis blacklist.
5. Populate `tid`/`roles`/`perms` once Tenant/Staff/RBAC entities exist.

## Consequences

- Until step 1 ships, keep the current HS256 flow working; don't add new
  consumers of `AUTH_JWT_SECRET` outside platform.
- New endpoints must take user/tenant identity from the token
  (`@CurrentUser()`), never from the request body/path.
- KrakenD must reach platform's JWKS endpoint at startup and on cache expiry.

## Alternatives considered

- **Keep HS256 and share the secret:** any service could mint tokens.
- **Gateway-only verification, services trust headers:** a single
  misconfigured security group or debug port lets anyone spoof identity.
- **Opaque tokens + introspection call per request:** couples every
  request to platform's availability and latency.
- **External IdP (Cognito/Keycloak):** the tenant/staff/RBAC model is core
  domain logic of the platform service; an IdP adds cost and a second
  user store.
