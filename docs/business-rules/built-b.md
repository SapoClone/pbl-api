# Built: workstream B, branch lifecycle

Branch `feat/branch-lifecycle-guard`. Decisions D4, D5, D8, D9, D10, D11, D12, D38 (and D6 for the member count, which
workstream D owns: the change is two lines). How it works: [guide](../guides/branch-guard.md). Contract:
[01-platform](../specs/2026-10-28-api-contracts/01-platform.md) (branches, tenants, members).

## What was built

| Decision | Built | Where | Tests |
|---|---|---|---|
| D4 | `GET /internal/v1/branches/{id}/blockers` in inventory, sales and integration; platform asks all in parallel inside the row-locked transaction and refuses with `409 B005` listing every reason (also platform's own); `503 B009` when a service cannot be asked; delete needs inactive first (`400 B004`) | `apps/{inventory,sales,integration}/src/internal/branch-blockers.*`, `apps/platform/src/api/branch-guard/*`, `branch/branch-lifecycle.guard.ts`, `branch/branch.service.ts`, `libs/contracts/src/branch-blockers.ts` | unit: guard, client, service, controllers; int (Postgres): inventory, sales, integration blockers, platform `branch-lifecycle.int-spec.ts` |
| D5 | `GET /internal/v1/members/{accountId}/blockers` in sales; `MemberService.remove` refuses with `409 T010`; lock stays allowed | `apps/sales/src/internal/*`, `apps/platform/src/api/tenant/member.service.ts` | `member.service.spec.ts`, sales int |
| D8 | `PATCH` with a different `code` is `400 B007`; a soft-deleted branch's code is still taken (`B001`) | `branch.service.ts` (`assertCodeFree` uses `withDeleted`) | `branch.service.spec.ts`, platform int |
| D9 | create, update and delete a branch need a token that sees every branch, else `403 B008` | `branch.controller.ts` | `branch.controller.spec.ts` |
| D10 | `CreateTenantReqDto.defaultBranchName`; self-serve creation emits `platform.tenant.created` | `tenant/dto/create-tenant.req.dto.ts`, `tenant.service.ts` | `tenant.service.spec.ts`, platform int |
| D11 | at most 3 stores per account (`400 T009`), counted from owner memberships, advisory-locked | `MAX_STORES_PER_ACCOUNT` in `tenant.service.ts` | `tenant.service.spec.ts`, platform int |
| D12 | invoice prefix unique per store, case-insensitive (`409 B006`), validated on settings `PATCH` under an advisory lock | `branch-setting.service.ts` | `branch-setting.service.spec.ts` |
| D38 | delete removes the branch from members' assignments in the same transaction and ends the sessions of those who lost it after the commit; additions stay lazy | `branch.service.ts`, `branch-lifecycle.guard.ts` | `branch.service.spec.ts`, platform int |
| D6 | `QuotaService` and `usage.ts` count only ACTIVE members; inactive branches still count | `subscription/quota.service.ts`, `usage.ts` | `quota.service.spec.ts`, platform int |

## ADR-level note: a synchronous cross-service read

[ADR-0010](../decisions/0010-eight-services.md) allows one synchronous call between services (sales asking inventory
to hold stock). The blockers contract adds a second, **read-only** one: platform asks three services before a branch
stops. It is acceptable because:

- the question cannot be answered from events: platform would need a copy of every service's open work, and a stale
  copy would let a branch be deleted while stock or a shift is still on it;
- it is a rare admin action (deactivate or delete a branch, remove a member), never on the sales path, so latency and
  load do not matter (3 second timeout, three parallel calls);
- it **fails closed**: a service that cannot be asked, or answers badly, makes the action fail with `503 B009` naming
  the service, so an outage can delay an admin action but never lose data;
- it carries no write and no user token (`asService`, the shared service token, tenant from the header after the
  token), and the routes are not in the gateway.

Cost to know: the call happens inside the transaction that holds the store row lock, so a slow service holds that lock
for up to the timeout. Only other "last branch" changes of the same store wait on it. The check and the change are not
atomic across services: a shift opened a moment after the answer can still land on a branch that is then deactivated;
sales refuses to open a shift on a branch that is not `active` (its projection), which closes the window after the event
arrives.

## Deviations and interpretations

- **Deactivate** applies the member rule only on delete: deactivating does not remove assignments, so no member loses a
  branch. "Left with no branch" is counted against live (not deleted) branches.
- **`B002`** keeps its `400` answer when the last active branch is the only reason; with other reasons it is one entry
  of the `409 B005` list, so the screen shows everything.
- **Delete is also refused to a scoped member** (`B008`), beyond the brief's create and update, because a delete changes
  other members' scope.
- **Live connections** are every state but `PENDING_AUTH` and `DISCONNECTED`: a paused or re-authorisation connection can
  be resumed and still points at the branch.
- **Unfinished orders** are `PENDING` and `CONFIRMED`. A completed order whose fulfilment is still open is not counted.
- **Finance** reports nothing (see the guide).
- **Stale assignment rows from before this change** (members pointing at already deleted branches) are not migrated:
  deleting them would turn those members into "every branch" members, a privilege widening. They are ignored when counting
  a member's live branches. A one-off clean-up should be decided by the owner.
- **Invoice prefix**: branches that never saved settings carry the implicit default `HD` and are not compared.
- **Admin-created stores** are not limited to 3 per owner (D11 is for self-serve creation).
- **Tests first**: the unit specs for the new rules were written with the code, not before it; the defects (delete of an
  active branch in one step, code reuse, no scope cleanup) are covered by the Postgres spec, which fails on the old
  `remove` (no `B004`, no assignment cleanup, no revocation).

## Needs doing elsewhere

- **pbl-infra** (`terraform/ecs.tf`, `secrets.tf`): platform's task needs `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL`,
  `INTEGRATION_SERVICE_URL`, `INTERNAL_S2S_TOKEN` (and optionally `BRANCH_GUARD_TIMEOUT_MS`); inventory, sales and
  integration need `INTERNAL_S2S_TOKEN` (they already read it). Network access from platform to those services.
- No new events, no `topology.ts` change, no new gateway route.
