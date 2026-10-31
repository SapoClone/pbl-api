# RBAC: platform

Design: [ADR-0020](../../decisions/0020-permissions-and-branch-scope.md). Contract: [01-platform](../2026-10-28-api-contracts/01-platform.md).

## 1. Built

**Data** (migration `1792300000000-create-role-permission-and-member-branch`, reversible)
- `role` (id, tenant_id, code, name, description, is_seeded, created_at, updated_at; unique `(tenant_id, code)`), `role_permission` (PK `(role_id, permission_code)`, FK cascade), `account_tenant.role_id` (NOT NULL, FK to `role`, no cascade), `account_tenant_branch` (PK `(account_id, tenant_id, branch_id)`, composite FK to `account_tenant` on delete cascade, FK to `branch`). No rows for a member means every branch.
- Backfill for every tenant (deleted ones too): the five seeded roles with the default permissions embedded as literals (the owner has no `role_permission` rows: it is always `*`). `account_tenant.role_id` is set from the legacy role (owner, manager to `branch_manager`, cashier to `sales_staff`) and `account_tenant.role` is rewritten to the new code.
- `down()`: roles with a legacy equivalent go back to `owner` / `manager`; every other role (warehouse_staff, accountant, custom) becomes `cashier`; the three tables and `role_id` are dropped.
- Entities: `RoleEntity`, `RolePermissionEntity`, `AccountTenantBranchEntity`; `AccountTenantEntity` gains `roleId` and a `memberRole` relation; `TenantRole` and `role-labels.ts` are gone (the role is a string code; names come from the `role` row).

**Seeding**: `seedRoles(em, tenantId)` runs inside the store-creation transaction (`TenantService.create`); the creator is an `owner` member with `role_id` of the seeded owner role.

**Token claims**: `MembershipService` returns `role` (code), `roleId`, `roleName`, `permissions` (`['*']` for the owner, else the role's codes, sorted) and `branches` (`['*']` for the owner or a member with no rows, else the ids). `AuthService.createToken` (login, refresh, switch-tenant, store create via switch-tenant) passes them to `AccessTokenService.sign`, which writes `perms` and `branches` when the token has a store (omitted without one, which `@pbl/auth` reads as none / all). Login and `GET /tenants` entries gain `roleId` and `roleName` (additive; `role` is the code).

**Endpoints** (new module `api/role/`; paths under `/api/v1`)
| Method | Path | Permission |
|---|---|---|
| GET | `/permissions` | `staff.view` (modules with labels and actions, every module x action with `isApplicable`, `defaults`: the five seeded roles' default matrices, owner = every code) |
| GET | `/roles` | `staff.view` (`{data}`: id, name, code, key, description, isSeeded, isOwner, memberCount, permissionCount) |
| GET | `/roles/{id}` | `staff.view` (adds `permissions`; the owner lists every code) |
| POST | `/roles` | `staff.update` (201; code is a slug of the name, unique per store with `_2`, `_3`) |
| PATCH | `/roles/{id}` | `staff.update` (name, description, full `permissions` set) |
| DELETE | `/roles/{id}` | `staff.update` (204) |

Members: `POST /tenants/current/members` takes `roleId` or the legacy `role` (`manager`, `cashier`, or a seeded code except `owner`; `roleId` wins when both are sent) and optional `branchIds`. `PATCH .../members/{accountId}` takes `roleId` / `role` and/or `branchIds` (full set; `[]` means every branch). The owner's role and branches cannot change (T003). Member list, detail, summary, lock, unlock, add and update responses gain `roleId`, `roleName`, `roleCode`, `branchIds`; `role` stays and is now the code. List filters: `role` (code or legacy name), `roleId`. `defaultRoleCount` is 5. Events are unchanged in shape; `role` and `previousRole` are role codes.

**Apply timing (ADR-0020)**: a role, permission or branch change reaches a member's token at their next refresh or sign-in (up to the access-token lifetime, 1 day). Nothing revokes live tokens on a role edit.

**Enforcement**: `RequireRoles` is no longer used in platform. `PATCH /tenants/current`, branch create/update/delete: `settings.update`. Branch settings GET `settings.view`, PATCH `settings.update`. Members list/summary/detail `staff.view`, add `staff.create`, PATCH/lock/unlock `staff.update`, DELETE `staff.delete`. Staff schedules GET `staff.view`, writes `staff.update`. Roles/permissions as above. No permission: `GET /tenants`, `GET /tenants/current`, `GET /tenants/current/context`, `GET /branches`, `GET /branches/{id}`, `accounts/me/*`, auth routes.

**Branch scope**: `GET /branches` filters to the token's branches; `GET/PATCH/DELETE /branches/{id}`, branch settings GET/PATCH, a schedule's `PATCH`/`DELETE`, `POST /staff-schedules` with an out-of-scope `branchId`, and `GET /staff-schedules?branchId=` outside the scope answer 404. `GET /staff-schedules` without a filter lists only allowed branches. `context.branches` and `branchCount` count only allowed branches; `context.permissions` is the token's list (the owner's `*` is expanded to every catalog code).

**Errors** (i18n en/vi/jp, `role.json`): R001 name exists, R002 owner role immutable, R003 unknown permission code, R004 seeded role not deletable, R005 role in use (409), R006 role not found (404), R007 unknown or missing role for a member, R008 owner role not assignable. Reused: T003, T023 (branch not in store). `ConflictCodeException` / `NotFoundCodeException` (`exceptions/coded.exception.ts`) carry a code through `GlobalExceptionFilter`.

**Gateway routes** (new only): `scratchpad/routes/platform-rbac.json` (6 routes: GET `/permissions`, GET/POST `/roles`, GET/PATCH/DELETE `/roles/{id}`; all protected, with the validator block). Existing member routes need no change.

## 2. Deferred

- `platform.role.updated` and `platform.membership.branches_changed` events (the event definitions live in `@pbl/contracts`, not touched here); a branch change writes no event.
- Invitations (`roleId` / `branchIds` on invitations), `code` on `PATCH members` (T024), `isOnShift` etc. are as before.
- Revoking live access tokens when a role is edited or a member's role/branches change (ADR-0020 accepts the delay).
- Role-name case rules at the database level: name uniqueness is checked in the service (case-insensitive); two concurrent creations of the same name are decided by the unique code and answer R001, but two concurrent renames could still collide.
- Deleting a branch keeps its `account_tenant_branch` rows (see decision 4).
- CLAUDE.md, ADR status and `docs/guides` updates, and the krakend entries, are for the integrator.

## 3. Decisions to review

1. `account_tenant.role_id` is NOT NULL. A rolling deploy where an old instance inserts a member without `role_id` would fail; make it nullable if the deploy cannot be atomic.
2. The owner role has no `role_permission` rows: its permissions are computed (`*` in the token, the whole catalog in `GET /roles/{id}` and `GET /permissions` defaults). Adding a permission to the catalog therefore reaches owners with no migration, while seeded non-owner roles do not gain it.
3. Seeded roles other than the owner can be renamed (contract R003 "seeded roles can't be renamed" is dropped, as the brief says they are editable). Their `code` never changes.
4. A member assigned to branches that are later soft-deleted keeps those rows. If all assigned branches are deleted the member sees no branch, not every branch (the safe side); an owner action (`PATCH` with `branchIds: []`) restores "every branch".
5. `POST /roles` unknown permission codes answer 400 R003 (an i18n code), not the contract's 422.
6. `roleId` and `role` both sent: `roleId` wins. `role` accepts only legacy names and seeded codes (not custom role codes: use `roleId`). A request with neither answers R007.
7. A role named in a request that exists in another store answers R007 / 404, never revealing it.
8. `context.permissions` for the owner is every catalog code (the contract says it mirrors the token, which would be `["*"]`), so the UI can test codes without a wildcard special case.
9. Role queries go through the `DataSource` with an explicit tenant filter (like `MemberService`), not `TenantScopedRepository`, so services can seed and read roles in transactions without a request tenant.
10. `PATCH members/{accountId}` with an empty body is a no-op that returns the member; for the owner, any `role`, `roleId` or `branchIds` is T003 (also `branchIds`, because the owner always has every branch).
11. `GET /permissions` and `GET /roles*` need `staff.view` (as the contract says), so a sales member cannot list roles.
12. Down migration turns warehouse_staff, accountant and custom roles into `cashier`, the least privileged legacy role.

## 4. How verified

- `pnpm exec tsc -p apps/platform/tsconfig.app.json --noEmit`: clean.
- `pnpm exec jest --config apps/platform/jest.config.json --maxWorkers=2 --silent`: 49 suites, 659 tests pass (`modules-set.spec.ts` did not flake).
- `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1` against Postgres 17 on 25432 (throwaway container, removed afterwards): 28 pass. New: migration with legacy data (every tenant including a deleted one, default permission counts, role text rewrite, tenant isolation of `role_id`, constraints and cascades), `MembershipService` claims and `RoleService` queries on a connection with the schema option and no `search_path`, seeding in a transaction and its rollback, roles over HTTP with the real guard and module wiring (403, 404 across stores, 409 in use), migration down restoring legacy text and up again.
- Unit tests: permission matrix for every platform route with `bearerWithPermissions` (allowed, 403 with other permissions, none, the old roles), branch scope (list filter, 404 on get/settings/schedules, empty scope returns nothing), seeding order and contents, claims in the signed token for login, switch-tenant and refresh, legacy `role` input, `roleId` of another store, i18n coverage of every `ErrorCode` in en/vi/jp, the filter for 404/409 codes.
- `eslint` and `prettier --check` on every changed platform file: clean.
