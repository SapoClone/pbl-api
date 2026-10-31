# ADR-0019: Store users are accounts with a membership, not a separate Staff identity

- **Status:** Proposed
- **Date:** 2026-10-31
- **Scope:** `platform` (accounts, tenancy, auth), `@pbl/auth` token claims, `pbl-infra` ERD (`Staff`, `StaffRole`, `StaffBranch`)

## Context

The ERD in `pbl-infra/docs/erd_viewer.html` models store employees as `Staff`: a tenant-owned row with its own
email and password, next to `Account`. The code never built it. Since P0 every person who signs in is an `Account`,
and `account_tenant(account_id, tenant_id, role)` says which stores they belong to and in what role
([ADR-0008](0008-tenancy.md)). Tokens carry `sub_type = account`.

The design needs: one person working in two stores, staff who are invited by email and set their own password,
a code per member (NV013), a lock state, a shift schedule and a branch assignment. None of that needs a second
credential store.

## Decision

1. **A store user is an `Account` plus an `account_tenant` row.** There is no `Staff` identity and no staff
   password. The ERD's `Staff`, `StaffRole` and `StaffBranch` collapse into `account_tenant` (role, status, code)
   and the membership tables below.
2. **Membership data lives on `account_tenant`** and in tables keyed by `(account_id, tenant_id)`: role
   (ADR-0020), status (`active`, `locked`), a per-store code, branch assignment, schedule.
3. **`sub_type` stays `account` for store users.** `staff` is kept in the token type for compatibility but is never
   issued. `platform_admin` stays reserved for the admin identity, which is a separate decision.
4. **Invitations** (when built) create an `Account` when the email is unknown, or reuse it, then a membership.
   The invitation link sets the password for a new account. There is no per-store password.

## Consequences

- One login for a person in several stores; store switching is `POST /auth/switch-tenant` as today.
- Locking a member is per store (`account_tenant.status`); disabling the whole account stays an account-level action.
- The `Staff` entities should be removed from the ERD (separate pbl-infra change).
- A member's name and phone live on the account, so they are the same in every store. If a store ever needs its own
  display name, add it to the membership, not a second identity.
- Revisit if a store must create logins for people who have no email, or must own the credentials of its staff.

## Alternatives considered

- **Separate `Staff` per tenant (the ERD).** Cleaner data ownership per store, but a second credential store,
  a second token subject type, no single sign-in across stores, and a rewrite of everything built on `Account`.
  Nothing in the design requires it.
