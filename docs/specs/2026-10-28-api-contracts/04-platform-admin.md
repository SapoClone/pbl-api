# 04 · Platform admin

This section covers every endpoint behind the 23 canonical admin screens (`40:*`), plus the admin screens the design is missing:
- admin login
- platform admin management
- create plan
- record a subscription payment
- integration detail, sync history and webhooks
- the read-only support view and ending a support session

All routes follow [D3](../2026-10-28-screen-api-contracts.md#d3-platform-admin):
- paths are `/<service>/api/v1/admin/...`
- routes are guarded by `@RequirePlatformAdmin()`
- tokens have `sub_type = platform_admin` and no `tid`
- cross-tenant reads go through `AdminRepository`
- platform-wide numbers come from read models in `insight`, fed by events
- every write appends an `AuditLog` row with `scope = platform` (`tenantId` = null, or the target tenant)

Admin roles (`PlatformAdmin.role`) are `super_admin` and `admin`. Only `super_admin` may manage admins, plans and system settings. Everything else is open to both.

**Shared list query.** Unless an endpoint says otherwise, lists accept `page`, `limit`, `q`, `order` and the filters listed under that endpoint, and return `{ data, pagination }`. The design's "20 / trang" (20 per page) is the client default `limit=20`.

## Screen → endpoints

| Screen | Endpoints |
|---|---|
| Admin login *(missing)* | `POST /platform/.../admin/auth/login`, `POST /platform/.../admin/auth/refresh`, `POST /platform/.../admin/auth/logout`, `GET /platform/.../admin/me` |
| 01 Tổng quan 40:3157 | `GET /insight/.../admin/overview`, `GET /insight/.../admin/transactions/daily`, `GET /insight/.../admin/system-health`, `GET /insight/.../admin/watchlist` |
| 02 Doanh nghiệp 40:3318 | `GET /platform/.../admin/tenants` |
| 03 Chi tiết doanh nghiệp 40:3495 | `GET /platform/.../admin/tenants/{id}`; tabs: `GET …/admin/subscriptions?tenantId=`, `GET …/admin/usage/{tenantId}`, `GET /insight/.../admin/audit-logs?tenantId=` |
| 04 Tạo doanh nghiệp 40:3632 | `POST /platform/.../admin/tenants`, `GET /platform/.../admin/plans` |
| 05 Sửa doanh nghiệp 40:3754 | `PATCH /platform/.../admin/tenants/{id}` |
| 06 Khóa doanh nghiệp 40:3871 | `POST …/admin/tenants/{id}/suspend`, `POST …/admin/tenants/{id}/reactivate` |
| 07 Người dùng 40:3973 | `GET /platform/.../admin/accounts`, `GET /platform/.../admin/admins` (tab "Quản trị viên nền tảng") |
| 08 Chi tiết người dùng 40:4125 | `GET …/admin/accounts/{id}`, `GET …/admin/accounts/{id}/sessions`, `POST …/admin/accounts/{id}/revoke-sessions`, `GET /insight/.../admin/audit-logs?actorId=` |
| Platform admin management *(missing)* | `POST …/admin/admins`, `PATCH …/admin/admins/{id}` |
| 09 Gói dịch vụ 40:4349 | `GET /platform/.../admin/plans` |
| 10 Cấu hình gói 40:4481, Create plan *(missing)* | `GET/PATCH …/admin/plans/{id}`, `POST …/admin/plans` |
| 11 Thuê bao 40:4599 | `GET /platform/.../admin/subscriptions` |
| 12 Chi tiết thuê bao 40:4751 | `GET …/admin/subscriptions/{id}` (includes the current payment and history) |
| Record payment *(missing)* | `POST …/admin/subscriptions/{id}/payments` |
| 13 Gán / Đổi gói 40:4879 | `POST …/admin/subscriptions/change-plan/check`, `POST …/admin/subscriptions/change-plan` |
| 14 Hạn mức 40:5000 | `GET /platform/.../admin/usage`, `GET …/admin/usage/{tenantId}` |
| 15 Giám sát 40:5158 | `GET /insight/.../admin/system-health`, `GET /insight/.../admin/system-errors` |
| 16 Tích hợp 40:5301, detail *(missing)* | `GET /integration/.../admin/connections`, `GET …/admin/connections/{id}`, `GET …/admin/sync-history`, `GET …/admin/webhook-events` |
| 17 Job lỗi 40:5446 | `GET /insight/.../admin/failed-jobs` |
| 18 Chi tiết job 40:5585 | `GET /insight/.../admin/failed-jobs/{id}`, `POST /insight/.../admin/failed-jobs/{id}/retry` |
| 19 Nhật ký hoạt động 40:5716 | `GET /insight/.../admin/audit-logs` |
| 20 Thông báo 40:5865 | `GET /insight/.../admin/announcements` |
| 21 Soạn thông báo 40:6001 | `POST …/admin/announcements`, `PATCH …/admin/announcements/{id}`, `POST …/admin/announcements/{id}/send`, `POST …/admin/announcements/audience-preview` |
| 22 Hỗ trợ kỹ thuật 40:6117, support view *(missing)* | `POST /platform/.../admin/support-sessions`, `GET …/admin/support-sessions`, `POST …/admin/support-sessions/{id}/end` |
| 23 Cấu hình hệ thống 40:6241 | `GET /platform/.../admin/settings`, `PATCH /platform/.../admin/settings` |

`…` stands for `/api/v1`. Headings below give full gateway paths.

---

## Auth (platform)

### POST /platform/api/v1/admin/auth/login
- **Status:** new
- **Screens:** Admin login *(missing)*
- **Auth:** public
- **Body:** `{ "email": "lananh@omniretail.vn", "password": "••••••••" }`
- **Response:** 200
  ```json
  { "accessToken": "eyJ…", "refreshToken": "rt_…", "tokenExpires": 1793300000000,
    "admin": { "id": "uuid", "name": "Lan Anh", "email": "lananh@omniretail.vn", "role": "super_admin" } }
  ```
  The access token carries `sub_type = platform_admin` and no `tid`. The refresh token is a `RefreshToken` row with `subject_type = platform_admin`.
- **Errors:**
  - 400 `A001` wrong email or password
  - 400 `A002` admin disabled
  - 400 `A003` locked after 5 failed attempts in 15 minutes (`PlatformSetting lockout_*`)
- **Events:** `platform.admin.logged_in` → insight audit

### POST /platform/api/v1/admin/auth/refresh
- **Status:** new. It reuses `RefreshTokenService`, but a refresh token whose subject is a platform admin is only accepted on this path.
- **Screens:** all admin screens
- **Auth:** public
- **Body:** `{ "refreshToken": "rt_…" }`
- **Response:** 200, same shape as login, without `admin`
- **Errors:** 401 on an invalid, revoked or reused token (the whole family is revoked)
- **Events:** none

### POST /platform/api/v1/admin/auth/logout
- **Status:** new
- **Screens:** sidebar "Đăng xuất"
- **Auth:** platform_admin
- **Body:** none
- **Response:** 204
- **Errors:** none
- **Events:** none (the `sid` goes on the deny-list)

### GET /platform/api/v1/admin/me
- **Status:** new
- **Screens:** top bar "LA Lan Anh / Quản trị viên nền tảng"
- **Auth:** platform_admin
- **Response:** 200 `{ "id": "uuid", "name": "Lan Anh", "email": "lananh@omniretail.vn", "role": "super_admin", "environment": "production" }`. `environment` drives the "Production" badge and comes from config.
- **Errors:** none
- **Events:** none

## Overview (insight)

### GET /insight/api/v1/admin/overview
- **Status:** new
- **Screens:** 01 Tổng quan (KPI cards)
- **Auth:** platform_admin
- **Query:** `from=2026-10-01&to=2026-10-23`
- **Response:** 200
  ```json
  { "tenants": { "active": 86, "total": 100, "newInRange": 8 },
    "subscriptionsExpiringIn7Days": 12,
    "transactionsToday": { "count": 12840, "changePct": 14.2 },
    "failedJobs": { "open": 8, "overRetryLimit": 3 } }
  ```
- **Errors:** 422 when `from > to`
- **Events (read model):**
  - `platform.tenant.created`, `.status_changed` → `PlatformTenantStats`
  - `platform.subscription.changed` → expiring count
  - `sales.order.completed` → `PlatformDailyTransactions`
  - `integration.sync_job.failed` / `.resolved` and `insight.email.failed` → `FailedJobView`

### GET /insight/api/v1/admin/transactions/daily
- **Status:** new
- **Screens:** 01 chart "Giao dịch toàn nền tảng"
- **Auth:** platform_admin
- **Query:** `from=2026-10-17&to=2026-10-23` (the "7 ngày" preset is computed by the client)
- **Response:** 200 `{ "data": [ { "date": "2026-10-17", "orderCount": 9120, "revenue": 1830000000 } ] }` (not paginated, at most 92 days)
- **Errors:** 422 if the range is over 92 days
- **Events:** `sales.order.completed` (all tenants) → `PlatformDailyTransactions(date, order_count, revenue)`

### GET /insight/api/v1/admin/watchlist
- **Status:** new
- **Screens:** 01 "Cần theo dõi"
- **Auth:** platform_admin
- **Query:** `limit=5`
- **Response:** 200
  ```json
  { "data": [
    { "kind": "subscription_expiring", "tenantId": "uuid", "tenantName": "Mộc Store", "message": "Gói Pro hết hạn ngày 25/10/2026", "severity": "warning", "link": { "type": "subscription", "id": "uuid" } },
    { "kind": "quota_near_limit", "tenantName": "Nhà Gốm An Nhiên", "message": "Sử dụng 98% dung lượng lưu trữ", "severity": "warning", "link": { "type": "usage", "id": "uuid" } },
    { "kind": "failed_jobs", "tenantName": "Shopee · Đồng bộ tồn kho", "message": "3 job lỗi cùng mã E_RATE_LIMIT", "severity": "error", "link": { "type": "failed_jobs", "id": null } } ] }
  ```
- **Errors:** none
- **Events:** the same read models as `/admin/overview`, plus `platform.usage.updated`

## Tenants (platform)

### GET /platform/api/v1/admin/tenants
- **Status:** new
- **Screens:** 02 Doanh nghiệp
- **Auth:** platform_admin
- **Query:**
  - `q` searches name, code, subdomain and owner email
  - `status=active|trial|suspended`
  - `planCode=free|basic|pro`
  - `sort=createdAt|expiresAt|name`
- **Response:** 200
  ```json
  { "data": [ {
      "id": "uuid", "code": "TN0001", "name": "Mộc Store", "subdomain": "mocstore",
      "owner": { "accountId": "uuid", "name": "Minh Anh", "email": "minhanh@mocstore.vn" },
      "status": "active", "plan": { "code": "pro", "name": "Pro" },
      "expiresAt": "2026-10-25T16:59:59.000Z",
      "branches": { "used": 2, "limit": 5 } } ],
    "pagination": { "limit": 20, "currentPage": 1, "nextPage": 2, "totalRecords": 100, "totalPages": 5 },
    "counts": { "all": 100, "active": 86, "trial": 8, "suspended": 6 } }
  ```
  `counts` feeds the tab labels, ignoring `status`.
- **Errors:** none
- **Events:** none

### GET /platform/api/v1/admin/tenants/{id}
- **Status:** new
- **Screens:** 03 Chi tiết (tab "Thông tin chung"), 05 (prefill)
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "id": "uuid", "code": "TN0001", "name": "Mộc Store", "subdomain": "mocstore",
    "address": "24 Hoa Mai, Phường Cầu Kiệu, TP. Hồ Chí Minh", "email": "contact@mocstore.vn", "phone": "0901234567",
    "status": "active", "suspendedReason": null, "suspendedAt": null, "createdAt": "2026-07-25T02:15:00.000Z",
    "owner": { "accountId": "uuid", "name": "Minh Anh", "email": "minhanh@mocstore.vn", "phoneMasked": "090 •••• •• 28", "isEmailVerified": true },
    "currentSubscription": { "id": "uuid", "code": "SUB-0001", "plan": { "code": "pro", "name": "Pro" }, "billingCycle": "monthly",
      "priceMonthly": 599000, "startedAt": "2026-09-25T00:00:00.000Z", "expiresAt": "2026-10-25T16:59:59.000Z",
      "status": "active", "isExpiringSoon": true, "daysLeft": 2 } }
  ```
- **Errors:** 404
- **Events:** none

### POST /platform/api/v1/admin/tenants
- **Status:** new. Unlike the self-serve `POST /tenants`, the admin is not the owner.
- **Screens:** 04 Tạo doanh nghiệp
- **Auth:** platform_admin
- **Body:**
  ```json
  { "name": "Mộc Store", "subdomain": "mocstore", "email": "contact@mocstore.vn", "phone": "0901234567",
    "address": "24 Hoa Mai, TP. Hồ Chí Minh", "defaultBranchName": "Chi nhánh chính",
    "owner": { "name": "Minh Anh", "email": "owner@mocstore.vn" }, "planCode": "free" }
  ```
- **Response:** 201, the tenant detail shape. Side effects:
  - creates the owner account with no password, or links an existing account with that email
  - creates the default branch
  - starts the subscription (`trialing` or `active`)
  - queues a set-password email (SQS, template `owner-invite`)
- **Errors:**
  - 400 `T002` subdomain taken
  - 400 `T005` owner email belongs to a disabled account
  - 400 `P001` plan not active
- **Events:** `platform.tenant.created`, `platform.subscription.changed`, `platform.branch.created`, `platform.membership.granted`

### PATCH /platform/api/v1/admin/tenants/{id}
- **Status:** new
- **Screens:** 05 Sửa doanh nghiệp
- **Auth:** platform_admin
- **Body:** any of `name`, `subdomain`, `email`, `phone`, `address`. `code`, owner and status are not editable here.
- **Response:** 200, tenant detail
- **Errors:** 404; 400 `T002` subdomain taken
- **Events:** `platform.tenant.updated` (audit records the before and after values)

### POST /platform/api/v1/admin/tenants/{id}/suspend
- **Status:** new
- **Screens:** 06 Khóa doanh nghiệp
- **Auth:** platform_admin
- **Body:** `{ "reason": "Vi phạm điều khoản thanh toán" }` (reason required, 1–500 characters)
- **Response:** 200, tenant detail with `status: "suspended"`
- **Effect:** the tenant's sessions are revoked, so its users can no longer log in or switch to it (membership already excludes suspended tenants). Data is kept.
- **Errors:** 404; 400 `T006` already suspended
- **Events:** `platform.tenant.status_changed` `{ tenantId, from: "active", to: "suspended", reason, changedBy }`

### POST /platform/api/v1/admin/tenants/{id}/reactivate
- **Status:** new
- **Screens:** 03 (button shown when the tenant is locked)
- **Auth:** platform_admin
- **Body:** `{ "note": "Đã thanh toán" }` (optional)
- **Response:** 200, tenant detail. Status goes back to `active`, or to `trial` if the subscription is `trialing`.
- **Errors:** 404; 400 `T007` not suspended
- **Events:** `platform.tenant.status_changed`

## Accounts and admins (platform)

### GET /platform/api/v1/admin/accounts
- **Status:** new
- **Screens:** 07 Người dùng (tabs "Tất cả người dùng" / "Người dùng doanh nghiệp")
- **Auth:** platform_admin
- **Query:**
  - `q` searches name and email
  - `tenantId`
  - `role=owner|branch_manager|sales_staff|warehouse_staff|accountant|custom`
  - `status=active|pending_verification|disabled`
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "code": "US00021", "name": "Minh Anh", "email": "minhanh@mocstore.vn",
      "memberships": [ { "tenantId": "uuid", "tenantName": "Mộc Store", "role": "owner" } ],
      "status": "active", "lastLoginAt": "2026-10-23T01:32:00.000Z" } ],
    "pagination": { "…": "…" } }
  ```
  - `status` is derived: `pending_verification` when `emailVerifiedAt` is null.
  - The "Tất cả" tab merges this list with `/admin/admins` on the client.
- **Errors:** none
- **Events:** none

### GET /platform/api/v1/admin/accounts/{id}
- **Status:** new
- **Screens:** 08 Chi tiết người dùng (tab "Hồ sơ")
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "id": "uuid", "code": "US00021", "name": "Minh Anh", "email": "minhanh@mocstore.vn", "phoneMasked": "090 •••• •• 28",
    "memberships": [ { "tenantId": "uuid", "tenantCode": "TN0001", "tenantName": "Mộc Store", "role": "owner" } ],
    "status": "active", "isEmailVerified": true, "createdAt": "2026-07-25T02:15:00.000Z",
    "lastLoginAt": "2026-10-23T01:32:00.000Z", "activeSessionCount": 3 }
  ```
- **Errors:** 404
- **Events:** none

### GET /platform/api/v1/admin/accounts/{id}/sessions
- **Status:** new
- **Screens:** 08 (tab "Phiên đăng nhập")
- **Auth:** platform_admin
- **Response:** 200 `{ "data": [ { "sessionId": "uuid", "tenantName": "Mộc Store", "createdAt": "…", "lastUsedAt": "…", "expiresAt": "…" } ], "pagination": {…} }`. Built from live `RefreshToken` families.
- **Errors:** 404
- **Events:** none

### POST /platform/api/v1/admin/accounts/{id}/revoke-sessions
- **Status:** new
- **Screens:** 08 "Thu hồi tất cả phiên"
- **Auth:** platform_admin
- **Body:** none
- **Response:** 200 `{ "revokedCount": 3 }`. Every refresh-token family is revoked and every `sid` goes on the deny-list.
- **Errors:** 404
- **Events:** `platform.account.sessions_revoked` → audit

### GET /platform/api/v1/admin/admins
- **Status:** new
- **Screens:** 07 (tab "Quản trị viên nền tảng"), Admin management *(missing)*
- **Auth:** platform_admin
- **Response:** 200 `{ "data": [ { "id": "uuid", "name": "Lan Anh", "email": "lananh@omniretail.vn", "role": "super_admin", "status": "active", "lastLoginAt": "…" } ], "pagination": {…} }`
- **Errors:** none
- **Events:** none

### POST /platform/api/v1/admin/admins
- **Status:** new
- **Screens:** Admin management *(missing)*
- **Auth:** platform_admin, role `super_admin`
- **Body:** `{ "name": "Quốc Minh", "email": "minh@omniretail.vn", "role": "admin" }`
- **Response:** 201, the admin row. A set-password email is queued.
- **Errors:** 400 `A010` email taken; 403 if the caller is not `super_admin`
- **Events:** `platform.admin.created`

### PATCH /platform/api/v1/admin/admins/{id}
- **Status:** new
- **Screens:** Admin management *(missing)*
- **Auth:** platform_admin, role `super_admin`
- **Body:** `{ "role": "admin", "status": "disabled" }`. Disabling also revokes that admin's sessions.
- **Response:** 200
- **Errors:** 404; 400 `A011` cannot disable or demote yourself, or the last `super_admin`
- **Events:** `platform.admin.updated`

## Plans (platform)

### GET /platform/api/v1/admin/plans
- **Status:** new
- **Screens:** 09 Gói dịch vụ, 04 (plan select), 13 (plan select)
- **Auth:** platform_admin
- **Query:** `status=active|hidden`
- **Response:** 200 (not paginated)
  ```json
  { "data": [ { "id": "uuid", "code": "pro", "name": "Pro", "description": "Dành cho chuỗi cửa hàng",
      "priceMonthly": 599000, "status": "active", "isFeatured": true,
      "quotas": { "branches": 5, "users": 30, "products": 10000, "storageGb": 50 },
      "tenantCount": 31 } ] }
  ```
  The three plans have `tenantCount` 18, 51 and 31, totalling 100.
- **Errors:** none
- **Events:** none

### GET /platform/api/v1/admin/plans/{id}
- **Status:** new
- **Screens:** 10 Cấu hình gói (prefill)
- **Auth:** platform_admin
- **Response:** 200, the same item shape
- **Errors:** 404
- **Events:** none

### POST /platform/api/v1/admin/plans
- **Status:** new
- **Screens:** Create plan *(missing; reuses the 10 form)*
- **Auth:** platform_admin, role `super_admin`
- **Body:** `{ "code": "enterprise", "name": "Enterprise", "description": "…", "priceMonthly": 1499000, "status": "hidden", "isFeatured": false, "quotas": { "branches": 20, "users": 100, "products": 50000, "storageGb": 200 } }`
- **Response:** 201, the plan
- **Errors:** 400 `P002` code taken; 422 for a negative quota
- **Events:** `platform.plan.changed`

### PATCH /platform/api/v1/admin/plans/{id}
- **Status:** new
- **Screens:** 10 Cấu hình gói ("Lưu gói dịch vụ")
- **Auth:** platform_admin, role `super_admin`
- **Body:** any of `name`, `priceMonthly`, `status`, `isFeatured`, `description`, `quotas.*`. `code` cannot change.
- **Response:** 200, the plan, plus `affectedTenantsOverQuota: 2`, the number of tenants whose current usage exceeds the new quotas. This backs the note "Xem lại các thuê bao đang áp dụng…" (review the active subscriptions…). The change is still saved.
- **Errors:** 404
- **Events:** `platform.plan.changed`

## Subscriptions (platform)

### GET /platform/api/v1/admin/subscriptions
- **Status:** new
- **Screens:** 11 Thuê bao, 03 (tab "Thuê bao", `tenantId=`)
- **Auth:** platform_admin
- **Query:**
  - `q` searches tenant name and subscription code
  - `planCode`
  - `status=trialing|active|past_due|expired|cancelled`
  - `isExpiringSoon=true`
  - `tenantId`
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "code": "SUB-0001", "tenant": { "id": "uuid", "code": "TN0001", "name": "Mộc Store" },
      "plan": { "code": "pro", "name": "Pro" }, "billingCycle": "monthly",
      "startedAt": "2026-09-25T00:00:00.000Z", "expiresAt": "2026-10-25T16:59:59.000Z",
      "paymentStatus": "paid", "status": "active", "isExpiringSoon": true } ],
    "pagination": { "limit": 20, "currentPage": 1, "nextPage": 2, "totalRecords": 100, "totalPages": 5 },
    "counts": { "all": 100, "expiringSoon": 12, "expired": 4, "pastDue": 3 } }
  ```
  `paymentStatus` is the status of the payment for the current period: `paid`, `pending` or `failed`.
- **Errors:** none
- **Events:** none

### GET /platform/api/v1/admin/subscriptions/{id}
- **Status:** new
- **Screens:** 12 Chi tiết thuê bao
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "id": "uuid", "code": "SUB-0001", "tenant": { "id": "uuid", "code": "TN0001", "name": "Mộc Store" },
    "plan": { "code": "pro", "name": "Pro", "priceMonthly": 599000 }, "billingCycle": "monthly",
    "startedAt": "2026-09-25T00:00:00.000Z", "expiresAt": "2026-10-25T16:59:59.000Z", "status": "active", "isExpiringSoon": true,
    "currentPayment": { "id": "uuid", "code": "PAY-00981", "amount": 599000, "status": "paid", "paidAt": "2026-09-25T02:32:00.000Z" },
    "history": [
      { "createdAt": "2026-09-25T02:32:00.000Z", "eventType": "renewed", "planCode": "pro", "effectiveUntil": "2026-10-25", "actor": { "type": "account", "name": "Minh Anh" } },
      { "createdAt": "2026-08-25T03:10:00.000Z", "eventType": "upgraded", "planCode": "pro", "effectiveUntil": "2026-09-25", "actor": { "type": "platform_admin", "name": "Lan Anh" } },
      { "createdAt": "2026-07-25T01:45:00.000Z", "eventType": "created", "planCode": "basic", "effectiveUntil": "2026-08-25", "actor": { "type": "system", "name": "Hệ thống" } } ] }
  ```
  `history` holds at most 20 entries, newest first. A longer history is paged with `GET …/subscriptions/{id}/events?page=`.
- **Errors:** 404
- **Events:** none

### GET /platform/api/v1/admin/subscriptions/{id}/events
- **Status:** new
- **Screens:** 12 (history pagination)
- **Auth:** platform_admin
- **Response:** 200 `{ data: [history item], pagination }`
- **Errors:** 404
- **Events:** none

### POST /platform/api/v1/admin/subscriptions/{id}/payments
- **Status:** new. Payments are recorded by hand ([D6](../2026-10-28-screen-api-contracts.md#d6-gaps-the-erd-still-does-not-model-on-purpose)).
- **Screens:** Record payment *(missing)*
- **Auth:** platform_admin
- **Body:** `{ "amount": 599000, "method": "transfer", "periodStart": "2026-10-25", "periodEnd": "2026-11-25", "paidAt": "2026-10-24T03:00:00.000Z", "note": "CK Vietcombank" }`
- **Response:** 201 `{ "id": "uuid", "code": "PAY-01002", "status": "paid", … }`. When the period extends `expiresAt`, the subscription is renewed and a `renewed` event is written.
- **Errors:** 404; 400 `S003` overlaps a period already paid
- **Events:** `platform.subscription.changed` `{ eventType: "renewed" }`

### POST /platform/api/v1/admin/subscriptions/change-plan/check
- **Status:** new. A dry run with no writes.
- **Screens:** 13 Gán / Đổi gói ("Kiểm tra lại hạn mức", the quota panel)
- **Auth:** platform_admin
- **Body:** `{ "tenantId": "uuid", "planCode": "basic", "effectiveFrom": "2026-10-25", "expiresAt": "2026-11-25" }`
- **Response:** 200
  ```json
  { "allowed": false,
    "quotas": [
      { "key": "branches", "used": 2, "limit": 2, "ok": true },
      { "key": "users", "used": 12, "limit": 10, "ok": false },
      { "key": "products", "used": 1250, "limit": 2000, "ok": true },
      { "key": "storageGb", "used": 4.2, "limit": 10, "ok": true } ],
    "blockingReason": "Doanh nghiệp đang sử dụng 12 / 10 người dùng của gói Basic." }
  ```
  `storageGb` is the one decimal field, because it is a size, not money.
- **Errors:** 404 tenant; 400 `P001` plan not active; 422 when `expiresAt` is not after `effectiveFrom`
- **Events:** none

### POST /platform/api/v1/admin/subscriptions/change-plan
- **Status:** new
- **Screens:** 13 (confirm, enabled only when the check returns `allowed`)
- **Auth:** platform_admin
- **Body:** the check body plus `"note": "Hạ cấp theo yêu cầu của doanh nghiệp"`
- **Response:** 200, subscription detail
- **Errors:** 400 `S001` quota exceeded for the new plan (`details` lists the failing keys, as in the check); 400 `S002` same plan and same period
- **Events:** `platform.subscription.changed` `{ subscriptionId, tenantId, eventType: "downgraded"|"upgraded"|"renewed", fromPlan, toPlan, expiresAt, actor }`

## Usage (platform)

### GET /platform/api/v1/admin/usage
- **Status:** new
- **Screens:** 14 Hạn mức sử dụng
- **Auth:** platform_admin
- **Query:** `q` (tenant name), `planCode`, `warning=normal|near_limit|at_limit` ("Gần hạn mức" is near the limit)
- **Response:** 200
  ```json
  { "data": [ { "tenant": { "id": "uuid", "code": "TN0004", "name": "Mây Boutique" }, "plan": { "code": "free" },
      "branches": { "used": 1, "limit": 1 }, "users": { "used": 3, "limit": 3 },
      "products": { "used": 100, "limit": 100 }, "storageGb": { "used": 0.8, "limit": 1 },
      "warning": "at_limit" } ],
    "pagination": { "limit": 20, "currentPage": 1, "totalRecords": 100, "totalPages": 5 } }
  ```
  - `warning` is `at_limit` when any key is at 100%, `near_limit` when any key is at or above 90%, otherwise `normal`.
  - The data comes from `TenantUsage`. Platform owns the branch and user counts. Products and storage come from the events `catalog.product.count_changed` and `catalog.storage.usage_changed`.
- **Errors:** none
- **Events consumed by platform:** `catalog.product.count_changed`, `catalog.storage.usage_changed`

### GET /platform/api/v1/admin/usage/{tenantId}
- **Status:** new
- **Screens:** 14 detail panel "Mây Boutique · Chi tiết sử dụng", 03 tab "Hạn mức"
- **Auth:** platform_admin
- **Response:** 200, one item of the list shape, plus `"enforcement": "Các thao tác thêm mới sẽ bị chặn khi đạt hạn mức"` (copy only; the real rule is in each service)
- **Errors:** 404
- **Events:** none

## System health (insight)

### GET /insight/api/v1/admin/system-health
- **Status:** new. It is a proxy over the observability backend ([D6](../2026-10-28-screen-api-contracts.md#d6-gaps-the-erd-still-does-not-model-on-purpose)), plus each service's `/health/ready`.
- **Screens:** 15 Giám sát hệ thống, 01 "Tình trạng dịch vụ"
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "updatedAt": "2026-10-23T02:00:12.000Z",
    "kpis": { "apiP95Ms": 142, "error5xxRatePct": 0.28, "concurrentUsers": 642, "queueDepth": 28, "queueFailed": 8 },
    "services": [
      { "key": "api_gateway", "name": "API Gateway", "status": "healthy", "detail": "142 ms · p95", "updatedAt": "…" },
      { "key": "postgres", "name": "PostgreSQL", "status": "healthy", "detail": "42 / 100 kết nối", "updatedAt": "…" },
      { "key": "redis", "name": "Redis", "status": "healthy", "detail": "128 MB / 512 MB", "updatedAt": "…" },
      { "key": "integration_worker", "name": "Integration Worker", "status": "warning", "detail": "8 job lỗi", "updatedAt": "…" },
      { "key": "webhook", "name": "Webhook", "status": "healthy", "detail": "98,7% thành công", "updatedAt": "…" } ] }
  ```
  - `status` is `healthy` [Ổn định], `warning` [Cảnh báo] or `down`.
  - Responses are cached for 30 seconds.
- **Errors:** 503 when the metrics source is unreachable (the service still answers, with `status: "unknown"` for each entry)
- **Events:** none

### GET /insight/api/v1/admin/system-errors
- **Status:** new
- **Screens:** 15 "Lỗi hệ thống gần nhất"
- **Auth:** platform_admin
- **Query:** `limit=5`
- **Response:** 200 `{ "data": [ { "occurredAt": "2026-10-23T01:57:32.000Z", "source": "Webhook Shopee", "errorCode": "E_RATE_LIMIT", "message": "Giới hạn số yêu cầu từ nhà cung cấp", "failedJobId": "uuid" } ] }`
- **Errors:** none
- **Events:** `FailedJobView` (below)

## Integrations (integration)

### GET /integration/api/v1/admin/connections
- **Status:** new
- **Screens:** 16 Tích hợp (tab "Kết nối")
- **Auth:** platform_admin
- **Query:**
  - `q` searches tenant name and shop name
  - `provider=shopee|lazada|tiktok_shop|website`
  - `status=connected|reauth_required|disconnected|error|draft`
  - `environment=sandbox|production`
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "tenant": { "id": "uuid", "name": "Mộc Store" }, "displayName": "mocstore-sandbox",
      "provider": "shopee", "environment": "sandbox", "environmentLabel": "Official Sandbox",
      "status": "connected", "lastSyncAt": "2026-10-23T01:56:00.000Z" } ],
    "pagination": { "…": "…" } }
  ```
  - The tenant name is copied from `platform.tenant.*` events into a `TenantProjection`; no join.
  - `environmentLabel` is the provider's own name for the environment ("Official Sandbox", "Development Shop").
- **Errors:** none
- **Events consumed:** `platform.tenant.created`, `.updated` → `TenantProjection`

### GET /integration/api/v1/admin/connections/{id}
- **Status:** new
- **Screens:** Integration detail *(missing)*
- **Auth:** platform_admin
- **Response:** 200, the list item plus `externalShopId`, `branchId`, `syncProducts`, `syncOrders`, `pushStock`, `syncPrices`, `syncInterval`, `tokenExpiresAt`, `lastError` and `stats: { mappedSkus: 48, totalSkus: 50, jobsToday: 299, jobsFailedToday: 3 }`. Tokens are never returned.
- **Errors:** 404
- **Events:** none

### GET /integration/api/v1/admin/sync-history
- **Status:** new
- **Screens:** 16 (tab "Lịch sử đồng bộ")
- **Auth:** platform_admin
- **Query:** `connectionId`, `tenantId`, `status=succeeded|failed|retrying|running`, `jobType`, `from`, `to`
- **Response:** 200 `{ "data": [ { "id": "uuid", "code": "JOB-00984", "jobType": "stock_push", "status": "failed", "attemptCount": 3, "startedAt": "…", "finishedAt": "…" } ], "pagination": {…} }`
- **Errors:** none
- **Events:** none

### GET /integration/api/v1/admin/webhook-events
- **Status:** new
- **Screens:** 16 (tab "Webhook")
- **Auth:** platform_admin
- **Query:** `provider`, `status=received|processed|failed`, `from`, `to`
- **Response:** 200 `{ "data": [ { "id": "uuid", "provider": "shopee", "eventType": "order.created", "externalEventId": "…", "status": "processed", "errorMessage": null, "receivedAt": "…" } ], "pagination": {…} }`. Read from the integration `InboxEvent`; the raw payload is not returned.
- **Errors:** none
- **Events:** none

## Failed jobs (insight read model across services)

Screen 17 shows one list. Rows come from three sources, each projected into insight's `FailedJobView`:

| Source | Event | `jobType` examples | Retry goes to |
|---|---|---|---|
| integration `SyncJob` | `integration.sync_job.failed`, `.retrying`, `.resolved` | `stock_push`, `order_import`, `product_sync` | `POST /internal/sync-jobs/{id}/retry` (integration) |
| insight `EmailLog` | internal (same service) | `renewal_email`, `verification_email` | the job re-queues the SQS email message |
| event-bus DLQ (every service) | `bus.dead_letter.recorded` (emitted by the relay/consumer when it moves a message to the DLQ) | `event:<type>` | `POST /internal/dlq/{id}/redrive` (owning service; the API form of `scripts/redrive-dlq.js`) |

The job code (`JOB-00984`) is assigned by the source service. Integration and the email jobs have codes in the ERD. DLQ entries use the code `DLQ-<n>`.

### GET /insight/api/v1/admin/failed-jobs
- **Status:** new
- **Screens:** 17 Job lỗi
- **Auth:** platform_admin
- **Query:**
  - `q` searches job code and tenant
  - `state=open|retrying|resolved` (tabs "Cần xử lý" / "Đang thử lại" / "Đã xử lý")
  - `jobType`
  - `provider=shopee|lazada|tiktok_shop|email`
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "code": "JOB-00984", "source": "integration", "jobType": "stock_push", "jobLabel": "Đồng bộ tồn kho → Shopee",
      "tenant": { "id": "uuid", "name": "Mộc Store" }, "errorCode": "E_RATE_LIMIT",
      "attemptCount": 3, "maxAttempts": 3, "lastFailedAt": "2026-10-23T01:57:00.000Z", "state": "open" } ],
    "pagination": { "limit": 20, "currentPage": 1, "totalRecords": 8, "totalPages": 1 },
    "counts": { "open": 8, "retrying": 2, "resolved": 24 } }
  ```
  `counts.open` also feeds the sidebar badge "Job lỗi 8".
- **Errors:** none
- **Events:** see the source table above

### GET /insight/api/v1/admin/failed-jobs/{id}
- **Status:** new
- **Screens:** 18 Chi tiết job
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "id": "uuid", "code": "JOB-00984", "state": "open", "statusLabel": "failed",
    "tenant": { "id": "uuid", "code": "TN0001", "name": "Mộc Store" },
    "provider": "shopee", "environmentLabel": "Official Sandbox", "jobType": "stock_push",
    "reference": "SYNC-STOCK-TN0001-231026", "attemptCount": 3, "maxAttempts": 3, "lastFailedAt": "2026-10-23T01:57:32.000Z",
    "error": { "code": "E_RATE_LIMIT", "message": "Nhà cung cấp giới hạn số yêu cầu.", "remedy": "Đợi cửa sổ giới hạn kết thúc rồi thử lại." },
    "attempts": [
      { "attemptNo": 3, "startedAt": "2026-10-23T01:57:32.000Z", "result": "error", "errorCode": "E_RATE_LIMIT", "durationMs": 420 },
      { "attemptNo": 2, "startedAt": "2026-10-23T01:56:10.000Z", "result": "error", "errorCode": "E_RATE_LIMIT", "durationMs": 398 },
      { "attemptNo": 1, "startedAt": "2026-10-23T01:55:00.000Z", "result": "error", "errorCode": "E_RATE_LIMIT", "durationMs": 416 } ] }
  ```
  - `attempts` come from `SyncJobAttempt`, carried in the failed-event payload. Tokens and secrets are never included ("Không hiển thị token…").
  - `remedy` maps from `error.code` in insight's i18n.
- **Errors:** 404
- **Events:** none

### POST /insight/api/v1/admin/failed-jobs/{id}/retry
- **Status:** new
- **Screens:** 18 "Thử lại tác vụ"
- **Auth:** platform_admin
- **Body:** none
- **Response:** 202 `{ "state": "retrying" }`. Insight calls the source's internal retry command, with the admin's token forwarded as the actor. The view updates when the source emits `.retrying`, then `.resolved` or `.failed`.
- **Errors:** 404; 400 `J001` job already resolved; 400 `J002` retry blocked until `nextRetryAt` (for `E_RATE_LIMIT`; the message includes the time)
- **Events:** the source emits `*.retrying`; the retry is audit-logged

## Audit log (insight)

### GET /insight/api/v1/admin/audit-logs
- **Status:** change. Today `/insight/api/v1/audit-logs` is owner/manager only and tenant-scoped. This admin route reads every tenant plus platform-scope rows.
- **Screens:** 19 Nhật ký hoạt động; 03 (tab "Lịch sử hoạt động", `tenantId=`); 08 (tab "Lịch sử hoạt động", `actorId=`)
- **Auth:** platform_admin
- **Query:**
  - `q` searches action, object and actor name
  - `tenantId` (or `scope=platform` for platform-only rows)
  - `action` ("Tất cả thao tác" is all actions)
  - `actorId`, `from`, `to`
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "occurredAt": "2026-10-23T01:55:00.000Z",
      "actor": { "type": "platform_admin", "id": "uuid", "label": "Lan Anh", "roleLabel": "Quản trị viên" },
      "scope": { "type": "platform", "tenantId": null, "tenantName": null },
      "action": "subscription.plan_changed", "actionLabel": "Đổi gói dịch vụ",
      "object": { "type": "tenant", "id": "uuid", "label": "TN0008" }, "result": "success" } ],
    "pagination": { "…": "…" } }
  ```
  - Rows are read-only: there is no PATCH or DELETE.
  - Retention is at least 12 months (`AuditLog.result`, nullable `tenantId`).
  - System rows have `actor.type = system` and `label = "Hệ thống"`.
- **Errors:** none
- **Events:** every `platform.*` admin event above, `platform.account.logged_in`, `platform.tenant.status_changed`, `platform.subscription.changed`, `platform.support_session.*`, and `insight.announcement.sent`

## Announcements (insight)

### GET /insight/api/v1/admin/announcements
- **Status:** new
- **Screens:** 20 Thông báo hệ thống
- **Auth:** platform_admin
- **Query:** `q` (title), `type=maintenance|update|guide`, `status=draft|scheduled|sent` (tabs "Tất cả" / "Bản nháp" / "Đã gửi")
- **Response:** 200
  ```json
  { "data": [ { "id": "uuid", "title": "Bảo trì hệ thống định kỳ", "summary": "Bảo trì 00:00–00:30 ngày 26/10",
      "audience": { "type": "all", "label": "Toàn bộ doanh nghiệp" }, "type": "maintenance", "status": "draft",
      "scheduledAt": "2026-10-23T01:30:00.000Z", "sentAt": null } ],
    "pagination": { "limit": 20, "currentPage": 1, "totalRecords": 3, "totalPages": 1 } }
  ```
- **Errors:** none
- **Events:** none

### POST /insight/api/v1/admin/announcements
- **Status:** new
- **Screens:** 21 Soạn thông báo ("Lưu bản nháp")
- **Auth:** platform_admin
- **Body:**
  ```json
  { "title": "Bảo trì hệ thống định kỳ", "type": "maintenance",
    "body": "Hệ thống sẽ bảo trì từ 00:00 đến 00:30 ngày 26/10/2026.\nVui lòng hoàn tất các giao dịch trước thời gian bảo trì.\nCảm ơn quý doanh nghiệp đã đồng hành cùng Omniretail.",
    "audience": { "type": "all" }, "scheduledAt": null }
  ```
  `audience.type` is `all`, `plan` (`{ "planCodes": ["pro"] }`), `integration_provider` (`{ "providers": ["shopee"] }`) or `tenants` (`{ "tenantIds": [...] }`).
- **Response:** 201, the announcement with `status: "draft"`
- **Errors:** 422
- **Events:** none

### PATCH /insight/api/v1/admin/announcements/{id}
- **Status:** new
- **Screens:** 20 "Chỉnh sửa", 21
- **Auth:** platform_admin
- **Body:** any field from create
- **Response:** 200
- **Errors:** 404; 400 `N001` already sent (read-only)
- **Events:** none

### POST /insight/api/v1/admin/announcements/audience-preview
- **Status:** new
- **Screens:** 21 "100 doanh nghiệp trong phạm vi nhận" (100 businesses will receive it)
- **Auth:** platform_admin
- **Body:** `{ "audience": { "type": "plan", "planCodes": ["pro"] } }`
- **Response:** 200 `{ "tenantCount": 31 }`. Computed from insight's `TenantProjection`, which holds plan and integration providers, kept up to date from platform and integration events.
- **Errors:** 422
- **Events consumed:** `platform.tenant.*`, `platform.subscription.changed`, `integration.connection.status_changed`

### POST /insight/api/v1/admin/announcements/{id}/send
- **Status:** new
- **Screens:** 21 "Gửi thông báo"
- **Auth:** platform_admin
- **Body:** `{ "scheduledAt": null }` (null sends now)
- **Response:** 200, the announcement with `status: "sent"` or `"scheduled"`. Fan-out writes one `AnnouncementRecipient` per tenant. Tenants read them through the notification bell (section 01).
- **Errors:** 404; 400 `N001` already sent; 400 `N002` the audience resolves to 0 tenants
- **Events:** `insight.announcement.sent` `{ announcementId, tenantCount }`

## Support sessions (platform)

### POST /platform/api/v1/admin/support-sessions
- **Status:** new
- **Screens:** 22 "Bắt đầu phiên chỉ đọc", 03 "Bắt đầu phiên hỗ trợ"
- **Auth:** platform_admin
- **Body:** `{ "tenantId": "uuid", "reason": "Kiểm tra trạng thái đồng bộ đơn Shopee" }`
- **Response:** 201
  ```json
  { "id": "uuid", "code": "SESSION-0031", "tenant": { "id": "uuid", "code": "TN0001", "name": "Mộc Store" },
    "status": "active", "startedAt": "2026-10-23T01:44:00.000Z", "expiresAt": "2026-10-23T02:44:00.000Z",
    "accessToken": "eyJ…" }
  ```
  - The access token lasts 60 minutes and carries `sub_type = platform_admin`, `tid = <tenant>`, `perms = ["*.view"]`, and `act = { sub: <adminId>, ssn: <sessionId> }` (ADR-0004 §3 `act`).
  - Every service rejects non-GET requests made with such a token (403 `AUTH_READ_ONLY`).
  - There is no refresh token for it.
  - The tenant web opens with this token and shows the support banner *(missing screen)*.
- **Errors:** 404 tenant; 400 `SS01` the admin already has an active session for this tenant; 400 `SS02` tenant suspended (only a read-only audit is allowed)
- **Events:** `platform.support_session.started` → audit (tenant-scoped and platform-scoped rows)

### GET /platform/api/v1/admin/support-sessions
- **Status:** new
- **Screens:** 22 "Lịch sử phiên hỗ trợ"
- **Auth:** platform_admin
- **Query:** `tenantId`, `adminId`, `status=active|ended`
- **Response:** 200 `{ "data": [ { "id": "uuid", "code": "SESSION-0031", "tenant": { "name": "Mộc Store" }, "admin": { "name": "Lan Anh" }, "startedAt": "…", "endedAt": "…", "status": "ended" } ], "pagination": { "totalRecords": 2, "…": "…" } }`
- **Errors:** none
- **Events:** none

### POST /platform/api/v1/admin/support-sessions/{id}/end
- **Status:** new
- **Screens:** support view banner "Kết thúc phiên" *(missing)*, 22
- **Auth:** platform_admin. Either the admin token or the session's own token is accepted.
- **Body:** none
- **Response:** 200, the session with `status: "ended"`. Its `sid` goes on the deny-list.
- **Errors:** 404; 400 `SS03` already ended
- **Events:** `platform.support_session.ended`

## System settings (platform)

### GET /platform/api/v1/admin/settings
- **Status:** new
- **Screens:** 23 Cấu hình hệ thống (tabs "Thiết lập chung" / "Xác thực & bảo mật" / "Email & thông báo")
- **Auth:** platform_admin
- **Response:** 200
  ```json
  { "general": { "platformName": "Omniretail", "supportEmail": "support@omniretail.vn", "timezone": "Asia/Ho_Chi_Minh",
      "dateFormat": "dd/mm/yyyy", "currency": "VND", "defaultLocale": "vi" },
    "security": { "lockoutMaxAttempts": 5, "lockoutWindowMinutes": 15, "resetLinkTtlMinutes": 15, "resetLinkSingleUse": true, "auditRetentionMonths": 12 },
    "email": { "senderName": "Omniretail", "senderEmail": "no-reply@omniretail.vn" } }
  ```
- **Errors:** none
- **Events:** none

### PATCH /platform/api/v1/admin/settings
- **Status:** new
- **Screens:** 23 "Lưu cấu hình"
- **Auth:** platform_admin, role `super_admin`
- **Body:** any subset of the GET shape, e.g. `{ "general": { "supportEmail": "help@omniretail.vn" } }`. Each key is stored as one `PlatformSetting` row.
- **Response:** 200, the full settings object
- **Errors:** 422 for an invalid timezone or locale, `auditRetentionMonths < 12`, or `lockoutMaxAttempts < 3`
- **Events:** `platform.settings.changed` (audit stores the before and after values; consumers cache the security values)

---

## Events introduced by this section

| Event | Producer | Consumers |
|---|---|---|
| `platform.admin.logged_in`, `.created`, `.updated` | platform | insight (audit) |
| `platform.tenant.created`, `.updated`, `.status_changed` | platform | insight (stats, audit, `TenantProjection`), integration (`TenantProjection`) |
| `platform.subscription.changed` | platform | insight (stats, watchlist, audience) |
| `platform.plan.changed` | platform | insight (audit) |
| `platform.account.sessions_revoked` | platform | insight (audit) |
| `platform.support_session.started`, `.ended` | platform | insight (audit) |
| `platform.settings.changed` | platform | insight (audit) |
| `platform.usage.updated` | platform | insight (watchlist) |
| `catalog.product.count_changed`, `catalog.storage.usage_changed` | catalog | platform (`TenantUsage`) |
| `integration.sync_job.failed`, `.retrying`, `.resolved` | integration | insight (`FailedJobView`, system errors) |
| `integration.connection.status_changed` | integration | insight (audience) |
| `bus.dead_letter.recorded` | `@pbl/events` (every service) | insight (`FailedJobView`) |
| `sales.order.completed` (existing) | sales | insight: add `PlatformDailyTransactions` |
| `insight.announcement.sent` | insight | none (audit inside insight) |

Insight read models added: `PlatformTenantStats`, `PlatformDailyTransactions`, `FailedJobView` (plus attempts), and `TenantProjection` (plan, status, providers).

## New ADR needed
- **Platform admin identity and admin routes:** a `PlatformAdmin` login with tokens that have no `tid`, the `/admin/*` prefix, `@RequirePlatformAdmin`, `AdminRepository` as the only cross-tenant path, and audit on every admin write. This extends ADR-0004 and ADR-0008.
- **Support-session tokens:** `act` claim, `*.view` only, read-only enforced in `@pbl/auth`, a 60-minute TTL and no refresh. This completes ADR-0004 §3.
- **Cross-service failed-job view:** the `bus.dead_letter.recorded` event, and internal retry and redrive commands. This amends ADR-0007.
- **Observability source** for `system-health`: CloudWatch or OTel, chosen at deploy time (D6).

## Open questions
1. Do platform admins also use the tenant web for support, or does admin get its own read-only viewer? This spec assumes the tenant web with the support token.
2. Does a trial (`trialing`) have a fixed length (for example 14 days), and what happens at the end: does the tenant become `expired`, or move to Free automatically?
3. When a tenant is over quota after a plan edit, is it blocked immediately or given a grace period? The spec only reports the count.
4. Do the product and storage quotas count catalog variants or products, and does storage include images only? This decides the catalog usage events.
5. Can admins schedule announcements for later? The design shows only send-now. `scheduledAt` is included but optional.
