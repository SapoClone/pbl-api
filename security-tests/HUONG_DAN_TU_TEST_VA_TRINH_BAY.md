# HƯỚNG DẪN TỰ TEST & TRÌNH BÀY
## Luồng 1 — Bảo mật và Phân quyền API (RBAC, Tenant/Branch Isolation)

**Người thực hiện:** Thịnh  
**Ngày:** 16/11/2026  
**Dùng cho:** tự chạy bộ test, hiểu test case, chuẩn bị bài trình bày 12–15 phút

---

## 0. Cách dùng tài liệu này

Tài liệu chia 4 phần:

1. **Chạy được** (mục 1–3): clone code, dựng môi trường, chạy bộ test, đọc kết quả.
2. **Hiểu bộ test** (mục 4–6): cấu trúc 118 test case, dữ liệu, 7 test case tiêu biểu.
3. **Kiến thức kiểm thử** (mục 7): phân vùng tương đương, giá trị biên, bảng quyết định,
   pairwise, chuyển trạng thái, kiểm thử bảo mật, risk-based, test data.
4. **Trình bày** (mục 8–11): kịch bản nói 15 phút, câu hỏi thường gặp, checklist.

Nếu chỉ có 10 phút trước buổi trình bày: đọc mục 1.2, 2.1, 3.1, 8 và 10.

---

## 1. Clone code và kiểm tra

### 1.1. Clone (nếu máy mới)

```bash
cd D:\
git clone https://github.com/SapoClone/pbl-api.git
cd pbl-api
git switch test/thinh-security
git log --oneline -1
```

Kỳ vọng:

```text
e45f305 test(security): add RBAC and tenant isolation API test suite
```

> Trên máy hiện tại repo đã có tại `D:\baocaokiemthu\pbl-api`, đang ở nhánh
> `test/thinh-security`, commit `e45f305`. Không cần clone lại; chỉ cần `git fetch` nếu muốn
> chắc chắn nhánh mới nhất.

### 1.2. Cấu trúc cần biết

```text
pbl-api/
├── apps/
│   ├── platform/      # auth, tenant, branch, role/RBAC, member
│   ├── catalog/       # sản phẩm (dùng cho ma trận quyền)
│   ├── inventory/     # phiếu nhập, duyệt kho (inventory.approve)
│   ├── sales/         # đơn hàng (orders.*)
│   └── customer/      # khách hàng (customers.*)
├── libs/
│   ├── auth/          # guard, JWT verifier, hasPermission, canAccessBranch
│   └── contracts/     # PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS
├── krakend/           # gateway :8080
├── security-tests/    # BỘ TEST CỦA LUỒNG 1
│   ├── security-rbac.postman_collection.json   # 118 test case
│   ├── provision.mjs                           # tạo dữ liệu + token
│   ├── run.mjs                                 # provision + Newman + summary
│   ├── build-collection.mjs                    # sinh collection từ bảng quyết định
│   ├── HANDOFF_CONTEXT.md                      # hướng dẫn chạy lại
│   └── BAO_CAO_KIEM_THU_LUONG1.md              # báo cáo ISTQB v4
└── docker-compose.yml
```

Ba tệp nên đọc trước khi trình bày:

1. `libs/contracts/src/permissions.ts` — 5 vai trò seed và quyền mặc định.
2. `security-tests/build-collection.mjs` — bảng quyết định 6 vai trò × 5 thao tác.
3. `security-tests/provision.mjs` — cách tạo 2 tenant, 2 chi nhánh, token từng vai trò.

---

## 2. Dựng môi trường

### 2.1. Cách chuẩn — Docker Compose + KrakenD

Yêu cầu:

- Docker Desktop đang chạy (Linux containers).
- Node.js 24 + npm 11.
- Trống các cổng `8080`, `3000`, `25432`, `6379`, `9324`.
- Git Bash + curl (để chạy script kiểm tra stack trên Windows).

Kiểm tra Docker trước khi chạy:

```bash
docker info --format "{{.ServerVersion}}"
```

Nếu lệnh này báo `failed to connect ... dockerDesktopLinuxEngine`, Docker Desktop chưa chạy —
bật Docker Desktop, chờ đến khi trạng thái là **Running**, rồi mới chạy Compose. Đây chính là
nguyên nhân lỗi `Stack chưa sẵn sàng ... fetch failed` khi dùng `--gateway`.

```bash
cd D:\baocaokiemthu\pbl-api
docker compose up -d --build
```

Lần đầu build khoảng 2–3 phút. Kiểm tra:

```bash
bash scripts/verify-local-stack.sh
```

Kết quả cuối phải là:

```text
Stack verified.
```

Kiểm tra nhanh bằng trình duyệt/curl:

```bash
curl -s http://localhost:8080/platform/health
curl -s http://localhost:8080/platform/.well-known/jwks.json
```

### 2.2. Vì sao có lúc phải dùng "direct mode"?

Trong phiên chạy thật của báo cáo, máy không khởi động được Docker Desktop (WSL bị từ chối
quyền), nên 5 service được chạy trực tiếp trên Windows tại:

| Service | Cổng |
|---|---:|
| platform | 3000 |
| catalog | 3001 |
| inventory | 3002 |
| sales | 3003 |
| customer | 3004 |

Bộ test hỗ trợ cả hai chế độ:

- Qua gateway: `npm test -- --gateway http://localhost:8080`
- Direct: `npm test` (mặc định `127.0.0.1:3000..3004`)

Không cần sửa collection khi đổi chế độ; chỉ đổi biến `platformBase`, `catalogBase`, …

> Trên máy này có sẵn thư mục `D:\baocaokiemthu\runtime` để chạy direct mode. Cách khởi động
> xem Phụ lục C. Khi trình bày, nếu Docker chạy được thì nên dùng Docker + gateway để đúng
> kiến trúc; nếu không, dùng direct mode và nói rõ lý do.

### 2.3. Nâng quota gói Free (bộ test tự làm)

Tenant A cần 2 chi nhánh và 10 tài khoản, trong khi gói Free mặc định chỉ 1 chi nhánh /
3 người dùng. `provision.mjs` tự chạy:

```sql
UPDATE platform.plan
   SET quota_branches = GREATEST(quota_branches, 10),
       quota_users    = GREATEST(quota_users, 50)
 WHERE code = 'free';
```

Đây là **điều chỉnh môi trường test**, không sửa mã nguồn. Nếu không kết nối được DB, provision
in cảnh báo; khi đó tạo chi nhánh thứ hai sẽ nhận `409 Q001`.

Khôi phục sau khi chấm:

```sql
UPDATE platform.plan SET quota_branches = 1, quota_users = 3 WHERE code = 'free';
```

---

## 3. Chạy bộ test

### 3.1. Lệnh chính

```bash
cd D:\baocaokiemthu\pbl-api\security-tests
npm ci
npm test -- --gateway http://localhost:8080
```

`npm test` làm 3 việc:

1. **Provision** (`provision.mjs`): tạo tenant A/B, chi nhánh A1/A2/B1, 11 tài khoản,
   4 vai trò tùy chỉnh, token từng vai trò; ghi `results/security-environment.json`.
2. **Newman**: chạy 118 request, 353 assertion.
3. **Tổng hợp**: ghi `results/summary.md`, `results/cases-table.md`, `results/newman.json`,
   `results/report.html`; lưu lịch sử vào `results/history/<runId>/`.

### 3.2. Kết quả kỳ vọng

```text
Test case : 118
Passed    : 116
Failed    : 2 (known defects: 2, unexpected: 0)
Assertion : 353 (failed: 3)
Thời gian : ~7 giây
```

Hai case Failed là **defect bảo mật đã biết**, không phải lỗi môi trường:

- `TC-SEC-REV-03` — thu hồi quyền không có hiệu lực với token cũ.
- `TC-SEC-REV-08` — đổi phạm vi chi nhánh không có hiệu lực với token cũ.

Nếu thấy số khác, xem mục 11 (xử lý sự cố) trước khi kết luận.

> Kết quả 116/118 là kết quả tham chiếu ở **direct mode**. Khi chạy qua KrakenD, nếu plugin
> `pbl-error-body` không trả trường `error: Unauthorized` cho 401, các ca AUTH có thể báo
> fail do assertion hình dạng body; kiểm tra body 401 trước khi kết luận đó là lỗi sản phẩm.

### 3.3. Các lệnh hay dùng

| Lệnh | Việc làm |
|---|---|
| `npm test` | Chạy direct mode (mặc định) |
| `npm run test:direct` | Chạy direct mode, tên lệnh rõ ràng |
| `npm run test:gateway` | Chạy qua KrakenD `http://localhost:8080` |
| `npm test -- --gateway http://localhost:8080` | Tương đương `test:gateway` |
| `npm test -- --skip-provision` | Dùng lại token/dữ liệu cũ, không tạo mới |
| `npm test -- --strict` | Trả mã 1 nếu còn Failed (dùng cho CI) |
| `npm test -- --no-html` | Không sinh HTML |
| `npm run build` | Chỉ sinh lại collection |
| `npm run provision` | Chỉ tạo dữ liệu, không chạy test |

> Nếu `--gateway` báo `fetch failed` cho cả 5 service: cổng 8080 không có gì lắng nghe.
> Kiểm tra `docker info`; bật Docker Desktop rồi `docker compose up -d --build`.
> Không có Docker thì dùng `npm test` (direct) — không cần cờ `--gateway`.

### 3.4. Chạy một nhóm test

```bash
npx newman run security-rbac.postman_collection.json \
  -e results/security-environment.json \
  --folder "02 — RBAC decision table: 6 vai trò × 5 thao tác"
```

Các folder:

```text
00 — Preconditions
01 — Authentication guard (401)
02 — RBAC decision table: 6 vai trò × 5 thao tác
03 — RBAC bổ sung theo module
04 — Vai trò tùy chỉnh & mã lỗi 400/409
05 — Cô lập tenant
06 — Cô lập chi nhánh
07 — Thu hồi quyền tức thời (revocation)
```

### 3.5. Đọc kết quả

| Tệp | Dùng khi nào |
|---|---|
| `results/summary.md` | Xem nhanh Passed/Failed theo nhóm |
| `results/report.html` | Mở bằng Chrome/Edge, xem request/response/assertion từng case |
| `results/cases-table.md` | Bảng chi tiết: ID, method/path, dữ liệu, mong đợi, thực tế |
| `results/newman.json` | Dữ liệu thô cho máy đọc |
| `results/history/<runId>/` | So sánh nhiều lần chạy |

**Không mở/chia sẻ** `results/security-environment.json`, `results/newman.json`,
`results/report.html` công khai: chúng chứa access token thật (hạn 1 ngày).

### 3.6. Chạy bằng Postman UI (để hiểu từng request)

CLI phù hợp để chạy cả bộ; Postman UI phù hợp để xem từng request/response khi học.

1. Chạy `npm run provision` để sinh `results/security-environment.json`.
2. Mở Postman → **Import**:
   - `security-rbac.postman_collection.json`
   - `results/security-environment.json`
3. Chọn environment vừa import (tên `PBL Security — <runId>`).
4. Chọn một request, ví dụ `TC-SEC-RBAC-05`, bấm **Send**.
5. Mở tab **Test Results** để xem assertion; tab **Console** để xem request thật.
6. Muốn chạy cả folder: **Runner** → chọn collection → chọn folder → **Run**.

Lưu ý: environment chứa token; không export/chia sẻ. Nếu token hết hạn, chạy lại
`npm run provision` và import environment mới.

---

## 4. Bộ test được tổ chức thế nào

### 4.1. Luồng dữ liệu

```text
provision.mjs
  ├─ đăng ký 11 tài khoản
  ├─ tạo tenant A + B
  ├─ tạo chi nhánh A2, lấy A1/B1 mặc định
  ├─ tạo 4 vai trò tùy chỉnh
  ├─ gán 9 thành viên vào tenant A (kèm branch scope)
  ├─ đăng nhập từng vai trò → token
  ├─ tạo 1 sản phẩm + 1 khách hàng của A
  ├─ tạo token hết hạn, token bị sửa
  └─ ghi results/security-environment.json
                    │
                    ▼
Newman chạy collection với environment
                    │
                    ▼
results/summary.md, cases-table.md, newman.json, report.html
```

### 4.2. Vì sao mỗi lần chạy độc lập?

- Mỗi lần có `runId` mới (`sec...`), dùng trong email, subdomain, mã chi nhánh.
- Không xóa tenant/cũ, không sửa dữ liệu có sẵn.
- Không dùng ID cố định; mọi ID lấy từ response và lưu vào biến môi trường.
- Chạy lại 2 lần cho cùng kết quả 116/118 — đây là bằng chứng **repeatable**.

### 4.3. Phân biệt 403 — 404 — 422

Đây là điểm dễ bị hỏi nhất khi trình bày:

| Mã | Khi nào | Ví dụ |
|---:|---|---|
| **401** | Chưa xác thực / token sai / hết hạn / bị thu hồi | không token; token sửa payload; sau logout |
| **403** | Đã xác thực nhưng **thiếu quyền** | sales xóa khách hàng; kế toán tạo đơn |
| **404** | Không tồn tại **hoặc** ngoài phạm vi tenant/chi nhánh (cố ý giấu sự tồn tại) | tenant B đọc sản phẩm A; manager đọc A1 |
| **422** | Dữ liệu sai định dạng/thiếu trường, **đã qua guard** | owner tạo sản phẩm body `{}` |
| **400** | Lỗi nghiệp vụ có `errorCode` | trùng tên vai trò R001, quyền lạ R003 |
| **409** | Xung đột trạng thái | xóa vai trò đang có thành viên R005 |

**Câu chốt:** với vai trò **có quyền**, request đi tiếp vào validate nên trả 422/404; với vai
trò **không có quyền**, guard trả 403 trước khi chạm dữ liệu. Vì vậy 422/404 là "được phép",
không phải lỗi phân quyền.

### 4.4. Đọc code sinh test

Mở `security-tests/build-collection.mjs`, phần `MATRIX`:

```js
{
  id: 'VIEW',
  name: 'Xem sản phẩm',
  method: 'GET',
  base: 'catalogBase',
  path: '/products',
  permission: 'products.view',
  allowed: ['owner', 'branch_manager', 'sales_staff', 'warehouse_staff', 'custom'],
  allowedStatus: 200,
}
```

Mỗi operation sinh 6 request (một cho mỗi vai trò). Nếu vai trò nằm trong `allowed`, kỳ vọng
`allowedStatus` (200/422/404); nếu không, kỳ vọng 403. Đây là bảng quyết định bằng code.

Một item sinh ra có các assertion:

```js
pm.test("HTTP 403", () => pm.response.to.have.status(403));
pm.test("Từ chối 403 Forbidden", () => {
  pm.expect(pm.response.json().error).to.eql("Forbidden");
});
pm.test("Thời gian phản hồi < 3000 ms", () => {
  pm.expect(pm.response.responseTime).to.be.below(3000);
});
```

`provision.mjs` làm phần dữ liệu:

```js
const t = await http('POST', `${platform}/tenants`, {
  token: ownerA.accessToken,
  body: { name: `Security Store A ${id}`, subdomain: `sec-a-${id}` },
});
const ownerToken = t.json.auth.accessToken;
```

Nhờ tách **provision** khỏi **assertion**, test không phụ thuộc thứ tự chạy và có thể chạy lại.

### 4.5. Muốn thêm một test case mới thì làm gì?

**Trường hợp 1 — thêm vào ma trận vai trò × thao tác:**

1. Mở `build-collection.mjs`, thêm một object vào `MATRIX` (ví dụ `orders.view`).
2. Xác định `allowed` theo `DEFAULT_ROLE_PERMISSIONS`.
3. Chọn endpoint đại diện và status khi được phép (200/422/404).
4. `npm run build` để sinh lại collection.
5. `npm test` và kiểm tra nhóm `02`.

**Trường hợp 2 — thêm một ca đặc biệt (IDOR, token, lỗi):**

1. Mở `build-collection.mjs`, thêm `requestItem({...})` vào nhóm phù hợp.
2. Viết `checks` bằng `CHECKS.status`, `CHECKS.errorCode`, `CHECKS.forbidden`, …
3. Nếu cần dữ liệu mới, thêm vào `provision.mjs` và ghi vào `values`.
4. Chạy lại; không sửa tay file collection JSON (file này được sinh tự động).

**Trường hợp 3 — thêm biên:**

- Thêm biến/hàm tạo token với `exp` sát biên vào `lib/api.mjs`.
- Thêm request vào nhóm `01` hoặc `07`.
- Ghi rõ trong báo cáo là "bổ sung BVA".

---

## 5. 118 test case gồm những gì

| Nhóm | Số case | Mục đích |
|---|---:|---|
| 00 — Preconditions | 4 | Xác nhận 5 vai trò seed, claims token, vai trò tùy chỉnh đúng |
| 01 — Authentication | 9 | 401: thiếu/sai/hết hạn/bị sửa token; logout/lock thu hồi ngay |
| 02 — RBAC matrix | 30 | 6 vai trò × 5 thao tác (xem/thêm/sửa/xóa/duyệt) |
| 03 — RBAC bổ sung | 16 | Quyền theo module: orders, customers, inventory, staff, settings |
| 04 — Vai trò & 400/409 | 19 | CRUD vai trò, mã lỗi R001/R002/R003/R004/R005/R007/R008/T002/T003/B001/T001 |
| 05 — Tenant isolation | 20 | IDOR sản phẩm/khách hàng/chi nhánh/vai trò/thành viên; switch-tenant; chèn tenantId body/query/header |
| 06 — Branch isolation | 10 | Chỉ thấy A2; đọc/sửa A1 → 404; context; tạo chi nhánh → 403 B008 |
| 07 — Revocation | 10 | Thu hồi quyền/phạm vi: token cũ vs token mới |

**6 vai trò:** owner, branch_manager, sales_staff, warehouse_staff, accountant, custom.

**5 thao tác:** xem sản phẩm, tạo sản phẩm, sửa sản phẩm, xóa sản phẩm, duyệt phiếu nhập kho.

---

## 6. Bảy test case tiêu biểu — hiểu để nói

### 6.1. TC-SEC-RBAC-05 — Kế toán xem sản phẩm → 403

- **Kỹ thuật:** phân vùng tương đương + bảng quyết định.
- **Vì sao:** `accountant` không có `products.view` trong `DEFAULT_ROLE_PERMISSIONS`.
- **Request:** `GET /catalog/api/v1/products` với token accountant.
- **Mong đợi:** 403; **thực tế:** 403.
- **Nói khi trình bày:** "Đây là kiểm thử phân quyền dọc: vai trò bị chặn ở đúng module,
  không phụ thuộc việc UI có ẩn nút hay không."

### 6.2. TC-SEC-RBAC-07 — Owner tạo sản phẩm body rỗng → 422

- **Kỹ thuật:** phân vùng tương đương (lớp "được phép") + test oracle.
- **Vì sao:** owner có `products.create`, nên request phải vượt guard; lỗi 422 là do thiếu
  `name`, không phải do phân quyền.
- **Mong đợi:** 422; **thực tế:** 422.
- **Nói:** "Nếu case này trả 403 thì mới là lỗi; 422 chứng minh guard đã cho qua."

### 6.3. TC-SEC-AUTH-03 — Token bị sửa payload → 401

- **Kỹ thuật:** kiểm thử bảo mật token / negative testing.
- **Vì sao:** token thật được sửa payload nhưng giữ chữ ký cũ; chữ ký RS256 không còn khớp.
- **Mong đợi:** 401; **thực tế:** 401.
- **Nói:** "Em không chỉ test token rỗng; em test cả token bị sửa, token hết hạn, sai scheme."

### 6.4. TC-SEC-TEN-01 — Tenant B đọc sản phẩm của A → 404

- **Kỹ thuật:** IDOR / horizontal privilege escalation / cô lập tenant.
- **Vì sao:** token B hợp lệ, nhưng ID sản phẩm thuộc A; tenant lấy từ token, không từ URL.
- **Mong đợi:** 404; **thực tế:** 404; body không chứa tên sản phẩm A.
- **Nói:** "Đây là lỗi rò rỉ dữ liệu nguy hiểm nhất nếu xảy ra; em kiểm cả đọc, sửa, xóa."

### 6.5. TC-SEC-BRA-05/06 — Branch scope

- **Kỹ thuật:** phân vùng theo phạm vi + giá trị biên (1 chi nhánh vs 2 chi nhánh).
- **Tiền đề:** `scopee` có `settings.view/update` nhưng chỉ gán A2.
- **BRA-05:** `PATCH /branches/{A1}/settings` → mong đợi 404, thực tế 404.
- **BRA-06:** `PATCH /branches/{A2}/settings` → mong đợi 200, thực tế 200.
- **Nói:** "Ngoài phạm vi trả 404 chứ không phải 403 để không lộ chi nhánh A1 tồn tại."

### 6.6. TC-SEC-REV-03 — Thu hồi quyền, token cũ vẫn dùng được (DEF-SEC-01)

- **Kỹ thuật:** chuyển trạng thái + kiểm thử bảo mật theo thời gian.
- **Các bước:** tạo role `staff.view + staff.create` → gán revokee → login (token cũ) →
  gọi POST members body `{}` được 422 (chứng tỏ có quyền) → owner PATCH role bỏ `staff.create`
  → gọi lại bằng token cũ.
- **Mong đợi:** 403. **Thực tế:** 422 (guard vẫn cho qua).
- **Nói:** "Đây là defect, không phải test sai. Quyền nằm trong JWT; guard không tra lại DB;
  ADR-0020 chấp nhận trễ tới 1 ngày."

### 6.7. TC-SEC-REV-08 — Đổi phạm vi chi nhánh, token cũ vẫn đọc được (DEF-SEC-02)

- **Kỹ thuật:** chuyển trạng thái + cô lập chi nhánh.
- **Các bước:** scopee chỉ A2 → login → đọc A2 settings 200 → owner đổi branchIds sang A1 →
  đọc lại A2 bằng token cũ.
- **Mong đợi:** 404. **Thực tế:** 200.
- **Nói:** "Cùng root cause với DEF-SEC-01: claim `branches` cũ vẫn còn hiệu lực."

---

## 7. Kiến thức kiểm thử đã áp dụng

### 7.0. Quy trình thiết kế một test case

Trước khi viết code, làm 6 bước:

1. **Đọc yêu cầu:** FR/BR/NFR nói gì? Ví dụ FR-M02-05: phân quyền theo vai trò.
2. **Xác định đối tượng:** vai trò nào, thao tác nào, tài nguyên nào.
3. **Chọn kỹ thuật:** bảng quyết định cho tổ hợp; EP/BVA cho dữ liệu; state transition cho
   token/session.
4. **Xác định oracle:** status code + `errorCode` + dữ liệu không được lộ. Không đoán; đối
   chiếu `DEFAULT_ROLE_PERMISSIONS`, SRS, ADR.
5. **Chuẩn bị dữ liệu:** tài khoản, tenant, chi nhánh, role, token — tạo tự động.
6. **Viết assertion và chạy thử một request** trước khi nhân bản thành 30 case.

Sai lầm thường gặp: viết 30 request trước, chạy thấy sai mới sửa oracle; hoặc để test phụ
thuộc thứ tự/ID cố định. Bộ này làm ngược: provision trước, chạy thử, rồi sinh hàng loạt.

### 7.1. Phân vùng tương đương (Equivalence Partitioning)

**Định nghĩa:** chia miền dữ liệu thành các lớp mà hệ thống phải xử lý giống nhau; mỗi lớp
chọn một giá trị đại diện. Không cần test mọi giá trị.

**Áp dụng trong bộ test:**

| Miền | Lớp hợp lệ | Lớp không hợp lệ | Test case |
|---|---|---|---|
| Vai trò | owner/branch_manager có quyền | sales/warehouse/accountant thiếu quyền | RBAC-01..30 |
| Token | token hợp lệ | thiếu, rác, sửa payload, hết hạn, sai scheme, đã logout/lock | AUTH-01..09 |
| Tenant | cùng tenant | khác tenant | TEN-01..12 |
| Chi nhánh | trong phạm vi A2 | ngoài phạm vi A1 | BRA-01..06 |
| Body | hợp lệ | rỗng/sai định dạng/thiếu trường | X-04, X-13, ROLE-18 |
| Vai trò tùy chỉnh | đúng quyền được cấp | quyền ngoài danh sách | SETUP-03, X-11 |

**Câu nói:** "Em không test mọi cặp role–product; em chọn lớp đại diện cho 'có quyền' và
'không có quyền', rồi dùng bảng quyết định để phủ hết tổ hợp quan trọng."

### 7.2. Kiểm thử giá trị biên (Boundary Value Analysis)

**Định nghĩa:** lỗi thường nằm ở biên. Với miền `[min, max]`, test `min-1, min, min+1,
max-1, max, max+1`.

**Các biên trong hệ thống này:**

| Biến | Biên | Test hiện có / đề xuất |
|---|---|---|
| Token `exp` | `now-1`, `now`, `now+1` | AUTH-04 test token đã hết hạn (`now-3600`); có thể bổ sung đúng biên `now±1` |
| Token còn hạn sau thu hồi | 0 giây vs 1 ngày | REV-03/08 (token còn hạn) |
| Số chi nhánh | 1 (Free), 2 (vượt Free) | BRA-01 (1 chi nhánh), BRA-09 (2 chi nhánh); thêm test Q001 nếu hạ quota |
| Số người dùng | 3 (Free), 4 (vượt) | Chưa test trong suite vì đã nâng quota; có thể demo riêng |
| `branchIds` | `[]`, `[A2]`, `[A1,A2]`, 100/101 | REV-07 (`[A1]`); thêm `[]` = mọi chi nhánh |
| Tên vai trò | 1, 150, 151 ký tự | ROLE-01/02 mới test trùng tên; thêm biên độ dài |
| Mã chi nhánh | 1, 20, 21 ký tự | ROLE-18 test sai regex; thêm biên độ dài |
| Subdomain | 2, 3, 30, 31 ký tự | ROLE-19 test trùng; thêm biên độ dài |
| Danh sách quyền | 0, 1, 43, mã lạ | ROLE-03 (mã lạ), SETUP-03 (6 quyền) |

**Ví dụ BVA token:** token `exp = now - 1` phải 401; `exp = now + 1` phải 200. Bộ test hiện
dùng token hết hạn 1 giờ và token còn hạn 1 ngày, đủ để phát hiện lỗi logic; muốn chặt hơn
thì thêm 2 ca sát biên.

**Ví dụ BVA quota:** hạ `quota_branches = 1`, tạo chi nhánh thứ 2 phải `409 Q001`; đặt lại
`quota_branches = 2`, tạo chi nhánh thứ 2 phải 201. Đây là bài demo rất tốt nếu bị hỏi
"BVA áp dụng ở đâu?".

**Nói:** "BVA dùng cho các ngưỡng thật của hệ thống: TTL token, quota gói, số chi nhánh,
độ dài mã/tên. Với ma trận quyền, biên là 'có quyền' vs 'không có quyền'."

### 7.3. Bảng quyết định (Decision Table)

**Định nghĩa:** liệt kê điều kiện (role, permission) và hành động (cho phép/chặn), rồi rút
gọn các cột giống nhau.

**Bảng đã dùng:**

| Vai trò | Xem SP | Tạo SP | Sửa SP | Xóa SP | Duyệt phiếu |
|---|:---:|:---:|:---:|:---:|:---:|
| owner | A | A | A | A | A |
| branch_manager | A | A | A | A | A |
| sales_staff | A | D | D | D | D |
| warehouse_staff | A | D | D | D | D |
| accountant | D | D | D | D | D |
| custom (6 quyền xem) | A | D | D | D | D |

`A` = allowed (200/422/404 tùy dữ liệu), `D` = denied (403).

**Vì sao chạy đủ 30 tổ hợp?** 6 × 5 = 30, chi phí thấp (~7 giây), nên không cần lấy mẫu.
Đây là điểm mạnh: phủ 100% bảng quyết định.

**Nói:** "Bảng quyết định giúp em không bỏ sót tổ hợp vai trò–thao tác; collection được sinh
tự động từ bảng này nên không viết tay 30 request."

### 7.4. Pairwise Testing

**Định nghĩa:** khi số tổ hợp bùng nổ, chọn tập nhỏ nhất phủ mọi cặp giá trị; thay vì
`roles × modules × actions × scopes`, mỗi cặp được xuất hiện ít nhất một lần.

**Vì sao bộ này không dùng pairwise?** 6 × 5 = 30, chạy toàn bộ rẻ hơn thiết kế pairwise.
Pairwise chỉ đáng khi > 100 tổ hợp, ví dụ 10 vai trò × 20 endpoint × 4 branch scope = 800.

**Nếu bị hỏi "sao không dùng pairwise?":** trả lời: "Em đã cân nhắc; với 30 tổ hợp, chạy đủ
cho coverage cao hơn và chi phí thấp. Pairwise là phương án khi ma trận lớn, nhưng sẽ bỏ sót
tổ hợp bậc 3."

### 7.5. Kiểm thử chuyển trạng thái (State Transition)

**Định nghĩa:** hệ thống có trạng thái; sự kiện hợp lệ đưa sang trạng thái mới; sự kiện
không hợp lệ phải bị chặn.

**Áp dụng:**

| Trạng thái | Sự kiện | Trạng thái mới | Test |
|---|---|---|---|
| Token active | logout | revoked (401) | AUTH-06/07 |
| Token active | member bị lock | revoked (401) | AUTH-08/09 |
| Token active | hết hạn | expired (401) | AUTH-04 |
| Role có `staff.create` | owner bỏ quyền | role mới; token cũ **vẫn active** (defect) | REV-01..05 |
| Member scope A2 | owner đổi sang A1 | scope mới; token cũ **vẫn A2** (defect) | REV-06..10 |

**Nói:** "Đây là chỗ phát hiện defect: về mặt DB trạng thái đã đổi, nhưng token cũ vẫn giữ
trạng thái cũ. Đó là lỗi đồng bộ giữa token và DB."

### 7.6. Kiểm thử bảo mật ở tầng API

| Kỹ thuật | Nội dung | Test |
|---|---|---|
| Authentication | thiếu/sai/hết hạn token | AUTH-01..05 |
| Session revocation | logout, lock | AUTH-06..09 |
| Vertical privilege escalation | sales làm việc của owner | RBAC, X-03/05/07/10/11 |
| Horizontal privilege escalation | tenant B đọc dữ liệu A | TEN-01..12 |
| IDOR | đổi ID trên URL | TEN-01..12 |
| Parameter tampering | chèn `tenantId` body/query/header | TEN-17/18/20 |
| Branch scope | ngoài phạm vi 404 | BRA-01..10 |
| Token tampering | sửa payload, giữ chữ ký | AUTH-03 |
| Error handling | 400/409/422 đúng mã | ROLE-01..19 |

### 7.7. Kiểm thử dựa trên rủi ro (Risk-Based Testing)

| Rủi ro | Mức | Test ưu tiên |
|---|---|---|
| Token cũ giữ quyền sau thu hồi | Cao (20) | REV-03 |
| Token cũ giữ phạm vi chi nhánh | Cao (16) | REV-08 |
| Rò rỉ dữ liệu giữa tenant | TB-Cao (10) | TEN-01..20 |
| Vai trò tùy chỉnh vượt quyền | TB-Cao (10) | RBAC, SETUP-03 |
| Người bị giới hạn chi nhánh đọc A1 | Cao (12) | BRA-01..10 |

### 7.8. Phân vùng theo lỗi và kiểm thử âm (Error Guessing / Negative Testing)

Các ca 400/409 không đến từ bảng quyết định mà từ kinh nghiệm lỗi thường gặp:

- Trùng tên vai trò → 409 R001.
- Mã quyền không tồn tại → 400 R003.
- Sửa/xóa owner → 400 R002/R004.
- Xóa vai trò đang có thành viên → 409 R005.
- Thiếu role khi thêm member → 400 R007.
- Gán owner role → 400 R008.
- Trùng thành viên → 400 T002.
- Đổi owner → 400 T003.
- Trùng mã chi nhánh → 400 B001.
- Trùng subdomain → 400 T001.

### 7.9. Test data độc lập và tái lập

- Mỗi run có `runId`; email/subdomain/mã chi nhánh đều chứa `runId`.
- Không dùng ID cố định; mọi ID lấy từ response.
- Không xóa tenant; dữ liệu cũ không ảnh hưởng.
- Chạy 2 lần cho cùng kết quả → chứng minh repeatable.
- Quota được nâng tự động, có ghi chú và lệnh khôi phục.

### 7.10. Truy vết yêu cầu (Traceability)

Mỗi test case map về FR/BR/NFR:

| Yêu cầu | Test case | Kết quả |
|---|---|---|
| FR-M02-05 (RBAC) | RBAC-01..30, ROLE-01..19 | Đạt |
| FR-M02-06 (vai trò tùy chỉnh, thu hồi) | REV-01..05, ROLE-01..08 | Có lỗi REV-03 |
| FR-M02-07 (branch scope) | BRA-01..10, REV-06..10 | Có lỗi REV-08 |
| NFR-SE-03 (tenant isolation) | TEN-01..20 | Đạt |
| NFR-SE-04 (API authorization) | AUTH, RBAC, X | Có lỗi thu hồi |
| BR-01 (tenant_id) | TEN-01..20 | Đạt |

### 7.11. Mô hình Test Diamond

Test Diamond không phải "viết thật nhiều unit test"; nó nói tầng **API/integration** là tầng
dày nhất vì kiểm tra hành vi thật với chi phí vừa phải, còn UI/E2E chỉ giữ hành trình quan
trọng.

| Tầng | Trong Luồng 1 | Số lượng | Vai trò |
|---|---|---:|---|
| E2E giao diện | Không có (ngoài phạm vi) | 0 | UI do luồng khác phụ trách |
| API / integration | Newman gọi 5 service thật, DB/Redis/ElasticMQ thật | 118 | Guard, token, tenant, branch, role |
| Unit | Chạy lại Jest có sẵn của platform/auth/quota | 407 (không viết mới) | Quy tắc thuần, hồi quy |

**Vì sao API dày?** Vì lỗi phân quyền/tenant chỉ lộ khi đi qua guard + token + DB thật; unit
test với repository giả lập không phát hiện được DEF-SEC-01/02. Đây là lý do bộ Newman là
bằng chứng chính, còn Jest chỉ là bằng chứng bổ sung.

---

## 8. Kịch bản trình bày 12–15 phút

### 8.1. Chuẩn bị trước 10 phút

Mở sẵn 4 cửa sổ:

1. Terminal tại `pbl-api/security-tests`.
2. Chrome/Edge mở `results/report.html` (bản chạy gần nhất).
3. Postman đã import collection + environment.
4. VS Code mở `build-collection.mjs` và `permissions.ts`.

Chạy trước một lần để chắc chắn stack OK:

```bash
npm test -- --gateway http://localhost:8080
```

Nếu lỗi, dùng kết quả có sẵn; đừng sửa test lúc đang trình bày.

### 8.2. Timeline

| Thời gian | Nội dung | Thao tác |
|---|---|---|
| 0:00–1:30 | Bối cảnh & phạm vi | Nói 2 chức năng, 6 yêu cầu, mô hình test diamond |
| 1:30–3:30 | Cách tiếp cận | Mở bảng quyết định 6×5; nói 118 case, 5 nhóm chính |
| 3:30–5:00 | Kiến trúc & dữ liệu | Sơ đồ provision → token → Newman; 2 tenant, 11 account |
| 5:00–8:30 | Demo live | Chạy `npm test`; chỉ summary 116/118; mở report |
| 8:30–11:00 | Giải thích 2 defect | REV-03/08, root cause JWT/ADR-0020, fix đề xuất |
| 11:00–13:00 | Kỹ thuật đã áp dụng | EP, BVA, decision table, state transition; nói pairwise khi nào |
| 13:00–15:00 | Hạn chế & Q&A | Direct mode, quota, hướng phát triển |

### 8.3. Câu mở đầu mẫu

> "Luồng 1 của em kiểm thử hai việc: phân quyền theo vai trò ở tầng API và cô lập dữ liệu
> theo tenant/chi nhánh. Em dùng Postman + Newman, thiết kế bảng quyết định 6 vai trò × 5 thao
> tác, tổng 118 test case. Kết quả 116 pass, 2 fail — cả hai là lỗi bảo mật thật về thu hồi
> quyền tức thời, không phải lỗi kịch bản."

### 8.4. Khi demo

1. Chạy `npm test -- --gateway http://localhost:8080`.
2. Chỉ vào dòng `Passed 116 / Failed 2`, giải thích 2 known defects.
3. Mở `results/summary.md`, chỉ nhóm 07 Revocation 8/10.
4. Mở `results/report.html`, mở `TC-SEC-REV-03`: request, response 422, assertion đỏ.
5. Mở `TC-SEC-TEN-01` để đối chiếu một case 404 xanh.
6. Mở `permissions.ts` chỉ `DEFAULT_ROLE_PERMISSIONS`.

### 8.5. Nếu live demo lỗi

- Không hoảng; nói: "Em có bản chạy lưu sẵn" → mở `results/report.html`.
- Chỉ chạy một folder nhỏ:
  ```bash
  npx newman run security-rbac.postman_collection.json -e results/security-environment.json \
    --folder "02 — RBAC decision table: 6 vai trò × 5 thao tác"
  ```
- Nếu stack chết: trình bày bằng `summary.md` + `cases-table.md`; nêu rõ sự cố môi trường.

---

## 9. Câu hỏi thường gặp & trả lời mẫu

**Q1. Vì sao 2 test fail mà vẫn nộp?**
> Vì đây là defect bảo mật thật, không phải test sai. Em ghi DEF-SEC-01/02, mức Major, kèm
> steps và root cause. Báo cáo kết luận exit criteria chưa đạt, đúng trung thực.

**Q2. Vì sao thu hồi quyền không có hiệu lực ngay?**
> Quyền nằm trong JWT claim `perms`; guard chỉ đọc token, không tra DB. ADR-0020 chấp nhận
> áp dụng ở lần đăng nhập/refresh kế tiếp, tối đa 1 ngày. Đây là xung đột với yêu cầu
> "thu hồi ngay" của Luồng 1.

**Q3. Vì sao branch ngoài phạm vi trả 404, không phải 403?**
> Cố ý: 404 không tiết lộ chi nhánh đó tồn tại. Đây là quy ước của ADR-0020 và được test
> trong BRA-02/03/05.

**Q4. Vì sao 422 được coi là Passed?**
> Vì vai trò có quyền đã vượt guard; 422 là lỗi validate body rỗng. Nếu trả 403 mới là chặn
> sai. Em dùng 422/404 làm "được phép" trong bảng quyết định.

**Q5. Sao không test giao diện?**
> Theo Test Diamond và phân công, Luồng 1 kiểm ở tầng API; UI chỉ cần hành trình chính, do
> luồng khác phụ trách. API test phát hiện lỗi phân quyền tốt hơn và không phụ thuộc UI.

**Q6. Pairwise là gì, sao không dùng?**
> Pairwise phủ mọi cặp giá trị khi tổ hợp quá lớn. Ma trận của em chỉ 30 tổ hợp, chạy đủ
> rẻ hơn và coverage cao hơn. Nếu 10 vai trò × 20 endpoint × 4 scope thì mới dùng pairwise.

**Q7. Giá trị biên áp dụng ở đâu?**
> TTL token (hết hạn/còn hạn), quota gói (1 vs 2 chi nhánh, 3 vs 4 người), số branchIds
> (0/1/2), độ dài mã/tên. Em nêu rõ case nào đã chạy, case nào là hướng bổ sung.

**Q8. Làm sao đảm bảo chạy lại không phá dữ liệu?**
> Mỗi run có `runId`; email/subdomain/mã chi nhánh duy nhất; không xóa tenant; token lấy mới.
> Chạy 2 lần cho cùng kết quả.

**Q9. Vì sao sửa DB quota? Có phải hack không?**
> Không. Đó là điều chỉnh môi trường test để dựng đủ 2 chi nhánh/10 tài khoản; có ghi chú,
> lệnh khôi phục, không sửa code. Production không bị ảnh hưởng.

**Q10. Vì sao chạy direct mode, không qua gateway?**
> Máy chạy không bật được Docker Desktop/WSL. Collection hỗ trợ `--gateway`; khi có Docker
> chỉ đổi một tham số. Em ghi rõ trong báo cáo để không claim sai môi trường.

**Q11. Nếu được làm lại, em cải tiến gì?**
> Thêm token version/revocation epoch; test BVA sát biên (`exp=now±1`); test branchIds `[]`;
> chạy qua gateway trong CI; thêm contract test và test cross-service nhiều hơn.

**Q12. 118 case có nhiều không?**
> 30 case ma trận + 88 case xác thực, cô lập, vai trò, lỗi. Mỗi case có mục đích; không
> nhân bản vô ích. Chi phí chạy ~7 giây.

**Q13. Test case và assertion khác nhau?**
> Test case là một request/kịch bản (118); assertion là một điều kiện kiểm tra trong đó
> (353). Một test case có thể có 3–5 assertion.

**Q14. Làm sao biết expected result đúng?**
> Đối chiếu SRS/Testing Scenario, `DEFAULT_ROLE_PERMISSIONS`, ADR-0020 và chạy thử một request
> trước khi viết hàng loạt. Expected không tự suy đoán.

**Q15. Vì sao token bị sửa vẫn có thể lọt nếu chỉ đổi ký tự cuối?**
> Đó là lỗi của kỹ thuật tạo token giả trong test (bit đệm base64url). Em đã sửa: đổi payload
> và giữ chữ ký cũ, nên chắc chắn sai chữ ký. Đây là bài học kiểm thử chính mình.

---

## 10. Checklist trước khi trình bày

- [ ] `git switch test/thinh-security`; `git log -1` đúng commit.
- [ ] Docker stack lên đủ; `verify-local-stack.sh` in "Stack verified."
- [ ] `npm ci` trong `security-tests/` đã chạy.
- [ ] Chạy thử `npm test -- --gateway http://localhost:8080` trước 15 phút.
- [ ] Mở sẵn `results/report.html` bản chạy tốt.
- [ ] Mở sẵn `results/summary.md`, `cases-table.md`.
- [ ] Postman import collection + environment.
- [ ] Đã đọc 7 test case tiêu biểu (mục 6).
- [ ] Đã chuẩn bị câu trả lời Q1–Q15.
- [ ] Đã khôi phục quota Free nếu dùng máy chung.
- [ ] Không mở file chứa token khi chiếu màn hình.

---

## 11. Xử lý sự cố nhanh

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Stack chưa sẵn sàng: platform (...) fetch failed, ...` | Không có gì lắng nghe ở địa chỉ trong base URL; thường là Docker/KrakenD chưa chạy | `docker info`; bật Docker Desktop → `docker compose up -d --build`. Không dùng Docker thì chạy `npm test` (direct) |
| `409 Q001` | Quota Free 1 chi nhánh/3 user | Chạy lại `npm test` để provision nâng quota; hoặc SQL mục 2.3 |
| Nhiều `401` | Token cũ/hết hạn, stack restart | `npm test` (provision mới), đừng `--skip-provision` |
| Nhiều `404` qua gateway | KrakenD chưa nạp route | `docker compose restart krakend` |
| `ECONNREFUSED` | Stack chưa lên | `docker compose ps`; chờ health; kiểm tra cổng |
| `403` ngay khi provision | Thiếu seed 5 vai trò (DB cũ) | `docker compose down -v && docker compose up -d --build` |
| `database "pbl" does not exist` | Volume cũ | `docker compose down -v` |
| Newman không tải reporter | Chưa `npm ci` | `cd security-tests && npm ci` |
| Kết quả khác 116/118 | Môi trường/dữ liệu | Xem `results/report.html`, so `summary.md`; chạy lại |

---

## 12. Phụ lục A — Bảng công cụ & phiên bản

| Thành phần | Phiên bản |
|---|---|
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Newman | 6.2.3 |
| newman-reporter-htmlextra | 1.23.1 |
| PostgreSQL | 16.9 |
| Redis | 5.0.14 |
| ElasticMQ | 1.7.1 |
| KrakenD | 2.6.3 |
| Jest / ts-jest | 29.7.0 / 29.2.5 |

## 13. Phụ lục B — Lệnh cheat sheet

```bash
# Clone / cập nhật
git clone https://github.com/SapoClone/pbl-api.git
cd pbl-api && git switch test/thinh-security

# Stack
docker compose up -d --build
bash scripts/verify-local-stack.sh

# Test
cd security-tests
npm ci
npm test -- --gateway http://localhost:8080
npm test -- --skip-provision
npm test -- --strict

# Newman một folder
npx newman run security-rbac.postman_collection.json \
  -e results/security-environment.json \
  --folder "02 — RBAC decision table: 6 vai trò × 5 thao tác"

# Jest (bằng chứng bổ sung)
cd ..
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "api/(role|tenant|branch)"
npx pnpm@9.12.3 exec jest --runInBand --testPathPattern "libs/auth"
```

## 14. Phụ lục C — Chạy direct mode trên máy này

Chỉ dùng khi không bật được Docker. Mở **5 cửa sổ PowerShell** tại `D:\baocaokiemthu`:

**Cửa sổ 1 — PostgreSQL:**

```powershell
.\runtime\pg\pgsql\bin\postgres.exe -D .\runtime\pg\data -p 25432
```

**Cửa sổ 2 — Redis:**

```powershell
.\runtime\redis\redis-server.exe .\runtime\redis\redis-local.conf
```

**Cửa sổ 3 — ElasticMQ:**

```powershell
java "-Dconfig.file=D:\baocaokiemthu\runtime\elasticmq\elasticmq.conf" `
  -jar "D:\baocaokiemthu\runtime\elasticmq\elasticmq-server.jar"
```

**Cửa sổ 4 — platform:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-platform.ps1
```

**Cửa sổ 5 — 4 service (mỗi lệnh một cửa sổ hoặc chạy nền):**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name catalog  -Port 3001 -Schema catalog
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name inventory -Port 3002 -Schema inventory
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name sales     -Port 3003 -Schema sales
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name customer  -Port 3004 -Schema customer
```

Kiểm tra:

```powershell
curl.exe -s http://127.0.0.1:3000/health
curl.exe -s http://127.0.0.1:3001/health
curl.exe -s http://127.0.0.1:3002/health
curl.exe -s http://127.0.0.1:3003/health
curl.exe -s http://127.0.0.1:3004/health
```

Sau đó:

```powershell
cd D:\baocaokiemthu\pbl-api\security-tests
npm test
```

> Thư mục `runtime/` là tiện ích local của máy này, không nằm trong repo. Trên máy khác,
> dùng Docker Compose là chính.

---

## 15. Kết luận ngắn để học thuộc

- **Mục tiêu:** RBAC + cô lập tenant/chi nhánh ở tầng API.
- **Cách làm:** bảng quyết định 6×5, 118 case, Postman + Newman, dữ liệu tự sinh.
- **Kỹ thuật:** phân vùng tương đương, giá trị biên, bảng quyết định, chuyển trạng thái,
  kiểm thử bảo mật/IDOR, negative testing, risk-based, traceability.
- **Kết quả:** 116/118 pass; 2 lỗi Major: thu hồi quyền và đổi phạm vi chi nhánh không có
  hiệu lực với token cũ.
- **Bài học:** JWT stateless nhanh nhưng phải có cơ chế version/revocation; test phải kiểm
  token cũ, không chỉ token mới.

---

*Chúc bạn trình bày tốt. Nếu bị hỏi câu khó, quay về 3 ý: yêu cầu — kỹ thuật — bằng chứng.*
