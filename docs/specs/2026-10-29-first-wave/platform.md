# First wave: platform

## 1. Built

| Method | Path | Status vs contract |
|---|---|---|
| GET | `/tenants/current/context` | changed: plan is a `free` placeholder, `permissions` is `[]`, `me.roleId` is null, branches = every active branch (see decisions 1-3) |
| GET | `/tenants/current/members` | changed (additive): optional `q`, `status`, `role` filters; new fields `code`, `status`, `phone` (masked), `roleId` (null), `roleName`, `isOwner`, `lastLoginAt`, `isOnShift`, `scheduleLabel`; still a plain array, no pagination (decision 4) |
| GET | `/tenants/current/members/summary` | as contract (`defaultRoleCount` = 3) |
| GET | `/tenants/current/members/{accountId}` | as contract minus `invitedBy`; adds `schedules` |
| POST | `/tenants/current/members/{accountId}/lock` | changed: no `reason` body, no event, owner and self refused |
| POST | `/tenants/current/members/{accountId}/unlock` | changed: no event |
| DELETE | `/tenants/current/members/{accountId}` | changed: no event; also deletes the member's shifts |
| POST | `/tenants/current/members` | changed (additive): writes `code` and `status`; response has the new fields |
| PATCH | `/tenants/current/members/{accountId}` | unchanged request; response has the new fields |
| POST | `/accounts/me/change-password` | as contract (204, E015) |
| GET | `/accounts/me/sessions` | as contract |
| DELETE | `/accounts/me/sessions/{id}` | as contract (204, 404) |
| GET | `/accounts/me` | changed (additive): `lastLoginAt` |
| POST | `/auth/logout-all` | as contract (204) |
| POST | `/auth/email/login` | changed (additive): lockout (E010), `last_login_at`, client stored for the session list. Still `email`, no phone, no `perms` |
| GET | `/branches` | changed (additive): `isWarehouse` filter |
| GET, PATCH | `/branches/{id}/settings` | changed: owner and manager for both; no event |
| GET, POST | `/staff-schedules` | as contract (`weekday` is ISO 1-7, S001, T023) |
| PATCH, DELETE | `/staff-schedules/{id}` | as contract |

Migrations (`1792000000000`, `1792000000001`, reversible, run up and down against Postgres):
- `account_tenant`: `status`, `code` (backfilled NV001.. per store by join order, unique `(tenant_id, code)`).
- `account`: `last_login_at`, `failed_login_count`, `locked_until`.
- `refresh_token`: `user_agent`, `ip`.
- New `branch_setting` (1-1 with `branch`, unique `branch_id`) and `staff_schedule` (CHECKs on weekday and time order).

Error codes added: E010, E015, T004 (cannot lock or remove yourself), T005 (cannot lock or remove the owner), T023, S001. The en, vi and jp i18n files and `generated/i18n.generated.ts` are updated.
Events: none produced or consumed.
Gateway: new routes in `routes/platform.json` (existing routes are already in krakend; `GET /branches` needs nothing for the new filter).

## 2. Deferred

- Invitations, forgot / reset / verify email, phone login, `perms` and `branches` token claims, roles and permissions endpoints: out of scope (email, RBAC).
- `PATCH` of a member with `roleId` / `branchIds` / `code`: needs RBAC and a member-branch assignment.
- Member list `invited` status and pagination: no invitations; the list shape stays additive.
- `platform.membership.locked|unlocked|revoked`, `platform.branch_settings.updated` events: "no new events" for this wave.
- Plan quotas (`max_branches` B003), subscription on tenant create, `GET /tenants` `code`/`roleName`/`status`.

## 3. Decisions to review

1. `plan` in the context is `{code:'free', name:'Free', isExpiringSoon:false, expiresAt:null}` until subscriptions exist.
2. `branches` in the context lists every active branch for every role: there is no branch assignment and no `branches` claim (D2). `permissions` is `[]`; `me.roleId` is null and `me.roleName` comes from a fixed label map (Vietnamese) in `role-labels.ts`.
3. The context reads the caller's membership from the database, not from the token, so a removed member gets 404.
4. The existing member list stays an unpaginated array (changing it to `{data, pagination}` would break callers). Contract `status=invited` is not supported.
5. Staff reads (summary, detail, schedules GET) are owner and manager only, matching the existing member list, even though the rules map `*.view` to all three roles (cashiers would otherwise see staff emails). Lock, unlock and remove are owner only. Schedule writes and branch settings are owner and manager.
6. Owner or self lock/remove uses new codes T005 / T004 instead of the contract's T003, whose message says "owner role cannot be changed".
7. A locked member is excluded from `MembershipService` (login, switch-tenant, refresh, `GET /tenants`); lock and delete revoke that member's refresh tokens for the store and deny their live access tokens through the Redis deny-list.
8. Member code `NV001` = max suffix + 1 per store under a per-store advisory lock (not the `code_sequence` table of rule 8: platform's `account_tenant` already carries the code, so a counter table is redundant; codes of removed members can be reused only if the highest one is removed).
9. Login lockout: constants in `login-lockout.constant.ts` (5 failures, 15 min). The count is one atomic SQL update, resets to 0 when the lock starts and on success. A locked account answers E010 even with the right password and the attempt does not extend the lock. The E010 message is the localised text; the lock end time is not in the body (the custom-message path would break localisation). Unknown emails are not counted.
10. Sessions: one live refresh token per family, so `GET /accounts/me/sessions` is a list of those; `device` is parsed from the user agent ("Chrome · Windows"), `lastUsedAt` is the creation time of the current token (last refresh). `ip` is `req.ip` (behind KrakenD it may be the gateway's address unless trust proxy is configured).
11. `change-password` revokes every other family; `logout-all` revokes all, including the current one.
12. Branch settings are created lazily on first read, for owner and manager (not only the branch's own manager). Payment methods use the full D5 enum; `defaultTaxRate` is a percent 0-100 with two decimals; `invoicePrefix` is upper-cased.
13. Schedules: `weekday` 1 = Monday .. 7 = Sunday, times `HH:MM` in `Asia/Ho_Chi_Minh`. An unknown member is 404, a branch outside the store is 400 T023. Overlap is checked in the service (no DB range constraint), so two concurrent creates for the same person can both pass.
14. `onShift` counts active members only, once per branch they work in right now.
15. The existing signature of `AuthService.signIn`, `switchTenant`, `RefreshTokenService.issue` only gained optional trailing parameters; `issue` is called without the client argument when there is none, so the old tests are unchanged.

## 4. Needs from shared files

- krakend: add the 16 routes of `scratchpad/routes/platform.json` with the validator block (all are protected).
- `docs/deploy-actions.md` or ADR: nothing required; the lockout thresholds are code constants, not env.

## 5. How to verify

- `pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest --config apps/platform/jest.config.json --maxWorkers=2`: 43 suites, 494 tests pass (`modules-set.spec.ts` failed once during the run in a shared tree, passed on the final run).
- `EVENTS_IT_DB_PORT=25441 pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`: 7 pass (runs all platform migrations up and down in a throwaway schema; backfill of codes, concurrent code allocation, atomic lockout update, unique and CHECK constraints). Uses the customer worker's Postgres on 25441 because 25432 was not up.
- `pnpm exec eslint` and `prettier --check` on every changed platform file: clean.
