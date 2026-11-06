# Platform admin API guide

For the people building the admin area in pbl-web. Design: [ADR-0022](../decisions/0022-platform-admin-identity.md) and
[the platform admin design](../specs/2026-11-02-platform-admin-design.md); the endpoint shapes are
[contract 04](../specs/2026-10-28-api-contracts/04-platform-admin.md). This guide says what is **built**, how the
calls of the `feature/web-admin-01` branch map onto it, and what is still missing.

## Conventions

- **Base URL:** the gateway, `/<service>/api/v1/admin/...`. Everything built so far is `platform`:
  `/platform/api/v1/admin/...`.
- **Sign in** with `POST /platform/api/v1/admin/auth/login` (`{ email, password }`). The access token has
  `sub_type = platform_admin` and **no store**; a store user's token is refused on every admin route (403) and an
  admin token on every store route. Refresh at `/admin/auth/refresh`, which accepts only admin refresh tokens.
- **Roles:** `super_admin` and `admin`. Everything is open to both except **creating and editing plans** (`super_admin`).
- **The first admin** is created once per environment with
  `apps/platform/src/scripts/create-platform-admin.ts` (design, "Bootstrap"). There is no seeded admin and no default
  password.
- **Lists** answer `{ data, pagination, counts? }`. `pagination` is
  `{ limit, currentPage, nextPage?, previousPage?, totalRecords, totalPages }`. Query: `page`, `limit` (max 100,
  default 20), `q`, `order` (`ASC`/`DESC`), plus the filters of each endpoint. The branch's `{ items, total, page,
  pageSize }` and `pageSize` do not exist here.
- **Money** is integer VND (`priceMonthly: 599000`). **Storage** is the one decimal, in gigabytes (`storageGb: 0.5`).
- **Times** are ISO 8601 UTC. A subscription ends at the end of a day **in Vietnam** (UTC+7), so `2026-12-01` ends
  at `2026-12-01T16:59:59.000Z`. Request dates (`effectiveFrom`, `periodStart`, ...) are `YYYY-MM-DD`.
- **Errors** are the usual `{ statusCode, errorCode, message }`: 400 for a business rule, 404 for an unknown id,
  422 for a bad body or query.

## Built

| Method and path                                     | Screen                    | Notes                                                                                   |
| --------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| `GET /admin/tenants`                                | 02 Doanh nghiệp           | `q`, `status=active\|trial\|suspended`, `planCode`, `sort=createdAt\|expiresAt\|name`; `counts` for the tabs |
| `GET /admin/tenants/{id}`                           | 03 Chi tiết               | owner, current subscription, lock reason                                                |
| `POST /admin/tenants`                               | 04 Tạo doanh nghiệp       | owner is found by email or created without a password; `planCode` defaults to `free`    |
| `PATCH /admin/tenants/{id}`                         | 05 Sửa doanh nghiệp       | `name`, `subdomain`, `email`, `phone`, `address`                                        |
| `POST /admin/tenants/{id}/suspend`                  | 06 Khóa doanh nghiệp      | `{ reason }`; ends every session of the store                                           |
| `POST /admin/tenants/{id}/reactivate`               | 03 (unlock)               | `{ note? }`                                                                             |
| `GET /admin/plans`, `GET /admin/plans/{id}`         | 09 Gói dịch vụ            | `status=active\|hidden`; `tenantCount`; not paginated                                   |
| `POST /admin/plans`, `PATCH /admin/plans/{id}`      | 10 Cấu hình gói           | `super_admin`; the edit answers `affectedTenantsOverQuota`                              |
| `GET /admin/subscriptions`                          | 11 Thuê bao               | `q`, `planCode`, `status`, `isExpiringSoon`, `tenantId`; `counts`                       |
| `GET /admin/subscriptions/{id}`                     | 12 Chi tiết thuê bao      | current payment and the last 20 history entries                                         |
| `GET /admin/subscriptions/{id}/events`              | 12 (history paging)       |                                                                                         |
| `POST /admin/subscriptions/{id}/payments`           | record payment            | a period that runs past the expiry renews the subscription                              |
| `POST /admin/subscriptions/change-plan/check`       | 13 Gán / Đổi gói          | dry run: usage against the new limits                                                   |
| `POST /admin/subscriptions/change-plan`             | 13                        | refused when over the new limits                                                        |
| `GET /admin/usage`, `GET /admin/usage/{tenantId}`   | 14 Hạn mức                | `warning=normal\|near_limit\|at_limit`; fullest first                                   |
| `GET /admin/accounts`                               | 07 Người dùng             | `q` (name, email, code), `tenantId`, `role` (the five seeded roles or `custom`), `status`; each item lists its `memberships` |
| `GET /admin/accounts/{id}`                          | 08 Chi tiết người dùng    | `code` (`US00021`), `phoneMasked`, memberships with the store code, `activeSessionCount`  |
| `GET /admin/accounts/{id}/sessions`                 | 08 (Phiên đăng nhập)      | one row per live login: `sessionId`, store, `device`, `ip`, `createdAt`, `lastUsedAt`, `expiresAt`; paginated |
| `POST /admin/accounts/{id}/revoke-sessions`         | 08 (Thu hồi tất cả)       | `{ revokedCount }`; the account's tokens stop working at once, in every store            |
| `GET /admin/admins`                                 | 07 (Quản trị viên)        | `q`, `role`, `status`                                                                    |
| `POST /admin/admins`, `PATCH /admin/admins/{id}`    | admin management          | `super_admin`; `A010` email taken, `A011` cannot disable or demote yourself or the last super admin; disabling ends their sessions |
| `GET /admin/settings`, `PATCH /admin/settings`      | 23 Cấu hình hệ thống      | `PATCH` is `super_admin` and takes any subset of `general`, `security`, `email`; 422 for an unknown timezone or locale, `lockoutMaxAttempts` < 3, `auditRetentionMonths` < 12 |

Error codes the screens will want: `tenant.error.subdomain_exists` (T001), `tenant.error.already_suspended` (T006),
`tenant.error.not_suspended` (T007), `tenant.error.owner_account_disabled` (T008), `plan.error.not_active` (P001),
`plan.error.code_exists` (P002), `subscription.error.quota_exceeded` (S010; the message names the key and the numbers),
`subscription.error.same_plan_same_period` (S011), `subscription.error.payment_overlaps` (S012). These keep this
repository's numbering, which differs from contract 04 where an old code was already taken (T001 is the subdomain,
`S001` is a schedule overlap).

## Mapping the `feature/web-admin-01` calls

| Branch call                                         | Use instead                                                                    | What changes                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET /admin/businesses`                             | `GET /admin/tenants`                                                           | `businesses` is `tenants`; the status filter has `trial`, not "pending"       |
| `GET /admin/businesses/{id}`                        | `GET /admin/tenants/{id}`                                                      | `ownerName/ownerEmail` become `owner.name/email`; `taxCode` does not exist    |
| `POST` / `PATCH /admin/businesses`                  | `POST /admin/tenants`, `PATCH /admin/tenants/{id}`                             | no `accessCode` or `taxCode`; the owner is `owner: { name, email }`           |
| `POST /admin/businesses/{id}/lock`                  | `POST /admin/tenants/{id}/suspend`                                             | no `preserveData`: data is always kept; add `.../reactivate` for the unlock   |
| `GET /admin/plans`, `/{id}`, `POST`, `PATCH`        | same paths                                                                     | limits are `quotas: { branches, users, products, storageGb }`, not `maxBranches` ... |
| `GET /admin/subscriptions`, `/{id}`                 | same paths                                                                     | `business` is `tenant: { id, code, name }`; `cycle` is `billingCycle`         |
| `POST /admin/subscriptions/{id}/change-plan`        | `POST /admin/subscriptions/change-plan` (body has `tenantId`) after `.../check` | the plan is chosen by store, not by subscription id                           |
| `GET /admin/limits`                                 | `GET /admin/usage`                                                             | `limits` is `usage`; `alert` is `warning`                                      |
| `GET /admin/users`                                  | `GET /admin/accounts`                                                          | `users` is `accounts`; `organization` is `memberships[].tenantName`; `lastLogin` is `lastLoginAt` |
| `GET /admin/users/{id}`                             | `GET /admin/accounts/{id}`, `.../sessions`                                     | the branch passes a business id here; pass the account id. Activities (`activities`) need the audit log (insight), not built |
| `GET /admin/businesses/{id}/users`                  | `GET /admin/accounts?tenantId={id}`                                            |                                                                               |
| `GET` / `PATCH /admin/settings` (flat)              | same paths, grouped                                                            | `general`, `security` (numbers and booleans, not the `loginLockPolicy` and `resetLinkPolicy` strings), `email` (`senderName`, `senderEmail`); `language` is `defaultLocale`; `emailReplyTo` and `emailFooter` do not exist |

The branch's own pagination type and its `page`/`pageSize` query need the change described under Conventions.

## Not built yet

These are in contract 04 and in the branch, and have no endpoint: the dashboard (`/admin/dashboard`), monitoring,
failed jobs and their retry, the audit log, announcements (insight); integration connections and their detail
(integration); support sessions (platform). The branch's mock data covers
them until their endpoints exist. Other gaps in what is built:

- **No invitation email, on purpose.** An owner created by an admin has no password and cannot sign in. The decision
  is that owners sign up themselves and start on `free`; use create-for-owner only with the email of an existing
  account.
- **Plan limits are enforced** (409 `Q001`, `details: { key, used, limit, planCode }`, `key` is `branches`, `users`,
  `products` or `storageGb`): creating a branch, adding a member, creating a product and storing a file are refused
  when the store's plan has no room. The web turns the details into the upgrade hint. Catalog reports products and
  storage to `/admin/usage` through an event, so those two lag the truth by the event's delivery time.
- **A new admin has no way to set a password but the one the super admin types.** Contract 04 queues a set-password
  email; there is no email flow for admins, so `POST /admin/admins` takes an optional `password` (same policy as the
  bootstrap command: 12 characters or more of letters, digits and `!#$%&*@^`). Without it the admin cannot sign in.
- **Settings are stored and validated, not applied.** The sign-in lockout still uses 5 attempts and 15 minutes
  (contract 04 says so for now); the reset-link and audit-retention values wait for the flows that need them.
- **Accounts have no verified-email state yet**, so `status=pending_verification` matches nothing and
  `isEmailVerified` is not in the detail.
- **No events for admin actions** (`platform.admin.created`, `platform.settings.changed`, `...sessions_revoked`): they
  belong to no store, and the platform-scope audit below comes first.
- **Store `code` is not in the store-facing DTOs** (only the admin ones).
- **Platform-scope audit.** The tenant events reach insight's audit log, per store; plan edits are told to every store
  on the plan. Actions that belong to no store need their own design.
