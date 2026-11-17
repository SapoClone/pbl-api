# BÁO CÁO NGẮN — CÔNG CỤ VÀ CÁCH XỬ LÝ TEST CASE
## Luồng 1: Bảo mật & Phân quyền API (RBAC, Tenant/Branch Isolation)

**Thịnh — 16/11/2026**

---

## 1. Tóm tắt trong 1 phút

| Nội dung | Kết quả |
|---|---|
| Công cụ chính | **Postman Collection + Newman** |
| Dữ liệu test | `provision.mjs` tạo tự động 2 tenant, 3 chi nhánh (A1/A2/B1), 11 tài khoản, token từng vai trò |
| Số test case | **118** (8 nhóm) |
| Kết quả | **116 Passed / 2 Failed** |
| Assertion | 353 (3 assertion lỗi) |
| Thời gian | ~7–10 giây/lần |
| 2 lỗi | DEF-SEC-01 (thu hồi quyền), DEF-SEC-02 (đổi phạm vi chi nhánh) |
| Chạy lại | `npm run test:direct` hoặc `npm run test:gateway` |

**Một câu chốt:** “Em dùng Postman/Newman, sinh dữ liệu bằng script, thiết kế bảng quyết định
6 vai trò × 5 thao tác; 118 case, 116 pass, 2 fail là hai defect bảo mật thật về token cũ.”

---

## 2. Dùng tool gì và dùng như thế nào

### 2.1. Danh sách tool

| Tool | Dùng để làm gì |
|---|---|
| **Postman Collection** | Mô tả 118 request, biến môi trường, assertion JavaScript |
| **Newman 6.2.3** | Chạy collection bằng CLI/CI, xuất JSON + HTML |
| **Node.js 24 + `provision.mjs`** | Đăng ký tài khoản, tạo tenant/chi nhánh/vai trò, lấy token, ghi environment |
| **newman-reporter-htmlextra** | Báo cáo HTML dễ đọc |
| **PostgreSQL 16** | Lưu tenant, account, role, branch |
| **Redis** | Deny-list logout/lock |
| **ElasticMQ** | Queue email-verification khi đăng ký |
| **KrakenD 2.6.3** | Gateway :8080 (khi chạy Docker) |
| **Jest 29** | Chạy lại test có sẵn (bằng chứng bổ sung) |

### 2.2. Quy trình chạy 4 bước

```text
B1. provision.mjs
    → tạo 2 tenant, 3 chi nhánh (A1/A2/B1), 11 account, 4 role tùy chỉnh
    → đăng nhập từng vai trò, lấy token
    → ghi results/security-environment.json

B2. Newman đọc collection + environment
    → gửi 118 request, chạy 353 assertion

B3. Sinh báo cáo
    → results/summary.md      (Passed/Failed theo nhóm)
    → results/cases-table.md  (chi tiết từng case)
    → results/report.html     (request/response/assertion)
    → results/newman.json     (dữ liệu thô)

B4. Đọc kết quả, ghi defect
```

### 2.3. Lệnh chạy

```bash
cd D:\baocaokiemthu\pbl-api\security-tests
npm ci

# Chạy trực tiếp 5 service (3000–3004) — đang dùng trên máy này
npm run test:direct

# Hoặc chạy qua KrakenD :8080 (cần Docker Desktop đang chạy)
npm run test:gateway
```

Kết quả cuối:

```text
Test case : 118
Passed    : 116
Failed    : 2 (known defects: 2, unexpected: 0)
Assertion : 353 (failed: 3)
```

> Lưu ý môi trường: lần chạy thật dùng **direct mode** vì máy không bật được Docker Desktop.
> Khi có Docker, chỉ đổi sang `npm run test:gateway`, không sửa test.

---

## 3. Xử lý test case theo từng loại test

### 3.1. Bảng tổng hợp

| Loại test | Kỹ thuật chính | Cách xử lý test case | Ví dụ | Kết quả |
|---|---|---|---|---|
| **RBAC — phân quyền vai trò** | Bảng quyết định, phân vùng tương đương | Mỗi vai trò × mỗi thao tác → một request; vai trò có quyền nhận 200/422/404, thiếu quyền nhận 403 | owner xem SP → 200; kế toán xem SP → 403 | 30/30 pass |
| **Authentication — xác thực** | Negative testing, token testing | Không token, token rác, sửa payload, hết hạn, sai scheme → 401; logout/lock → token cũ 401 | AUTH-01..09 | 9/9 pass |
| **Tenant isolation — cô lập tenant** | IDOR, horizontal privilege escalation | Dùng token B + ID của A cho GET/PATCH/DELETE → 404; list B không chứa ID A; chèn `tenantId` vào body/query/header → vẫn B | TEN-01..20 | 20/20 pass |
| **Branch isolation — cô lập chi nhánh** | Phân vùng theo phạm vi, giá trị biên | User chỉ gán A2: đọc A1 → 404, đọc A2 → 200; context chỉ A2; tạo chi nhánh → 403 B008 | BRA-01..10 | 10/10 pass |
| **Vai trò tùy chỉnh & lỗi 400/409** | Error guessing, negative testing | CRUD role; trùng tên → 409 R001; quyền lạ → 400 R003; sửa/xóa owner → 400 R002/R004; role đang dùng → 409 R005 | ROLE-01..19 | 19/19 pass |
| **Revocation — thu hồi quyền** | State transition | Đổi quyền/phạm vi → gọi lại bằng token cũ; kỳ vọng 403/404; sau đó login lại kiểm token mới | REV-01..10 | 8/10 — 2 defect |
| **Regression — hồi quy** | Chạy lại test có sẵn | Jest platform role/tenant/branch, `@pbl/auth`, quota | 27 suite | 407/407 pass |

### 3.2. RBAC — cách xử lý chi tiết

- Xây bảng quyết định **6 vai trò × 5 thao tác**:
  - Vai trò: owner, branch_manager, sales_staff, warehouse_staff, accountant, custom.
  - Thao tác: xem sản phẩm, tạo sản phẩm, sửa sản phẩm, xóa sản phẩm, duyệt phiếu nhập.
- Mỗi ô sinh một request với token của vai trò đó.
- Kỳ vọng:
  - Có quyền → **200/422/404** tùy dữ liệu.
  - Không có quyền → **403**.
- Assertion: status + `error: Forbidden` + thời gian < 3000 ms + không 5xx.

**Điểm cần nói:** 422/404 là “được đi tiếp”, không phải lỗi phân quyền. Nếu vai trò có quyền
mà nhận 403 thì mới là lỗi; nếu vai trò thiếu quyền mà nhận 422/200 thì là lỗi bảo mật.

### 3.3. Authentication — cách xử lý chi tiết

Tạo 5 loại token/request:

1. Không có `Authorization` → 401.
2. Chuỗi không phải JWT → 401.
3. Token thật bị sửa payload, giữ chữ ký cũ → 401.
4. Token hết hạn (`exp` trong quá khứ) → 401.
5. `Basic` thay vì `Bearer` → 401.

Thêm 4 ca vòng đời:

- Logout → token cũ 401.
- Lock member → token cũ 401.
- Token còn hạn → 200 (đối chứng).
- Token mới sau login → 200.

### 3.4. Tenant isolation — cách xử lý chi tiết

- Tạo **tenant A** và **tenant B**, mỗi tenant có dữ liệu riêng.
- Dùng token B, thay ID sản phẩm/khách hàng/chi nhánh/vai trò/thành viên bằng ID của A:
  - GET → 404.
  - PATCH → 404.
  - DELETE → 404.
- Kiểm tra body **không chứa tên** dữ liệu của A.
- Kiểm tra list của B **không chứa ID** của A.
- Chèn `tenantId` của A vào body/query/header khi dùng token B → vẫn thao tác trên B.
- Switch-tenant sang A → 404.

**Điểm cần nói:** tenant luôn lấy từ token, không lấy từ URL/body/header; 404 để không lộ
sự tồn tại của dữ liệu tenant khác.

### 3.5. Branch isolation — cách xử lý chi tiết

- Tạo user `scopee` có quyền `settings.view/update` nhưng chỉ gán chi nhánh **A2**.
- Kiểm tra:
  - Danh sách chi nhánh chỉ có A2.
  - `GET /branches/A1` → 404.
  - `GET /branches/A1/settings` → 404.
  - `GET /branches/A2/settings` → 200.
  - `PATCH /branches/A1/settings` → 404.
  - `PATCH /branches/A2/settings` → 200.
  - Tạo chi nhánh mới → 403 B008.
- So sánh với user không giới hạn (sales): thấy cả A1 và A2.

### 3.6. Vai trò tùy chỉnh & lỗi — cách xử lý chi tiết

- Tạo role chỉ có 6 quyền xem → thử thao tác ngoài danh sách → 403.
- Các mã lỗi được kiểm tra cả **status** và **errorCode**:

| Tình huống | Kỳ vọng |
|---|---|
| Trùng tên vai trò | 409 R001 |
| Mã quyền không tồn tại | 400 R003 |
| Sửa role owner | 400 R002 |
| Xóa role owner/default | 400 R004 |
| Xóa role đang có member | 409 R005 |
| Thêm member thiếu role | 400 R007 |
| Gán role owner | 400 R008 |
| Trùng member | 400 T002 |
| Đổi role owner | 400 T003 |
| Trùng mã chi nhánh | 400 B001 |
| Trùng subdomain | 400 T001 |

### 3.7. Revocation — cách xử lý chi tiết

**Kịch bản quyền:**

1. Tạo role có `staff.view + staff.create`.
2. Gán member, login → token cũ.
3. Gọi `POST members` body `{}` → 422 (chứng tỏ có quyền).
4. Owner PATCH role bỏ `staff.create`.
5. Gọi lại bằng token cũ → **kỳ vọng 403**.
6. Login lại → token mới → **403**.

**Kịch bản chi nhánh:**

1. User chỉ có A2, login → token cũ.
2. Đọc A2 settings → 200.
3. Owner đổi `branchIds` sang A1.
4. Đọc lại A2 bằng token cũ → **kỳ vọng 404**.
5. Login lại → token mới → 404.

**Thực tế:** bước 5 của quyền trả **422**, bước 4 của chi nhánh trả **200** → 2 defect.
Nguyên nhân: quyền/phạm vi nằm trong JWT; guard không tra lại DB; ADR-0020 chấp nhận trễ tới
1 ngày.

### 3.8. Regression — cách xử lý

Chạy lại test có sẵn, không viết mới:

```bash
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "api/(role|tenant|branch)"

npx pnpm@9.12.3 exec jest --runInBand --testPathPattern "libs/auth"
```

Kết quả: **27 suite / 407 test pass**. Các test này dùng repository giả lập nên không phát hiện
được 2 defect token ở trên — đó là lý do cần bộ Newman.

---

## 4. Kết quả và defect

| Chỉ số | Giá trị |
|---|---:|
| Test case | 118 |
| Passed | 116 |
| Failed | 2 |
| Assertion | 353 |
| Assertion lỗi | 3 |
| Thời gian | 9,46 giây |
| Run ID | `secmwjfi30x1c1f` |

**DEF-SEC-01 — Thu hồi quyền không có hiệu lực ngay**

- Test: `TC-SEC-REV-03`.
- Kỳ vọng: 403; thực tế: 422.
- Ý nghĩa: token cũ vẫn dùng được `staff.create` sau khi quyền bị bỏ.

**DEF-SEC-02 — Đổi phạm vi chi nhánh không có hiệu lực ngay**

- Test: `TC-SEC-REV-08`.
- Kỳ vọng: 404; thực tế: 200.
- Ý nghĩa: token cũ vẫn đọc được dữ liệu chi nhánh A2 sau khi bị chuyển sang A1.

**Đề xuất:** thêm `permVersion`/`branchVersion` vào token hoặc thu hồi session khi role/member
đổi; rút ngắn TTL access token.

---

## 5. Cách trình bày 3 phút (nếu bị giới hạn thời gian)

1. **Tool:** “Em dùng Postman để thiết kế, Newman để chạy tự động, script Node để tạo dữ liệu
   và token.”
2. **Cách làm:** “Em lập bảng quyết định 6 vai trò × 5 thao tác, mỗi ô là một request; dữ liệu
   được tạo mới mỗi lần chạy nên repeatable.”
3. **Kết quả:** “118 case, 116 pass; 2 fail là hai defect thật: token cũ vẫn giữ quyền và
   phạm vi chi nhánh sau khi bị thu hồi/đổi.”

---

## 6. Câu chốt nếu chỉ được nói 1 câu

> “Bộ test dùng Postman/Newman, tự sinh 2 tenant và token từng vai trò, phủ 118 case RBAC và
> cô lập tenant/chi nhánh; 116 pass, 2 fail là hai lỗi Major về thu hồi quyền tức thời.”
