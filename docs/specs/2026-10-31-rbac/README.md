# RBAC: review guide

**Date:** 2026-10-31. **Branch:** `feat/rbac-permissions`, stacked on `feat/first-wave-screen-apis`.

Roles, permissions and branch scope, as designed in [ADR-0019](../../decisions/0019-store-users-are-accounts.md) and
[ADR-0020](../../decisions/0020-permissions-and-branch-scope.md). Every endpoint now checks a permission instead of a
role name, and a member can be limited to some branches. Per-service reports: [platform](platform.md),
[sales](sales.md), [inventory](inventory.md), [insight](insight.md), [catalog](catalog.md),
[customer](customer.md). End-to-end checks: [e2e.md](e2e.md).

## For frontend developers

- **Sign in as before.** The access token now also carries `perms` (permission codes, `["*"]` for the owner) and
  `branches` (branch ids, or `["*"]`). `roles` holds the role code (`owner`, `branch_manager`, `sales_staff`,
  `warehouse_staff`, `accountant`, or a custom code).
- **Drive the UI from one call:** `GET /platform/api/v1/tenants/current/context` returns `me` (with `roleId`,
  `roleName`, `isOwner`), the `branches` the member may use, and `permissions` (the owner's `*` is expanded to every
  code, so test codes directly, no wildcard case). Hide menu items and buttons by permission code, for example
  `orders.create`, `purchasing.approve`.
- **Role editor screen:** `GET /permissions` (the catalog by module, plus the default matrices),
  `GET/POST /roles`, `GET/PATCH/DELETE /roles/{id}`; assign with `PATCH /tenants/current/members/{accountId}`
  `{ "roleId": "...", "branchIds": ["..."] }`. These need `staff.view` (reads) and `staff.update` (writes).
- **Status codes:** 403 when the member lacks the permission; **404** when a branch, order, document or
  notification belongs to a branch outside the member's scope (never 403, so existence is not leaked).
  A list without a branch filter returns only the member's branches.
- **Changes are not instant.** A role, permission or branch change reaches a member at their next sign-in or token
  refresh. Until then their token keeps the old claims.
- Permissions and defaults: [docs/guides/permissions.md](../../guides/permissions.md).

## What exists

| Area | Built |
|---|---|
| `@pbl/contracts` | permission catalog (38 codes in 11 modules), role codes, default matrices, legacy role mapping |
| `@pbl/auth` 1.1.0 | `perms` / `branches` claims, `@RequirePermission`, `hasPermission`, `canAccessBranch`, `allowedBranches`, `@AllowedBranches()`, test helper `bearerWithPermissions` |
| platform | `role`, `role_permission`, `account_tenant.role_id`, `account_tenant_branch`; five seeded roles per store (backfilled for existing stores); claims on login, refresh and switch-tenant; 6 new endpoints; member role and branch assignment |
| sales, inventory, insight, catalog, customer | every `@RequireRoles` replaced by `@RequirePermission`; branch scope in sales, inventory, insight and the platform's branch routes |
| gateway | +6 routes (174 entries); `krakend check` passes |

## How it was verified

| Check | Result |
|---|---|
| `tsc` for all 8 apps, `eslint`, `prettier --check` (TypeScript) | clean |
| Unit tests: platform | 659 pass |
| Unit tests: libs and the other apps | 751 pass, 2 fail (the `InternalHttpClient` "does not leak the token" tests, **failing before this work**) |
| Integration tests, Docker network (events, sales, inventory, insight, catalog, customer) | 182 pass |
| Platform integration (migration up/down with legacy data, roles, isolation, endpoints with the real guard) | 28 pass |
| `scripts/demo-rbac.sh` (new): roles, claims, enforcement in every service, branch scope, role change | 142 checks |
| `scripts/demo-first-wave.sh`, `scripts/demo-events.sh`, `scripts/verify-local-stack.sh` | pass (3 assertions in the first-wave script changed for intended RBAC behaviour: [e2e.md](e2e.md)) |

## Behaviour that changed

| Before | Now |
|---|---|
| Roles `manager`, `cashier` | `branch_manager`, `sales_staff`. The old names are still accepted as input (`role: "manager"`) and mapped. |
| `manager` could do everything except member and store settings | `branch_manager` has every permission except `staff.create/update/delete` and `settings.update`. Same reach, but now an owner can narrow it per store. |
| Cashier: orders, stock read, customers, shifts | `sales_staff` keeps that and gains the dashboard (`dashboard.view`) and `orders.update` (confirm, pack, ship). It cannot cancel (`orders.delete`) or read reports. |
| Dashboard and reports: owner and manager only | `dashboard.view` for the seeded roles; `reports.view` (daily summary, by-branch, export, audit log) for owner, branch manager and accountant. |
| Customer phone hidden from cashiers | Full phone for anyone with `customers.update` (so `sales_staff` sees it); others get a masked phone. |
| One role per member, all branches | One role per member, plus optional branch assignment (no rows means every branch). |
| Duplicate role name | 409 `R001`, in line with conflicts elsewhere (the contract said 400). |

## Decisions to review

| # | Decision | Why it matters |
|---|---|---|
| 1 | **Non-owner tokens issued before the deploy get 403 until refresh or sign-in** (no role-to-permission fallback in `@pbl/auth`, which cannot depend on the internal contracts library). | One-time hiccup at deploy, at most the access-token lifetime. |
| 2 | **`account_tenant.role_id` is `NOT NULL`.** A rolling deploy where an old instance inserts a member without it would fail; make it nullable if the deploy cannot be atomic. A **local** database with existing members must be reset (`docker compose down -v`), because compose uses `synchronize`. | Deployment order. |
| 3 | **The owner role has no stored permissions** (always `*`). A permission added to the catalog reaches owners at once; seeded non-owner roles need a migration to gain it. | Every new permission needs a data migration for the other four roles. |
| 4 | **The default matrices are wider than the Figma matrix** for `branch_manager` (everything except staff and store settings), to keep what managers could already do. Owners can narrow them. | Product call: follow Figma exactly or preserve behaviour. |
| 5 | **Role and permission edits are not revoked live.** They apply at the next refresh or sign-in; the access token still lives one day. | Shortening the token lifetime and adding refresh to the web client is the real fix (ADR-0004). |
| 6 | **Internal reservation routes** accept `pos.create`, `orders.create` or `orders.update` (reserve) and also `orders.delete` (release), because sales calls them with the user's own token on create, confirm and cancel. | A narrower rule would break confirm or cancel for roles that hold only that permission. |
| 7 | **Branch scope rules:** no assignment rows means every branch; a member whose assigned branches are all deleted sees none; transfers are visible when either end is in scope, but shipping and cancelling need the source and receiving needs the destination. | Behaviour you may want to tighten. |
| 8 | **Audit logs are tenant-wide** (gated by `reports.view`), not branch-scoped, because the table has no branch. | A restricted manager sees every branch's audit entries. |
| 9 | **Seeded roles other than the owner can be renamed**, and their permissions edited; their `code` never changes. | The contract forbade renaming. |
| 10 | **Role queries use an explicit tenant filter**, not `TenantScopedRepository`, so roles can be seeded in a transaction before a request tenant exists (same exception as inventory). | A convention exception, covered by cross-tenant tests. |
| 11 | **`POST /roles` with an unknown permission code is 400 `R003`**, not the contract's 422; deleting a seeded or owner role is 400 `R004`. | Only the duplicate-name case was moved to 409. |
| 12 | **Customer:** a member with `customers.create` but not `customers.update` sees a masked phone on the customer they just created; `DELETE` of an address needs `customers.delete`, so `sales_staff` can no longer remove one. | Edge effects of the permission split. |

## Not done

| Item | Why |
|---|---|
| Staff invitations by email, forgot / reset / verify email | Need the mail flow (templates in `pbl-mail-service`) |
| Events `platform.role.updated`, `platform.membership.branches_changed` | Event names live in the shared `libs/contracts`; no consumer needs them yet |
| Instant revocation on a role edit | See decision 5 |
| Several roles per member, per-branch roles, deny rules | Not in the design |
| `ROLES.MANAGER` / `ROLES.CASHIER` removal | Deprecated, kept for one release |
| Removing `Staff`, `StaffRole`, `StaffBranch` from the ERD | pbl-infra change (ADR-0019) |
| Branch-scope coverage in the end-to-end scripts for transfers, stock takes, registers, shifts, schedules, notifications | Covered by unit and integration tests only |

## Shared files changed

| File | Change |
|---|---|
| `krakend/krakend.json` | +6 routes for `/permissions` and `/roles` |
| `CLAUDE.md` | Auth rules, current-state table, the local-volume trap, the new scripts |
| `docs/decisions/` | ADR-0019, ADR-0020 and the index |
| `scripts/demo-events.sh`, `scripts/demo-first-wave.sh`, `scripts/demo-rbac.sh` | role names and RBAC assertions; new RBAC script |
