# ADR-0025: Support sessions give a platform admin a read-only store token, enforced by the shared guard

- **Status:** Proposed
- **Date:** 2026-11-20
- **Scope:** `platform` (support sessions, token signing, deny-list), `@pbl/auth` (verifier, guard, `AuthUser`), every
  service app (through the guard), `krakend/krakend.json`, `libs/contracts` (two events), `pbl-web` (banner, end
  button); completes [ADR-0004](0004-authentication-and-tokens.md) §3 (`act`) and extends
  [ADR-0022](0022-platform-admin-identity.md)

## Context

The screen "Hỗ trợ kỹ thuật" lets a platform admin look into one store with read-only access to find out why something
fails. [Contract 04](../specs/2026-10-28-api-contracts/04-platform-admin.md) ("Support sessions") and the web team's
request v1.2 (sections 3.4 to 6) specify the routes. [ADR-0004](0004-authentication-and-tokens.md) §3 already reserves
an `act` claim for "the acting platform admin during a SupportSession, read-only", but nothing signs or checks it.

Constraints. Every service verifies the token itself (CLAUDE.md), so a read-only rule has to live where every service
runs it, with no per-service code that one service can forget. [ADR-0022](0022-platform-admin-identity.md) keeps admins
and store users apart: an admin token passes only on `@RequirePlatformAdmin` routes. Store services read the tenant from
the token's `tid` and decide by permission (`perms`), where `["*"]` passes every check. A mistake here is a privilege
bug that reaches every store, so the design prefers failing closed.

## Decision

1. **A session is a row, the token is not stored.** `support_session` (platform schema): `code` (`SESSION-0031`), store,
   admin, `reason` (1 to 500 characters), `started_at`, `expires_at` (+60 minutes, fixed), `ended_at`, `ended_by`
   (`admin` | `expiry`), optional idempotency key. `status` (`active` | `ended` | `expired`) is derived, so a session
   that ran out is `expired` even before the job marks it. A unique index allows one open session per admin and store
   (`SS01`). A suspended store cannot be opened (`SS02`); ending twice is `SS03`.
2. **The token is platform's RS256 access token with extra claims**: `sub` and `act.sub` = the admin, `act.ssn` and `sid`
   = the session id, `sub_type = platform_admin`, `tid` = the store, `roles = []`, `branches = ["*"]`, `read_only: true`,
   `exp` = the session's end, and `perms` = every `<module>.view` code of `PERMISSION_CATALOG`, **listed one by one,
   never `*`**: the owner wildcard passes any check, so a read-only token must not look like it. There is no refresh
   token. It is returned only by `POST /admin/support-sessions` (`Cache-Control: no-store`); the field `accessToken` is in
   the logging redaction paths and never appears in a list, a detail or an event.
3. **The shared guard enforces read-only.** `AccessTokenVerifier` sets `AuthUser.readOnly` when the token has `read_only`
   **or** `act` (either alone is enough), and `AuthUser.actor = { adminId, supportSessionId }` from `act`; a malformed
   `act` is a 401. `AuthGuard` then, for a read-only token: refuses `/internal/...` paths; answers any method other than
   GET, HEAD, OPTIONS with **403 `AUTH_READ_ONLY`** before the handler runs; refuses `@RequirePlatformAdmin` routes. It is a
   read-only **store viewer**: not an admin (`sub_type` says who is acting, the guard does not treat it as an admin
   token) and not a member (no roles, so a role-gated route is refused), and it still needs the store's view permissions.
   No service writes any code for this; the wiring spec checks that each of the eight apps imports `PblAuthModule` once.
4. **One exception, explicit:** `@AllowSupportToken()` lets a read-only token reach a route even with POST. Only
   `POST /admin/support-sessions/{id}/end` has it, and its handler checks that the token's `actor.supportSessionId` is the
   session in the path (403 otherwise). An admin token may end any session.
5. **Ending kills the token at once**: the session's `sid` goes on the Redis deny-list (the one every service already
   reads) until `expires_at`; disabling or demoting an admin ends their open sessions the same way. The deny entry
   outlives the usual access-token TTL because this token lives 60 minutes.
6. **Expiry is closed by an in-service interval job** (`SupportSessionExpiryJob`, every minute): rows past `expires_at`
   with no `ended_at` are locked with `FOR UPDATE SKIP LOCKED` (safe on several replicas), marked `ended_by = expiry` with
   `ended_at = expires_at`, and `platform.support_session.ended` is emitted once. The token dies by itself at `exp`.
   Starting a session first closes that admin's expired one for the store, so a stale row never blocks a new session.
7. **Events** (outbox, same transaction, `tenantId` = the store): `platform.support_session.started`
   `{ sessionId, code, tenantId, tenantName, adminId, adminName, reason, expiresAt }` and
   `platform.support_session.ended` `{ sessionId, code, tenantId, adminId, adminName, endedBy, endedAt }`. The audit log
   consumes them.
8. **Idempotency**: `POST` accepts `Idempotency-Key`; the same admin and key return the same session (200,
   `Idempotency-Replayed`) with a freshly signed token for the rest of its life, or `SS03` when it is over.

## Consequences

- Every non-GET request with a support token fails with `AUTH_READ_ONLY`, in every service, including routes that read
  through POST (a search by POST, an export job). That is accepted: the web falls back to what GET offers during a
  support session. If a read-by-POST route proves important, it gets an explicit, reviewed opt-in, never a method list.
- A `GET` that changes state would escape the rule. The API conventions already forbid it; reviewers must keep
  rejecting it.
- Customer phone masking holds: services unmask only for `customers.update`, which the token never has.
- The gateway needs no new rule: its validator accepts the extra claims, forwards `Authorization` untouched, and
  propagates `sub_type = platform_admin` and an empty `roles` as `X-*` headers; services never trust those headers, and
  the token alone decides.
- A support token is a valid platform-signed token for the hour. Revocation is the deny-list, so a service without
  `REDIS_HOST` keeps honouring an ended session until `exp` (the same limit as logout today; the guard logs an error in
  production and staging when Redis is missing).
- The `@pbl/auth` minor bump is `1.4.0` (an optional `AuthUser` field, a decorator, a constant).
- Revisit if support needs write actions (it would be a different, audited command, not a wider token) or if sessions
  must outlive an hour (a re-open creates a new session and a new audit record).

## Alternatives considered

- **`perms: ["*.view"]` as a wildcard string** (contract 04's wording): needs a new evaluation rule in `hasPermission`
  and puts the owner-wildcard code path at risk. The explicit list needs no change in evaluation. Contract 04 now says so.
- **Per-service read-only checks** (a decorator or interceptor each service adds): forgotten once, a hole in that service.
  The global guard of `@pbl/auth` covers every service, current and future.
- **Enforce at the gateway only** (block non-GET when the claim is present): services verify tokens themselves and the
  internal routes bypass the gateway, so it cannot be the only layer. Not needed as a second layer either; the guard is
  authoritative.
- **Impersonate the store owner** (sign an owner token with `act`): would carry `perms: ["*"]` and every write
  permission, relying on one check to hold back the rest. A token that cannot write fails safe if that check regresses.
- **A refresh token for the session**: nothing renews a support session by design; one hour, then a new session with a
  new reason and a new audit trail.
- **Store the token to show it again**: a stored credential in the database for no use. Replays sign a new token instead.
- **Mark expiry only lazily** (no job): the audit trail would miss the end of every session nobody ended by hand.
- **Use the admin's own token with a `tid`** (admin token plus `X-Tenant`): breaks ADR-0008 (tenant from the token only)
  and ADR-0022 (admin tokens carry no store).
