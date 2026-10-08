# ADR-0004: Platform is the sole token issuer; RS256 + JWKS verified at gateway and service

- **Status:** Accepted — steps 1–4 implemented on 2026-10-08 (see
  "Implementation status"); step 5 pending. Direction from pbl-infra
  architecture ("Auth hiện dùng secret đối xứng; đích là RS256 + JWKS").
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

1. Platform: RS256 key pair, JWKS endpoint, `kid` signing. (Planned: accept
   HS256 and RS256 during a transition — dropped, see below.)
2. KrakenD: `auth/validator` + `propagate_claims` on protected routes
   (`disable_jwk_security: true` only for the local http JWKS URL).
3. Extract the guard into `libs/auth`; adopt it in all 6 apps; add
   `@RequirePermission`.
4. Move refresh tokens to the `RefreshToken` table; remove `session` and
   the Redis blacklist.
5. Populate `tid`/`roles`/`perms` once Tenant/Staff/RBAC entities exist.

## Implementation status

| Step | State | Where |
|---|---|---|
| 1. RS256 + JWKS | Done | `apps/platform/src/api/auth/access-token.service.ts`, `jwks.controller.ts`; env `AUTH_JWT_PRIVATE_KEY` (base64 PEM, RSA ≥ 2048), `AUTH_JWT_KEY_ID`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` |
| 2. Gateway validation | Done | `krakend/krakend.json` `auth/validator` on every protected route; claims → `X-User-Id`, `X-Session-Id`, `X-Subject-Type` |
| 3. `libs/auth` in all apps | Done | `libs/auth` (`@pbl/auth`); platform: `PblAuthModule.forRootAsync` in `auth.module.ts`; others: `PblAuthModule.forRemoteJwks()` + `AUTH_JWKS_URL` |
| 4. Opaque refresh tokens | Done | `refresh-token.service.ts`, `entities/refresh-token.entity.ts`, migration `1791476400000-replace-session-with-refresh-token.ts` |
| 5. `tid`/`roles`/`perms` + `@RequirePermission` | **Pending** | Needs Tenant/Staff/RBAC entities first |

Deliberate deviations from the plan above:

- **No HS256 transition window.** The AWS deployment was torn down, so no
  live HS256 tokens existed; accepting two algorithms would only have added
  attack surface. Platform switched to RS256 in one step.
- **`family_id` added to the ERD's `RefreshToken`.** Every token rotated out
  of one login shares a `family_id`, and that id is the access token's
  `sid`. This keeps `sid` stable across refreshes (logout kills every access
  token of that login) and limits reuse revocation to the compromised login
  instead of all of the user's sessions.
- **Redis deny-list kept (§7).** Access tokens still live `1d` because
  pbl-web has no refresh logic yet; without the deny-list logout would not
  take effect for up to a day. Remove it once the TTL is 5–15 min. On
  refresh-token reuse the family's `sid` is also denied, so an attacker's
  live access tokens die immediately.
- **Concurrent refreshes count as reuse.** Rotation is a conditional update;
  of two simultaneous refreshes with the same token, the loser revokes the
  family (the user logs in again). Clients must serialize refreshes.

Production follow-ups: pbl-infra must provision `AUTH_JWT_PRIVATE_KEY` /
`AUTH_JWT_KEY_ID` (SSM) and `AUTH_JWKS_URL`, and drop `AUTH_JWT_SECRET` /
`AUTH_REFRESH_SECRET`; the production gateway must use an https JWKS URL
without `disable_jwk_security`; key rotation (§9) currently supports one
active key — publishing a "next" key needs a second key slot in
`AccessTokenService`.

## Consequences

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
