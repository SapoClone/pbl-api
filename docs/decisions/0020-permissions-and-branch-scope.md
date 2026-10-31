# ADR-0020: Permissions are role-based, carried in the token, with branch scope

- **Status:** Proposed
- **Date:** 2026-10-31
- **Scope:** `@pbl/contracts` (catalog, defaults), `@pbl/auth` (claims, guard, decorators), `platform` (roles, tokens), every service's controllers
- **Builds on:** [ADR-0004](0004-authentication-and-tokens.md) step 5, [ADR-0008](0008-tenancy.md), [ADR-0019](0011-store-users-are-accounts.md)

## Context

Authorization is three fixed roles (`owner`, `manager`, `cashier`) checked with `@RequireRoles`. The design asks for
five default roles, custom roles, a matrix of module by action that the owner edits (`Vai trò & quyền`), and staff
who work in only some branches. ADR-0004 already planned `perms` and `branches` claims and `@RequirePermission`.

## Decision

**Permissions**

1. A permission is `<module>.<action>`. Modules: `dashboard`, `products`, `inventory`, `orders`, `pos`, `channels`,
   `customers`, `purchasing`, `staff`, `reports`, `settings`. Actions: `view`, `create`, `update`, `delete`,
   `approve`. Only the combinations that mean something exist; the list is the **catalog** in `@pbl/contracts`
   (`PERMISSIONS`). The catalog is code, not a table: adding a permission is a code change that ships with the
   service that enforces it. `GET /permissions` serves it.
2. A **role** belongs to a store (`role`: id, tenant, code, name, `is_seeded`) and grants a set of permission codes
   (`role_permission`). Every store gets five seeded roles on creation: `owner`, `branch_manager`, `sales_staff`,
   `warehouse_staff`, `accountant`. Their default permissions are in `@pbl/contracts` (`DEFAULT_ROLE_PERMISSIONS`).
   Owners may edit seeded roles except `owner` (immutable, always every permission) and create custom roles.
   Seeded roles cannot be deleted; a custom role with members cannot either.
3. A member has exactly one role: `account_tenant.role_id`. `account_tenant.role` keeps the **role code** as text so
   events and the `roles` claim stay readable. Legacy `manager` becomes `branch_manager`, `cashier` becomes
   `sales_staff`; the API still accepts the legacy names on input.

**Tokens**

4. Platform signs three claims for the selected store: `roles` (`[code]`, as today), `perms` (permission codes;
   `["*"]` for the owner) and `branches` (branch ids, or `["*"]`). The claims are computed at sign-in, refresh and
   switch-tenant. A change to a role or a member applies at the next refresh or sign-in, as role changes do today.
5. A token **without** `perms` (issued before this change) is read as: `roles` contains `owner` gives `["*"]`,
   anything else gives no permissions, and a missing `branches` means all branches. There is no role-to-permission
   fallback inside `@pbl/auth`: that library is published to GitHub Packages and cannot depend on `@pbl/contracts`,
   which is internal (ADR-0009). Non-owner members whose access token predates the change get 403 until their next
   refresh or sign-in, which at most lasts the access-token lifetime.

**Enforcement**

6. `@RequirePermission(...codes)` in `@pbl/auth`: the caller needs **at least one** of the codes; the owner's `*`
   passes everything; 403 otherwise. `@RequireRoles` stays for compatibility and is no longer used by services.
7. A route that is open to every member of the store (branch list, own account, notifications) carries no permission.
8. **Branch scope.** `branches` lists the branches the member may act in. A request that names a branch outside the
   scope answers **404** (never 403, so existence is not leaked). A list without a branch filter returns only the
   allowed branches. `@pbl/auth` provides `canAccessBranch(user, branchId)` and `allowedBranches(user)`.
   A member with no assignment rows may use all branches; the owner always may.

**Default role behaviour**

9. `branch_manager` keeps what the old `manager` could do (everything except member management, role editing and
   store/branch settings). `sales_staff` keeps what the old `cashier` could do and gains the dashboard and order
   updates the design shows. The owner edits these per store; the matrices are data.

## Consequences

- Every controller moves from `@RequireRoles` to `@RequirePermission`; each service's tests assert the new codes.
- Tokens grow by the permission list (about 40 short strings for a role with everything but the owner).
- Role and permission edits are not instant: up to the access-token lifetime (1 day today). Shortening the token
  lifetime is the separate ADR-0004 step.
- Seeding roles for existing stores is a data migration; new stores seed on creation.
- Revisit when a store needs several roles per member, per-branch roles, or deny rules.

## Alternatives considered

- **Check permissions through a call to platform on every request.** Always fresh, but every service depends on
  platform's availability and latency. Claims in the token keep services independent (ADR-0004).
- **A `permission` table.** Gives foreign keys, but the catalog must change with the code that enforces it, so a
  table only adds a second place to keep in step.
- **Several roles per member.** More flexible, but the design shows one role per staff member and a union of roles
  makes the matrix harder to read.
- **403 for an out-of-scope branch.** More informative, but it confirms that the branch exists.
