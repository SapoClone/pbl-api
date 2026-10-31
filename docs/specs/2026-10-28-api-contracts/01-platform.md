# 01 · Platform (tenant side) + notifications

Scope: endpoints of service `platform` used by the store (tenant) web and app: login and account recovery, store picker, invitations, my account and sessions, the selected store, branches and branch settings, staff, roles and the permission matrix (D1), staff schedules, and the top-bar context. The notification bell and access history are global chrome served by `insight`; they are at the end in a labelled subsection. Platform-admin routes (`/admin/...`) are in [04-platform-admin.md](04-platform-admin.md). Binding decisions D1–D6: [index](../2026-10-28-screen-api-contracts.md).

All paths are gateway paths. `{p}` = `/platform/api/v1`, `{i}` = `/insight/api/v1`. "Token" means a valid access token; "tenant" means the token must carry `tid`.

## Screen → endpoints

| Screen (Figma node) | Endpoints |
|---|---|
| Đăng nhập (13:3) | `POST {p}/auth/email/login`, `POST {p}/auth/refresh` |
| Register store *(missing screen)* | `POST {p}/auth/email/register`, `GET {p}/auth/verify/email`, `POST {p}/auth/verify/email/resend`, `POST {p}/tenants` |
| Forgot / reset password *(missing)* | `POST {p}/auth/forgot-password`, `POST {p}/auth/verify/forgot-password`, `POST {p}/auth/reset-password` |
| Store picker *(missing)* | `GET {p}/tenants`, `POST {p}/auth/switch-tenant` |
| Accept invitation *(missing)* | `GET {p}/invitations/{token}`, `POST {p}/invitations/{token}/accept` |
| Top bar + sidebar store card (every tenant screen) | `GET {p}/tenants/current/context`, `GET {i}/notifications/unread-count`, `POST {p}/auth/logout` |
| Account profile / security *(missing)* | `GET/PATCH {p}/accounts/me`, `POST {p}/accounts/me/change-password`, `GET {p}/accounts/me/sessions`, `DELETE {p}/accounts/me/sessions/{id}`, `POST {p}/auth/logout-all` |
| Store settings *(missing)* | `GET/PATCH {p}/tenants/current`, `GET/POST {p}/branches`, `GET/PATCH/DELETE {p}/branches/{id}`, `GET/PATCH {p}/branches/{id}/settings` |
| Nhân viên & Phân quyền (13:2646) | `GET {p}/tenants/current/members/summary`, `GET {p}/tenants/current/members`, `GET {p}/roles`, `GET {p}/roles/{id}`, `PATCH {p}/roles/{id}`, `GET {p}/permissions`, `GET {i}/audit-logs` (Lịch sử truy cập) |
| Staff detail / edit *(missing)* | `GET/PATCH/DELETE {p}/tenants/current/members/{accountId}`, `POST …/lock`, `POST …/unlock` |
| Role editor tab *(missing)* | `POST {p}/roles`, `PATCH {p}/roles/{id}`, `DELETE {p}/roles/{id}` |
| Ca làm việc tab *(missing)* | `GET/POST {p}/staff-schedules`, `PATCH/DELETE {p}/staff-schedules/{id}` |
| Mời nhân viên (51:707) | `GET {p}/roles`, `GET {p}/roles/{id}` (matrix preview), `GET {p}/branches`, `POST {p}/tenants/current/invitations` |
| Pending invitations *(part of 13:2646 list)* | `GET {p}/tenants/current/invitations`, `POST …/{id}/resend`, `DELETE …/{id}` |
| Notification centre *(missing)* | `GET {i}/notifications`, `POST {i}/notifications/{id}/read`, `POST {i}/notifications/read-all`, `GET {i}/announcements` |
| Mobile push | `POST {i}/device-tokens`, `DELETE {i}/device-tokens/{token}` |

---

## Auth

### POST /platform/api/v1/auth/email/login
- **Status:** `change`. Accept a phone number as well as an email; add the lockout from the platform settings (5 failures / 15 min by default); add `perms` and `branches` to the token (D1); set `account.lastLoginAt`.
- **Screens:** Đăng nhập 13:3
- **Auth:** public
- **Body:**
  ```json
  { "identifier": "ban@cuahang.vn", "password": "••••••••", "tenantId": null }
  ```
  `identifier` (required): an email or a VN phone number. It replaces `email`; `email` stays accepted for one release. `tenantId` (optional): select a store at login.
- **Response:** 200
  ```json
  { "userId": "…", "accessToken": "…", "refreshToken": "…", "tokenExpires": 1793300000000,
    "tenantId": "…", "tenants": [ { "id": "…", "code": "TN0001", "name": "Mộc Store", "subdomain": "mocstore", "role": "owner", "roleName": "Chủ cửa hàng", "status": "active" } ] }
  ```
  When `tenants` has one entry, the server selects it. When it has several and `tenantId` is null, the client shows the store picker.
- **Errors:**
  - 401: wrong credentials.
  - 400 `E010`: account locked until `lockedUntil` (the message includes the time).
  - 400 `E011`: account disabled.
  - 400 `T010`: the selected store is suspended.
- **Events:** `platform.account.logged_in` (exists)

### POST /platform/api/v1/auth/email/register
- **Status:** `change`. Return 201. `name` becomes required. Fix the "saved but no email" gap with an outbox.
- **Screens:** Register store (missing)
- **Auth:** public
- **Body:**
  ```json
  { "name": "Minh Anh", "email": "minhanh@mocstore.vn", "phone": "0901234567", "password": "••••••••" }
  ```
- **Response:** 201 `{ "userId": "…" }`. The client then logs in, which returns a token without `tid`, and creates the store with `POST /tenants`.
- **Errors:**
  - 400 `E003`: email exists.
  - 400 `E012`: phone exists.
- **Events:** queues the verification email (SQS)

### GET /platform/api/v1/auth/verify/email
- **Status:** `change`. Placeholder today. Implement it: set `account.emailVerifiedAt`.
- **Screens:** Verify email (missing; the email link lands here)
- **Auth:** public
- **Query:** `?token=…`
- **Response:** 200 `{ "verified": true }`
- **Errors:** 400 `E013`: token invalid or expired.

### POST /platform/api/v1/auth/verify/email/resend
- **Status:** `change` (placeholder; implement it, with at most 1 request per 60 s per email)
- **Auth:** public
- **Body:** `{ "email": "minhanh@mocstore.vn" }`
- **Response:** 200 `{ "sent": true }`. It always reports success, so the response doesn't reveal whether an account exists.

### POST /platform/api/v1/auth/forgot-password
- **Status:** `change`. Placeholder today. Implement it with a reset link valid for 15 minutes, single use (from the platform settings), queued to the mail service.
- **Screens:** Forgot password (missing)
- **Auth:** public
- **Body:** `{ "identifier": "minhanh@mocstore.vn" }`
- **Response:** 200 `{ "sent": true }` (always)
- **Events:** SQS email `password-reset` (a new template in pbl-mail-service)

### POST /platform/api/v1/auth/verify/forgot-password
- **Status:** `change` (placeholder). Validates the token before the reset form is shown.
- **Auth:** public
- **Body:** `{ "token": "…" }`
- **Response:** 200 `{ "valid": true, "email": "mi•••@mocstore.vn" }`
- **Errors:** 400 `E014`: token invalid, used or expired.

### POST /platform/api/v1/auth/reset-password
- **Status:** `change` (placeholder). It also revokes every refresh-token family for the account.
- **Auth:** public
- **Body:** `{ "token": "…", "password": "••••••••" }`
- **Response:** 200 `{ "reset": true }`
- **Errors:** 400 `E014`

### POST /platform/api/v1/auth/refresh
- **Status:** `exists`
- **Auth:** public
- **Body:** `{ "refreshToken": "…" }`
- **Response:** 200 `{ "accessToken": "…", "refreshToken": "…", "tokenExpires": 1793300000000 }`

### POST /platform/api/v1/auth/switch-tenant
- **Status:** `exists`. Its tokens must also carry the new `perms` and `branches` claims.
- **Screens:** Store picker (missing); store switcher in the sidebar card
- **Auth:** token
- **Body:** `{ "tenantId": "…" }`
- **Response:** 200, the same shape as login
- **Errors:**
  - 404: not a member.
  - 400 `T010`: store suspended.

### POST /platform/api/v1/auth/logout
- **Status:** `exists` (revokes the current session)
- **Screens:** user menu (top bar)
- **Auth:** token
- **Response:** 200 `{}`. Change it to 204 when the endpoint is next touched.

### POST /platform/api/v1/auth/logout-all
- **Status:** `new`. Revokes every session of the caller (refresh families plus deny-list entries).
- **Screens:** Account security (missing)
- **Auth:** token
- **Response:** 204

## Invitations (public side)

### GET /platform/api/v1/invitations/{token}
- **Status:** `new`
- **Screens:** Accept invitation (missing)
- **Auth:** public
- **Response:** 200
  ```json
  { "storeName": "Mộc Store", "invitedBy": "Minh Anh", "email": "gia.han@example.com", "name": "Đỗ Gia Hân",
    "roleName": "Nhân viên bán hàng", "branches": [ { "id": "…", "name": "Chi nhánh Quận 7" } ],
    "hasAccount": false, "expiresAt": "2026-10-30T07:00:00.000Z" }
  ```
- **Errors:** 404: unknown token. 400 `T020`: expired or revoked.

### POST /platform/api/v1/invitations/{token}/accept
- **Status:** `new`. It creates the account when `hasAccount` is false; otherwise the caller must be signed in with the invited email. Then it creates the `AccountTenant` with the invited role and branches, and marks the invitation `accepted`.
- **Auth:** public, or a token when `hasAccount` is true
- **Body:** `{ "name": "Đỗ Gia Hân", "password": "••••••••" }`. The password is only sent when no account exists.
- **Response:** 200, the login shape, with `tenantId` set to the inviting store
- **Errors:**
  - 400 `T020`: expired or revoked.
  - 400 `T021`: a signed-in email differs from the invitation.
  - 400 `T022`: the store's user quota is reached (Plan quota `max_users`).
- **Events:** `platform.membership.granted`

## My account

### GET /platform/api/v1/accounts/me
- **Status:** `change`. Add `code`, `emailVerifiedAt` and `lastLoginAt`.
- **Screens:** Account profile (missing); top-bar avatar
- **Auth:** token
- **Response:** 200
  ```json
  { "id": "…", "code": "US00021", "email": "minhanh@mocstore.vn", "name": "Minh Anh", "phone": "0901234567",
    "status": "active", "emailVerifiedAt": "2026-07-25T02:15:00.000Z", "lastLoginAt": "2026-10-20T01:32:00.000Z",
    "createdAt": "2026-07-25T02:15:00.000Z" }
  ```

### PATCH /platform/api/v1/accounts/me
- **Status:** `exists`
- **Auth:** token
- **Body:** `{ "name": "Minh Anh", "phone": "0901234567" }` (both optional)
- **Response:** 200, the account object
- **Errors:** 400 `E012`: phone exists.

### POST /platform/api/v1/accounts/me/change-password
- **Status:** `new`. Revokes the caller's other sessions.
- **Auth:** token
- **Body:** `{ "currentPassword": "••••", "newPassword": "••••••••" }`
- **Response:** 204
- **Errors:** 400 `E015`: current password wrong.

### GET /platform/api/v1/accounts/me/sessions
- **Status:** `new`. Lists active refresh-token families.
- **Screens:** Account security (missing)
- **Auth:** token
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "device": "Chrome · Windows", "ip": "14.161.x.x", "lastUsedAt": "2026-10-20T07:28:00.000Z", "isCurrent": true } ] }
  ```

### DELETE /platform/api/v1/accounts/me/sessions/{id}
- **Status:** `new`
- **Auth:** token
- **Response:** 204
- **Errors:** 404

## Store (selected tenant)

### GET /platform/api/v1/tenants
- **Status:** `change`. Add `code`, `roleName` and `status` to each membership.
- **Screens:** Store picker (missing)
- **Auth:** token (no `tid` needed)
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "code": "TN0001", "name": "Mộc Store", "subdomain": "mocstore", "role": "owner", "roleName": "Chủ cửa hàng", "status": "active" } ] }
  ```

### POST /platform/api/v1/tenants
- **Status:** `change`. Return 201; generate `code`; start a Free (or trial) subscription; take the default branch name from the body.
- **Screens:** Register store (missing)
- **Auth:** token (no `tid` needed)
- **Body:**
  ```json
  { "name": "Mộc Store", "subdomain": "mocstore", "phone": "0901234567", "email": "contact@mocstore.vn",
    "address": "24 Hoa Mai, Phường Cầu Kiệu, TP. Hồ Chí Minh", "defaultBranchName": "Chi nhánh Quận 3" }
  ```
  `defaultBranchName` is optional (default "Chi nhánh chính").
- **Response:** 201: `{ "tenant": { …TenantRes }, "accessToken": "…", "refreshToken": "…", "tokenExpires": … }`
- **Errors:** 400 `T001`: subdomain exists.
- **Events:** `platform.tenant.created` (new), `platform.branch.created`

### GET /platform/api/v1/tenants/current
- **Status:** `change`. Add `code` and a `subscription` summary.
- **Screens:** Store settings (missing)
- **Auth:** tenant
- **Response:** 200
  ```json
  { "id": "…", "code": "TN0001", "name": "Mộc Store", "subdomain": "mocstore", "phone": "0901234567",
    "email": "contact@mocstore.vn", "address": "24 Hoa Mai, …", "status": "active", "createdAt": "2026-07-25T02:15:00.000Z",
    "subscription": { "planCode": "pro", "planName": "Pro", "status": "active", "expiresAt": "2026-10-25T00:00:00.000Z", "isExpiringSoon": true } }
  ```

### PATCH /platform/api/v1/tenants/current
- **Status:** `exists` (owner)
- **Auth:** tenant, owner
- **Body:** `{ "name": "Mộc Store", "phone": "…", "email": "…", "address": "…" }` (all optional)
- **Response:** 200, the tenant object
- **Events:** `platform.tenant.updated` (new)

### GET /platform/api/v1/tenants/current/context
- **Status:** `new`. One call that feeds the global chrome, so screens don't need several requests.
- **Screens:** sidebar store card ("Mộc Store · GÓI PRO · 2 chi nhánh"), top bar (branch switcher, user, role) on every tenant screen
- **Auth:** tenant
- **Response:** 200
  ```json
  { "tenant": { "id": "…", "code": "TN0001", "name": "Mộc Store", "status": "active" },
    "plan": { "code": "pro", "name": "Pro", "isExpiringSoon": true, "expiresAt": "2026-10-25T00:00:00.000Z" },
    "branchCount": 2,
    "me": { "accountId": "…", "name": "Minh Anh", "initials": "MA", "roleId": "…", "roleName": "Chủ cửa hàng", "isOwner": true },
    "branches": [ { "id": "…", "name": "Chi nhánh Quận 3", "city": "TP. Hồ Chí Minh", "isWarehouse": false } ],
    "permissions": [ "dashboard.view", "orders.view", "orders.create", "…" ],
    "timezone": "Asia/Ho_Chi_Minh" }
  ```
  `branches` lists only the branches the caller may act in (D2). `permissions` mirrors the token's claim, so the UI can hide actions the caller can't take.

## Branches and branch settings

### GET /platform/api/v1/branches
- **Status:** `change`. Non-owners see only their `branches` (D2). Add the `q` search.
- **Screens:** Store settings (missing); branch selects on 51:707, 51:139, 51:596; top-bar switcher
- **Auth:** tenant
- **Query:** `?status=active&q=quận&page=1&limit=20`
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "name": "Chi nhánh Quận 3", "code": "CN01", "address": "…", "phone": "…", "isWarehouse": false, "status": "active", "createdAt": "…" } ],
    "pagination": { "limit": 20, "currentPage": 1, "totalRecords": 2, "totalPages": 1 } }
  ```

### POST /platform/api/v1/branches
- **Status:** `change`. Return 201; enforce the plan quota `max_branches`.
- **Auth:** tenant, owner
- **Body:** `{ "name": "Chi nhánh Quận 7", "code": "CN02", "address": "…", "phone": "…", "isWarehouse": false }`
- **Response:** 201, the branch object
- **Errors:**
  - 400 `B001`: code exists.
  - 400 `B003`: branch quota reached (the message names the plan limit, e.g. "2/2").
- **Events:** `platform.branch.created` (exists)

### GET /platform/api/v1/branches/{id}
- **Status:** `exists`
- **Auth:** tenant
- **Response:** 200, the branch object
- **Errors:** 404 (also when the branch is outside the caller's scope)

### PATCH /platform/api/v1/branches/{id}
- **Status:** `exists`
- **Auth:** tenant, owner
- **Body:** any of `name`, `address`, `phone`, `isWarehouse`, `status` (`active` | `inactive`)
- **Response:** 200, the branch object
- **Events:** `platform.branch.updated` (exists)

### DELETE /platform/api/v1/branches/{id}
- **Status:** `change`. Return 204.
- **Auth:** tenant, owner
- **Response:** 204
- **Errors:**
  - 400 `B002`: last branch.
  - 400 `B004`: the branch must be inactive first.

### GET /platform/api/v1/branches/{id}/settings
- **Status:** `new` (ERD `BranchSetting`)
- **Screens:** Store settings (missing)
- **Auth:** tenant, owner or branch manager of that branch
- **Response:** 200
  ```json
  { "branchId": "…", "invoicePrefix": "Q3-", "invoiceTemplateCode": "receipt_80mm", "defaultTaxRate": 0,
    "allowedPaymentMethods": [ "cash", "transfer", "card", "e_wallet" ] }
  ```

### PATCH /platform/api/v1/branches/{id}/settings
- **Status:** `new`
- **Auth:** tenant, owner
- **Body:** any field of the GET response except `branchId`. `invoiceTemplateCode` is one of `receipt_80mm` | `receipt_58mm`; `allowedPaymentMethods` uses the D5 enum.
- **Response:** 200, the settings object
- **Events:** `platform.branch_settings.updated` (new; POS reads payment methods from it)

## Staff (store members)

D1 assumption: staff are `Account` + `AccountTenant`, and `AccountTenant` gains `code`, `status`, `roleId` and `branchIds`.

### GET /platform/api/v1/tenants/current/members/summary
- **Status:** `new`
- **Screens:** 13:2646 KPI cards
- **Auth:** `staff.view`
- **Response:** 200
  ```json
  { "total": 12, "active": 11, "locked": 1, "onShift": 4,
    "onShiftByBranch": [ { "branchId": "…", "branchName": "Quận 3", "count": 3 }, { "branchId": "…", "branchName": "Quận 7", "count": 1 } ],
    "defaultRoleCount": 5, "dataScope": "Mộc Store" }
  ```
  `onShift` comes from `StaffSchedule` at the current time in the store's timezone. When POS shifts exist, sales `Shift` may override it (open question).

### GET /platform/api/v1/tenants/current/members
- **Status:** `change`. Add filters, paging and the fields below.
- **Screens:** 13:2646 "Danh sách nhân viên"
- **Auth:** `staff.view`
- **Query:** `?q=huy&roleId=…&branchId=…&status=active&page=1&limit=7`
  - `q` searches name, email and code.
  - `status`: `active` | `locked` | `invited`. Invited members come from invitations.
- **Response:** 200
  ```json
  { "data": [ { "accountId": "…", "code": "NV002", "name": "Lê Quang Huy", "email": "quang.huy@example.com", "phone": "090•••••45",
      "roleId": "…", "roleName": "Quản lý chi nhánh", "isOwner": false,
      "branches": [ { "id": "…", "name": "Quận 3" } ], "status": "active",
      "isOnShift": true, "scheduleLabel": "08:00–16:00", "lastLoginAt": "2026-10-20T01:05:00.000Z", "createdAt": "…" } ],
    "pagination": { "limit": 7, "currentPage": 1, "nextPage": 2, "totalRecords": 12, "totalPages": 2 } }
  ```
  `role` (the old enum) stays in the response for one release.

### GET /platform/api/v1/tenants/current/members/{accountId}
- **Status:** `new`
- **Screens:** Staff detail (missing)
- **Auth:** `staff.view`
- **Response:** 200: the list item plus `schedules: StaffSchedule[]` and `invitedBy`.
- **Errors:** 404

### PATCH /platform/api/v1/tenants/current/members/{accountId}
- **Status:** `change`. Replaces `PATCH …/{accountId} { role }`. Role is now `roleId`; adds `branchIds` and `code`.
- **Screens:** Staff edit (missing)
- **Auth:** `staff.update`
- **Body:** `{ "roleId": "…", "branchIds": ["…", "…"], "code": "NV002" }` (all optional)
- **Response:** 200, the member object
- **Errors:**
  - 400 `T003`: the owner's role can't change.
  - 400 `T023`: a branch is not in the tenant.
  - 400 `T024`: the staff code is already used.
- **Events:** `platform.membership.role_changed` (exists), `platform.membership.branches_changed` (new)

### POST /platform/api/v1/tenants/current/members/{accountId}/lock
- **Status:** `new`. Sets status `locked` and revokes the member's sessions in this store.
- **Screens:** Staff detail (missing); 13:2646 status "Tạm khóa"
- **Auth:** `staff.update`
- **Body:** `{ "reason": "Nghỉ việc tạm thời" }` (optional)
- **Response:** 200, the member object
- **Errors:** 400 `T003`: can't lock the owner.
- **Events:** `platform.membership.locked` (new)

### POST /platform/api/v1/tenants/current/members/{accountId}/unlock
- **Status:** `new`
- **Auth:** `staff.update`
- **Response:** 200, the member object
- **Events:** `platform.membership.unlocked` (new)

### DELETE /platform/api/v1/tenants/current/members/{accountId}
- **Status:** `new`. Removes the membership; the account stays.
- **Auth:** `staff.delete`
- **Response:** 204
- **Errors:** 400 `T003`: can't remove the owner.
- **Events:** `platform.membership.revoked` (new)

### POST /platform/api/v1/tenants/current/members
- **Status:** `change`. Kept to add an *existing* account directly; it takes `roleId` and `branchIds` instead of `role`. The design's flow uses invitations (below).
- **Auth:** `staff.create`
- **Body:** `{ "email": "…", "roleId": "…", "branchIds": ["…"] }`
- **Response:** 201, the member object
- **Errors:**
  - 400 `T002`: already a member.
  - 404: no account with that email.
  - 400 `T022`: user quota reached.

## Invitations (store side)

### POST /platform/api/v1/tenants/current/invitations
- **Status:** `new` (ERD `StaffInvitation`)
- **Screens:** Mời nhân viên 51:707 ("Gửi lời mời"; "Lưu nháp" is client-side only)
- **Auth:** `staff.create`
- **Body:**
  ```json
  { "name": "Nguyễn Văn A", "email": "email@congty.com", "phone": "0901234567", "code": "NV013",
    "roleId": "…", "branchIds": ["…"], "schedule": { "startTime": "08:00", "endTime": "16:00", "weekdays": [1,2,3,4,5,6] },
    "message": "Chào mừng bạn đến Mộc Store" }
  ```
  - Required: `name`, `email`, `roleId`, `branchIds` (at least 1).
  - `code` is optional. When omitted, the server generates the next code (e.g. NV013).
  - `schedule` is optional. On accept it becomes `StaffSchedule` rows.
- **Response:** 201
  ```json
  { "id": "…", "email": "email@congty.com", "name": "Nguyễn Văn A", "roleName": "Nhân viên bán hàng", "status": "pending", "expiresAt": "2026-10-30T07:00:00.000Z", "createdAt": "…" }
  ```
- **Errors:**
  - 400 `T002`: already a member.
  - 400 `T025`: a pending invitation already exists for this email.
  - 400 `T022`: user quota reached.
  - 400 `T023`: a branch is not in the tenant.
- **Events:** SQS email `staff-invitation` (new template, link valid 7 days); `platform.invitation.created` (new)

### GET /platform/api/v1/tenants/current/invitations
- **Status:** `new`
- **Auth:** `staff.view`
- **Query:** `?status=pending&page=1&limit=20` (`status`: `pending` | `accepted` | `expired` | `revoked`)
- **Response:** 200, `{ data: Invitation[], pagination }`

### POST /platform/api/v1/tenants/current/invitations/{id}/resend
- **Status:** `new`. Issues a new token and resets `expiresAt` to 7 days from now.
- **Auth:** `staff.create`
- **Response:** 200, the invitation object
- **Errors:** 400 `T026`: not pending.

### DELETE /platform/api/v1/tenants/current/invitations/{id}
- **Status:** `new` (revoke)
- **Auth:** `staff.delete`
- **Response:** 204

## Roles and permissions (D1)

### GET /platform/api/v1/permissions
- **Status:** `new` (ERD `Permission`, seeded)
- **Screens:** 13:2646 and 51:707 matrix columns and rows
- **Auth:** `staff.view`
- **Response:** 200
  ```json
  { "modules": [ { "code": "dashboard", "label": "Tổng quan" }, { "code": "products", "label": "Sản phẩm" }, { "code": "inventory", "label": "Tồn kho / Phiếu kho" },
      { "code": "orders", "label": "Đơn hàng" }, { "code": "pos", "label": "Bán tại quầy" }, { "code": "channels", "label": "Kênh bán hàng" },
      { "code": "customers", "label": "Khách hàng" }, { "code": "purchasing", "label": "Nhập hàng" }, { "code": "staff", "label": "Nhân viên" }, { "code": "reports", "label": "Báo cáo" } ],
    "actions": [ "view", "create", "update", "delete", "approve" ],
    "permissions": [ { "code": "orders.approve", "module": "orders", "action": "approve", "isApplicable": true } ] }
  ```
  `isApplicable: false` marks combinations that don't exist (e.g. `dashboard.create`). The UI shows "—" for them.

### GET /platform/api/v1/roles
- **Status:** `new`
- **Screens:** 13:2646 role chips and select; 51:707 role select
- **Auth:** `staff.view`
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "name": "Chủ cửa hàng", "key": "owner", "isSeeded": true, "isOwner": true, "memberCount": 1 },
      { "id": "…", "name": "Quản lý chi nhánh", "key": "branch_manager", "isSeeded": true, "isOwner": false, "memberCount": 1 },
      { "id": "…", "name": "Nhân viên bán hàng", "key": "sales_staff", "isSeeded": true, "isOwner": false, "memberCount": 6 },
      { "id": "…", "name": "Nhân viên kho", "key": "warehouse_staff", "isSeeded": true, "isOwner": false, "memberCount": 2 },
      { "id": "…", "name": "Kế toán", "key": "accountant", "isSeeded": true, "isOwner": false, "memberCount": 1 } ] }
  ```
  `key` is null for custom roles.

### GET /platform/api/v1/roles/{id}
- **Status:** `new`
- **Screens:** 13:2646 "Quyền theo vai trò"; 51:707 "xem trước"
- **Auth:** `staff.view`
- **Response:** 200: `{ "id": "…", "name": "Quản lý chi nhánh", "key": "branch_manager", "isSeeded": true, "isOwner": false, "permissions": [ "dashboard.view", "products.view", "products.create", "products.update", "inventory.view", "inventory.create", "inventory.approve", "orders.view", "orders.create", "orders.update", "orders.approve", "customers.view", "customers.create", "customers.update", "purchasing.view", "purchasing.create", "purchasing.approve", "staff.view", "reports.view" ] }`

### POST /platform/api/v1/roles
- **Status:** `new` (custom role, "Tùy chỉnh")
- **Auth:** `staff.create`, owner only
- **Body:** `{ "name": "Thu ngân ca tối", "permissions": [ "pos.view", "pos.create", "orders.view" ] }`
- **Response:** 201, the role object
- **Errors:**
  - 400 `R001`: name exists.
  - 422: unknown permission code.

### PATCH /platform/api/v1/roles/{id}
- **Status:** `new` ("Lưu phân quyền")
- **Auth:** owner only
- **Body:** `{ "name": "…", "permissions": [ … ] }`. `permissions` is the full set, replacing the old one.
- **Response:** 200, the role object
- **Errors:**
  - 400 `R002`: the owner role is locked.
  - 400 `R003`: seeded roles can't be renamed (their permissions can change).
- **Events:** `platform.role.updated` (new). Holders' tokens pick up the change at their next refresh, as roles do today.

### DELETE /platform/api/v1/roles/{id}
- **Status:** `new`
- **Auth:** owner only
- **Response:** 204
- **Errors:**
  - 400 `R004`: seeded role.
  - 400 `R005`: the role still has members.

## Staff schedules ("Ca làm việc")

### GET /platform/api/v1/staff-schedules
- **Status:** `new` (ERD `StaffSchedule`)
- **Screens:** Ca làm việc tab (missing); 13:2646 column "Ca làm việc"
- **Auth:** `staff.view`
- **Query:** `?branchId=…&accountId=…&weekday=1`
- **Response:** 200: `{ "data": [ { "id": "…", "accountId": "…", "staffName": "Trần Bảo Linh", "branchId": "…", "branchName": "Quận 3", "weekday": 1, "startTime": "08:00", "endTime": "16:00" } ] }`

### POST /platform/api/v1/staff-schedules
- **Status:** `new`
- **Auth:** `staff.update`
- **Body:** `{ "accountId": "…", "branchId": "…", "weekdays": [1,2,3,4,5], "startTime": "08:00", "endTime": "16:00" }`. Creates one row per weekday.
- **Response:** 201: `{ "data": [ …StaffSchedule ] }`
- **Errors:**
  - 400 `S001`: overlaps an existing shift for that person.
  - 400 `T023`: the branch is not one of the member's branches.

### PATCH /platform/api/v1/staff-schedules/{id}
- **Status:** `new`
- **Auth:** `staff.update`
- **Body:** `{ "startTime": "14:00", "endTime": "22:00" }`
- **Response:** 200
- **Errors:** 400 `S001`

### DELETE /platform/api/v1/staff-schedules/{id}
- **Status:** `new`
- **Auth:** `staff.update`
- **Response:** 204

---

## insight: global chrome (notification bell, access history)

These routes belong to service `insight`. They live here because every tenant screen uses them.

### GET /insight/api/v1/notifications/unread-count
- **Status:** `new` (ERD `Notification` + `NotificationRecipient`)
- **Screens:** top-bar bell badge "4" (every tenant screen)
- **Auth:** tenant
- **Response:** 200 `{ "count": 4 }`

### GET /insight/api/v1/notifications
- **Status:** `new`
- **Screens:** bell dropdown and notification centre (missing); Overview "Cần chú ý" (13:69) reads the same feed filtered by `type`
- **Auth:** tenant (rows are per recipient; branch-scoped rows are filtered by D2)
- **Query:** `?isRead=false&type=low_stock,sku_unmapped,receipt_pending,transfer_arrived&branchId=…&page=1&limit=10`
  - `type` enum: `low_stock` | `sku_unmapped` | `stock_shortage` | `receipt_pending` | `transfer_arrived` | `po_partially_received` | `order_new` | `subscription_expiring` | `announcement`.
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "type": "low_stock", "title": "Cốc thủy tinh Sọc còn 6 khả dụng", "body": "Dưới ngưỡng 10",
      "actionLabel": "Lập đề nghị nhập", "refType": "variant", "refId": "…", "branchId": "…", "isRead": false, "createdAt": "2026-10-20T07:20:00.000Z" } ],
    "pagination": { "limit": 10, "currentPage": 1, "totalRecords": 4, "totalPages": 1 } }
  ```
- **Events consumed (to build the feed):**

  | Event | Status |
  |---|---|
  | `inventory.stock.below_threshold` | new |
  | `integration.sku.unmapped` | new |
  | `inventory.receipt.submitted` | new |
  | `inventory.transfer.arrived` | new |
  | `sales.order.created` | new |
  | `platform.subscription.expiring` | new |
  | `platform.announcement.sent` | new |

### POST /insight/api/v1/notifications/{id}/read
- **Status:** `new`
- **Auth:** tenant
- **Response:** 204

### POST /insight/api/v1/notifications/read-all
- **Status:** `new`
- **Auth:** tenant
- **Response:** 204

### GET /insight/api/v1/announcements
- **Status:** `new`. Platform announcements addressed to the caller's store (ERD `PlatformAnnouncement` + `AnnouncementRecipient`). The admin side is in 04.
- **Screens:** notification centre (missing); login or dashboard banner for maintenance notices
- **Auth:** tenant
- **Query:** `?isRead=false&page=1&limit=10`
- **Response:** 200: `{ "data": [ { "id": "…", "type": "maintenance", "title": "Bảo trì hệ thống định kỳ", "body": "Hệ thống sẽ bảo trì từ 00:00 đến 00:30 ngày 26/10/2026.", "sentAt": "2026-10-23T01:30:00.000Z", "isRead": false } ], "pagination": { … } }`

### POST /insight/api/v1/device-tokens
- **Status:** `new` (ERD `DeviceToken`, for mobile push)
- **Auth:** tenant
- **Body:** `{ "token": "fcm-…", "platform": "android" }` (`platform`: `android` | `ios`)
- **Response:** 201: `{ "token": "fcm-…", "platform": "android", "createdAt": "…" }`. It is idempotent on `token`.

### DELETE /insight/api/v1/device-tokens/{token}
- **Status:** `new` (sent on logout)
- **Auth:** tenant
- **Response:** 204

### GET /insight/api/v1/audit-logs
- **Status:** `change`. Today it filters by `type` only, owner or manager.
  - Add `actorId`, `from`, `to`, `q` and `scope=access`. `access` keeps login, logout, permission-change, lock and invitation events.
  - Move to the permission `staff.view`.
  - Return the ERD shape: `actorLabel`, `action`, `entityType`, `entityId`, `result`.
- **Screens:** 13:2646 "Lịch sử truy cập"; staff detail (missing)
- **Auth:** `staff.view`
- **Query:** `?scope=access&actorId=…&from=2026-10-01&to=2026-10-20&page=1&limit=20`
- **Response:** 200
  ```json
  { "data": [ { "id": "…", "occurredAt": "2026-10-20T01:32:00.000Z", "actorId": "…", "actorLabel": "Minh Anh · Chủ cửa hàng",
      "action": "role.updated", "entityType": "role", "entityId": "…", "summary": "Cập nhật quyền Quản lý chi nhánh", "result": "success" } ],
    "pagination": { "limit": 20, "currentPage": 1, "totalRecords": 37, "totalPages": 2 } }
  ```
- **Events consumed:** the existing login and membership events, plus the new role, lock and invitation events above.

---

## Open questions

1. D1 identity: are store staff `Account` + `AccountTenant` (assumed here) or the ERD's separate `Staff`? The answer changes invitations, members and tokens. It needs an ADR.
2. Is login by phone in scope? (Figma: "Email hoặc số điện thoại".) If yes, `account.phone` must be unique and verified.
3. Should "Đang trong ca" (on shift) come from the planned `StaffSchedule` or from an actually open POS `Shift` (sales)? This spec uses the planned schedule; POS shifts could override it later.
4. Does a branch manager manage staff and schedules only for their own branches (branch-scoped `staff.*`)? This spec assumes yes.
5. Does a new store get a trial subscription (and of which plan), or Free?
