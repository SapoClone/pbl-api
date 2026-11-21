# Support sessions ("Hỗ trợ kỹ thuật")

A platform admin looks into one store with a **read-only** token to find out why something fails. Design and rejected
alternatives: [ADR-0025](../decisions/0025-support-sessions.md). Routes:
[contract 04](../specs/2026-10-28-api-contracts/04-platform-admin.md#support-sessions-platform).

## The flow for the web

1. **Start (admin web, screens 03 and 22).** The admin picks a store (`GET /platform/api/v1/admin/tenants`) and types a
   reason (1 to 500 characters), then calls
   `POST /platform/api/v1/admin/support-sessions` with `{ tenantId, reason }` and the admin token. Send an
   `Idempotency-Key` (a fresh uuid per click) so a double click or a retry does not fail with `SS01`.
2. **Keep the token in memory only.** The response carries `accessToken` once. It is never in the list, the detail or
   an event, so the web cannot read it again; do not put it in `localStorage`, a cookie or a URL. Hand it to the store
   web with `window.open` plus `postMessage`, or a one-time value in `sessionStorage` of the new tab, and drop it when
   the tab closes. A retry with the same `Idempotency-Key` returns the same session with a fresh token while it is
   active, so a lost token can be recovered that way.
3. **Open the store web with that token** as its bearer token, with no refresh token (there is none). Call the store
   APIs as usual through the gateway (`/<service>/api/v1/...`). Everything the store's owner can **read** works; a
   store's customers' phones stay masked (the token has no `customers.update`).
4. **Show a banner** the whole time: "Phiên hỗ trợ chỉ đọc", the store name, the admin name, a countdown to
   `expiresAt` (60 minutes, fixed; there is no extension) and the button **"Kết thúc phiên"**. Hide or disable every
   create, edit, delete and approve control: the server refuses them anyway (below). Detect a support session from the
   token's `act` or `read_only` claim (decode the payload, do not verify it client-side) or from how the tab was
   opened.
5. **End.** The banner button calls `POST /platform/api/v1/admin/support-sessions/{id}/end` with the **support token**
   (the session id is the token's `sid` or `act.ssn`); the admin web may end the session with the admin token from the
   history screen. The token stops working at once in every service. At expiry the token dies by itself and a job
   closes the record within a minute. Then close the tab or return to the admin web.
6. **History (screen 22).** `GET /platform/api/v1/admin/support-sessions` with `tenantId`, `adminId`,
   `status=active|ended|expired`, `q`, `page`, `limit`; the response has `counts` for the tabs.

## What the token can and cannot do

| Request with a support token | Answer |
|---|---|
| GET, HEAD, OPTIONS on a store route the owner could read | works, in that store only |
| any other method on any service | 403, `errorCode: "AUTH_READ_ONLY"`, the handler never runs |
| a POST that only reads (search by POST, an export job) | 403 `AUTH_READ_ONLY`; use the GET routes (accepted limit) |
| `/internal/...` routes | 403 |
| platform admin routes, `/admin/me`, `/admin/auth/*` | 403 (it is not an admin token) |
| a route that needs a role or a write permission | 403 (no roles, only `<module>.view` permissions) |
| `POST /admin/support-sessions/{id}/end` of its **own** session | 200 |
| the same, for another session | 403 |
| any call after the session ended or expired | 401 |

Show `AUTH_READ_ONLY` as "Phiên hỗ trợ chỉ cho phép xem" (the platform's own message is translated by `Accept-Language`).

## Error codes

| Code | Status | Meaning | Screen text |
|---|---|---|---|
| `SS01` | 400 | this admin already has an active session for this store | offer to resume it: it is in the history list with `status=active` |
| `SS02` | 400 | the store is suspended | "Cửa hàng đang bị khóa, không thể mở phiên hỗ trợ" |
| `SS03` | 400 | the session already ended (by hand or by expiry) | refresh the history |
| `AUTH_READ_ONLY` | 403 | a support token tried to write | see above |
| 404 | | unknown store (start), unknown session (end, detail) | |
| 422 | | missing or too long `reason`, `tenantId` not a uuid | |

Messages are in `apps/platform/src/i18n/{en,vi,jp}/support_session.json`.

## Events and audit

`platform.support_session.started` and `platform.support_session.ended` (`endedBy: "admin" | "expiry"`) are emitted for
the store through the outbox in the same transaction as the change; the audit log consumes them. Disabling or demoting
an admin ends their open sessions (and denies their tokens).

## For service authors

Nothing: the read-only rule is in the global `AuthGuard` of `@pbl/auth` (1.4.0), so a new service gets it by importing
`PblAuthModule`. Do not write a state-changing GET. A read that has to be a POST needs a reviewed exception in the
guard, not a check in the service. Tests: `libs/auth/src/auth.guard.spec.ts`, `read-only.wiring.spec.ts` (boots a Nest
app with the real module and checks every app imports it), `apps/platform/test/support-session.int-spec.ts` (Postgres).
