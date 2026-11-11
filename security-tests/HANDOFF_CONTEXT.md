# HANDOFF CONTEXT — Luồng 1: Bảo mật & Phân quyền API

**Người thực hiện:** Thịnh
**Ngày:** 11/11/2026
**Phạm vi:** RBAC theo vai trò (FR-M02-05, FR-M02-06, NFR-SE-04) và cô lập tenant/chi nhánh (FR-M02-07, BR-01, NFR-SE-03)
**Công cụ:** Postman Collection + Newman 6.2.3 (Node.js), báo cáo JSON + HtmlExtra

Tài liệu này đủ để một người khác (đồng đội hoặc giảng viên) chạy lại **toàn bộ** bộ test
từ máy sạch, đọc kết quả và phân biệt lỗi sản phẩm với lỗi môi trường.

---

## 1. Bộ test gồm những gì

| Tệp / thư mục | Nội dung |
|---|---|
| `security-rbac.postman_collection.json` | 118 test case, chia 8 nhóm: Preconditions, Authentication, RBAC matrix (6 vai trò × 5 thao tác), RBAC bổ sung, Vai trò & mã lỗi 400/409, Tenant isolation, Branch isolation, Revocation |
| `provision.mjs` | Tự tạo dữ liệu: 2 tenant A/B, 2 chi nhánh A1/A2, 1 chi nhánh B1, 6 loại vai trò, 11 tài khoản (10 ở tenant A, 1 ở tenant B), token riêng cho từng vai trò, 1 sản phẩm + 1 khách hàng của tenant A; ghi `results/security-environment.json` |
| `build-collection.mjs` | Sinh collection từ bảng quyết định; chạy lại khi sửa kỳ vọng |
| `run.mjs` | Chạy provision + Newman + sinh summary; hỗ trợ `--gateway`, `--skip-provision`, `--strict`, `--no-html` |
| `report-cases.mjs` | Sinh bảng chi tiết test case từ `newman.json` (đã bỏ token) |
| `results/` | Kết quả lần chạy gần nhất; `results/history/<runId>/` lưu từng lần |
| `BAO_CAO_KIEM_THU_LUONG1.md` | Báo cáo ISTQB v4 đầy đủ |

**Nguyên tắc dữ liệu:** mỗi lần chạy sinh `runId` mới, email/subdomain/mã chi nhánh đều
chứa `runId`. Không xóa dữ liệu cũ, không sửa dữ liệu tenant khác, nên chạy lại nhiều lần
không đụng nhau. Không có thao tác nào nhắm vào dữ liệu có sẵn của môi trường.

---

## 2. Tiền điều kiện

### 2.1 Phần mềm

| Thành phần | Phiên bản đã dùng | Ghi chú |
|---|---|---|
| Node.js | 24.21.0 | Đúng `.nvmrc` = 24; Newman 6.2.3 chạy trên Node 18+ |
| npm | 11.19.0 | `npm ci` trong `security-tests/` |
| Docker Desktop + Compose | Docker 29.8.1 / Compose v5.5.1 | Stack local của `pbl-api` |
| Git Bash + curl | — | Chạy `scripts/verify-local-stack.sh` trên Windows |
| Trình duyệt | Chrome/Edge | Mở `results/report.html` |

### 2.2 Stack `pbl-api`

Từ thư mục gốc repo `pbl-api`:

```bash
docker compose up -d --build
bash scripts/verify-local-stack.sh      # phải kết thúc bằng "Stack verified."
```

Các cổng phải mở:

| Cổng | Thành phần | Dùng bởi bộ test |
|---:|---|---|
| 8080 | KrakenD gateway | Chế độ `--gateway` (khuyến nghị) |
| 3000 | platform | Chế độ direct (fallback) |
| 3001–3004 | catalog, inventory, sales, customer | Chế độ direct (fallback) |
| 25432 | PostgreSQL 16 | `provision.mjs` nâng quota gói Free |
| 6379 | Redis | Thu hồi token/session (logout, lock) |
| 9324 | ElasticMQ | Đăng ký tài khoản (queue email-verification) |

Kiểm tra nhanh:

```bash
curl -s http://localhost:8080/platform/health
curl -s http://localhost:8080/platform/.well-known/jwks.json
```

### 2.3 Biến môi trường

Stack dùng `.env.docker.platform` đã commit sẵn (gồm khóa RSA local-only). Không cần tạo
`.env` mới. Nếu đổi `POSTGRES_HOST_PORT`, đặt `PBL_DB_PORT` tương ứng khi chạy provision.

---

## 3. Cài đặt bộ test

```bash
cd pbl-api/security-tests
npm ci
```

`npm ci` cài Newman, `newman-reporter-htmlextra` và `pg` vào `security-tests/node_modules`.
Không cần cài global, không sửa `package.json` của repo chính.

---

## 4. Điều chỉnh quota gói Free (bắt buộc, tự động)

Bộ test cần **2 chi nhánh** và **10 tài khoản trong tenant A** (cộng owner B ở tenant B), trong khi gói Free mặc
định chỉ cho **1 chi nhánh / 3 người dùng** (`apps/platform/src/api/subscription/default-plans.ts`).
`provision.mjs` tự chạy câu lệnh sau qua cổng 25432 trước khi tạo dữ liệu:

```sql
UPDATE platform.plan
   SET quota_branches = GREATEST(quota_branches, 10),
       quota_users    = GREATEST(quota_users, 50)
 WHERE code = 'free';
```

Đây là **điều chỉnh môi trường kiểm thử**, không sửa mã nguồn và không đổi logic sản phẩm.
Nếu không kết nối được DB, provision in cảnh báo; khi đó tạo chi nhánh thứ hai hoặc thành
viên thứ tư sẽ trả `409 Q001` (`quota.error.limit_reached`).

Khôi phục mặc định sau khi chấm:

```sql
UPDATE platform.plan SET quota_branches = 1, quota_users = 3 WHERE code = 'free';
```

Tùy chọn kết nối DB khác: `PBL_DB_HOST`, `PBL_DB_PORT`, `PBL_DB_USER`, `PBL_DB_PASSWORD`,
`PBL_DB_NAME` (mặc định `127.0.0.1:25432`, `postgres/postgres`, db `pbl`).

---

## 5. Chạy test

### 5.1 Cách chuẩn — qua KrakenD gateway

```bash
cd pbl-api/security-tests
npm test -- --gateway http://localhost:8080
```

Lệnh này tương đương:

1. `provision.mjs` gọi API qua gateway để tạo tenant/chi nhánh/vai trò/tài khoản.
2. Ghi `results/security-environment.json` (biến môi trường Postman).
3. `newman run security-rbac.postman_collection.json -e results/security-environment.json`.

### 5.2 Cách dự phòng — gọi thẳng từng service

Dùng khi chưa dựng được gateway nhưng 5 service đang chạy ở cổng 3000–3004:

```bash
npm test
```

`run.mjs` tự chọn base URL direct. Đây là chế độ đã dùng để tạo bằng chứng trong báo cáo
(xem mục 9), vì máy chạy không bật được Docker Desktop.

### 5.3 Các tùy chọn

| Lệnh | Ý nghĩa |
|---|---|
| `npm test -- --skip-provision` | Dùng lại `results/security-environment.json` (token còn hạn); không tạo dữ liệu mới |
| `npm test -- --strict` | Trả mã lỗi 1 nếu còn bất kỳ test case Failed (dùng cho CI) |
| `npm test -- --no-html` | Không sinh HTML, chỉ JSON + CLI |
| `npm run build` | Chỉ sinh lại collection + environment example |
| `npm run provision` | Chỉ tạo dữ liệu, không chạy test |

### 5.4 Chạy Newman thuần (không qua `run.mjs`)

```bash
cd pbl-api/security-tests
node provision.mjs --gateway http://localhost:8080

npx newman run security-rbac.postman_collection.json \
  -e results/security-environment.json \
  -r cli,json,htmlextra \
  --reporter-json-export results/newman.json \
  --reporter-htmlextra-export results/report.html
```

Chạy một nhóm:

```bash
npx newman run security-rbac.postman_collection.json \
  -e results/security-environment.json \
  --folder "02 — RBAC decision table: 6 vai trò × 5 thao tác"
```

Lưu ý: Newman thuần **không** tự sinh `results/summary.md`; dùng `npm test` để có đầy đủ
summary và lưu lịch sử.

---

## 6. Dữ liệu test được tạo

Mỗi lần chạy (`runId` dạng `sec...`) tạo:

| Đối tượng | Giá trị |
|---|---|
| Tenant A | `Security Store A <runId>`, subdomain `sec-a-<runId>` |
| Tenant B | `Security Store B <runId>`, subdomain `sec-b-<runId>` |
| Chi nhánh A1 | Mặc định khi tạo tenant, mã `CN01` |
| Chi nhánh A2 | Tạo thêm, mã `A2` |
| Chi nhánh B1 | Mặc định của tenant B, mã `CN01` |
| Vai trò | 5 vai trò seed (owner, branch_manager, sales_staff, warehouse_staff, accountant) + 4 vai trò tùy chỉnh: `Custom Viewer` (6 quyền xem), `Branch Admin` (settings.view/update), `Revoke Demo` (staff.view/create), `Unused` |
| Tài khoản A | owner, manager (branch_manager, chỉ A2), sales (sales_staff, mọi chi nhánh), warehouse, accountant, custom, branchAdmin (chỉ A2), scopee (chỉ A2), revokee, lockee |
| Tài khoản B | owner B (chỉ tenant B) |
| Dữ liệu nghiệp vụ | 1 sản phẩm + 1 khách hàng của tenant A (dùng cho test IDOR) |

Email dạng `sec.<vai trò>.<runId>@example.test`; mật khẩu `Passw0rd!` (nằm trong biến
`testPassword` của environment, chỉ là dữ liệu giả).

Token được lấy bằng đăng nhập thật, không giả lập. Token hết hạn được ký bằng khóa local
trong `.env.docker.platform` với `exp` trong quá khứ; token bị sửa chữ ký được tạo từ token
thật.

---

## 7. Đọc kết quả

### 7.1 Nơi xem

| Tệp | Nội dung |
|---|---|
| `results/summary.md` | Bảng tổng hợp theo nhóm + từng case Passed/Failed (không chứa token) |
| `results/cases-table.md` | Bảng chi tiết: ID, mô tả, method/path, dữ liệu chính, mong đợi, thực tế |
| `results/report.html` | Báo cáo Newman HtmlExtra: request/response, assertion, thời gian |
| `results/history/<runId>/` | Bản lưu của từng lần chạy |
| `results/security-environment.json` | Biến môi trường **có token** — không commit, không gửi công khai |

### 7.2 Kết quả tham chiếu

Hai lần chạy độc lập trên stack local (direct mode):

| Run ID | Test case | Passed | Failed | Assertion | Thời gian |
|---|---:|---:|---:|---:|---:|
| `secmwc1anew900c` | 118 | 116 | 2 | 353 (3 failed) | 7.06 s |
| `secmwc1avod307c` | 118 | 116 | 2 | 353 (3 failed) | 7.30 s |

Hai ca Failed là **DEF-SEC-01** (`TC-SEC-REV-03`) và **DEF-SEC-02** (`TC-SEC-REV-08`),
đúng như thiết kế của bộ test: chúng kiểm tra yêu cầu thu hồi quyền tức thời.

### 7.3 Ý nghĩa mã HTTP trong bộ test

| Mã | Ý nghĩa | Ví dụ trong bộ test |
|---:|---|---|
| 200 | Hợp lệ, đọc/cập nhật thành công | owner xem sản phẩm; sales sửa khách hàng; manager xem cài đặt A2 |
| 201 | Tạo thành công | tạo tenant, chi nhánh, vai trò, thành viên, sản phẩm, khách hàng |
| 204 | Xóa thành công, không body | xóa vai trò `Unused` |
| 400 | Lỗi nghiệp vụ có `errorCode` | `R001` trùng tên vai trò, `R003` quyền không tồn tại, `R007` thiếu role, `R008` gán owner, `T002` trùng thành viên, `T003` đổi owner, `B001` trùng mã chi nhánh, `T001` trùng subdomain |
| 401 | Chưa xác thực / token không hợp lệ / hết hạn / đã thu hồi | không token; token bị sửa; token hết hạn; sau logout; sau lock |
| 403 | Đã xác thực nhưng thiếu quyền | sales xóa khách hàng; kế toán tạo đơn; manager thêm nhân viên; scoped user tạo chi nhánh (`B008`) |
| 404 | Không tìm thấy **hoặc** ngoài phạm vi tenant/chi nhánh (cố ý không lộ sự tồn tại) | tenant B đọc sản phẩm/khách hàng/chi nhánh/vai trò của A; manager đọc A1 |
| 409 | Xung đột trạng thái | `R001` trùng tên vai trò; `R005` xóa vai trò đang có thành viên |
| 422 | Dữ liệu sai định dạng/thiếu trường (DTO) | tạo sản phẩm body rỗng; mã chi nhánh sai regex; đăng nhập thiếu email |
| 410 | Endpoint nhập kho cũ đã bị bỏ | `POST /stock-receipts` không có `warehouseId` (không dùng trong bộ test) |

**Quy tắc phân biệt quan trọng:** với một thao tác mà vai trò **có** quyền, request được đi
tiếp vào validate nghiệp vụ nên trả `422`/`404` (tùy dữ liệu); với vai trò **không có**
quyền, guard trả `403` trước khi chạm dữ liệu. Vì vậy bảng quyết định dùng `422`/`404` làm
"được phép", và `403` làm "bị chặn". Đừng nhầm `422` là lỗi phân quyền.

**403 và 404:** với chi nhánh ngoài phạm vi, hệ thống trả `404` (không phải `403`) để không
lộ chi nhánh đó tồn tại — đúng thiết kế ADR-0020. Đây là kỳ vọng của các ca `TC-SEC-BRA-*`
và `TC-SEC-TEN-*`.

### 7.4 Phân loại khi có ca Failed

| Dấu hiệu | Kết luận |
|---|---|
| Failed đúng `TC-SEC-REV-03` / `TC-SEC-REV-08` với HTTP thực tế `422` / `200` | Defect đã biết (DEF-SEC-01/02), không phải lỗi môi trường |
| Nhiều ca cùng `401` | Token hết hạn (provision cũ), stack/gateway restart, hoặc Redis mất deny-list; chạy lại `npm test` |
| Nhiều ca cùng `404` ở mọi service | Sai base URL/gateway route; kiểm tra `--gateway` và `docker compose restart krakend` |
| `409 Q001` khi provision | Chưa nâng quota; xem mục 4 |
| `ECONNREFUSED` | Stack chưa lên đủ cổng; xem mục 2.2 |
| `422` ở bước provision | Dữ liệu test không hợp lệ hoặc phiên bản API khác; xem log provision |

---

## 8. Chạy lại các test Jest hiện có (bằng chứng bổ sung)

```bash
cd pbl-api

# RBAC, tenant, branch của platform (18 suite, 310 test)
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "api/(role|tenant|branch)"

# Guard, token verifier, branch scope của @pbl/auth (8 suite, 93 test)
npx pnpm@9.12.3 exec jest --runInBand --testPathPattern "libs/auth"

# Quota service (1 suite, 4 test) — phải dùng config platform vì có alias @/
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "subscription/quota.service"
```

Kết quả đã ghi trong báo cáo: **18 suite / 310 test pass**, **8 suite / 93 test pass**,
**1 suite / 4 test pass**. Các test này chạy với repository giả lập, không thay thế bộ
Newman; chúng không phát hiện lỗi thu hồi token vì không kiểm tra token còn hạn sau khi đổi
quyền.

---

## 9. Kết quả thực tế của lần bàn giao

- Chế độ chạy: **direct** (platform 3000, catalog 3001, inventory 3002, sales 3003,
  customer 3004). Lý do: máy chạy không khởi động được Docker Desktop/WSL nên không có
  KrakenD ở 8080. Cùng collection này chạy qua gateway bằng `--gateway` mà không sửa gì.
- Ngày chạy: 11/11/2026 (Asia/Bangkok).
- Kết quả: 118 test case, **116 Passed**, **2 Failed** (DEF-SEC-01, DEF-SEC-02),
  **353 assertion**, 3 assertion lỗi, ~7,1–7,3 giây/lần.
- Hai lần chạy lặp lại cho cùng kết quả (xem mục 7.2), chứng minh tính repeatable.

Chi tiết và phân tích: `BAO_CAO_KIEM_THU_LUONG1.md`.

---

## 10. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `409 Q001` khi tạo chi nhánh/thành viên | Gói Free còn 1/3 | Chạy lại `npm test` để provision nâng quota; hoặc chạy SQL mục 4 |
| `401` toàn bộ sau khi chạy lại | Token trong environment cũ đã hết hạn/khác tenant | `npm test` (provision mới), đừng `--skip-provision` |
| `404` mọi route qua gateway | KrakenD chưa nạp `krakend.json` hoặc thiếu route | `docker compose restart krakend`; kiểm tra route trong `krakend/krakend.json` |
| `403` ngay ở bước provision | Seed 5 vai trò thiếu (DB cũ) | `docker compose down -v && docker compose up -d --build` |
| `ECONNREFUSED 127.0.0.1:3000` | Chưa chạy stack / sai cổng | `docker compose ps`; dùng `--gateway` hoặc kiểm tra `PLATFORM_HOST_PORT` |
| `database "pbl" does not exist` | Volume Postgres cũ | `docker compose down -v` rồi lên lại |
| `password authentication failed` khi provision | Sai `PBL_DB_*` | Đặt đúng biến môi trường; mặc định `postgres/postgres` |
| Newman báo `E404` khi tải reporter | Chưa `npm ci` | Chạy `npm ci` trong `security-tests/` |
| HTML không mở được | Chưa cài htmlextra | `npm ci`; hoặc chạy `--no-html` |

---

## 11. Bảo mật dữ liệu test

- `results/security-environment.json`, `results/provisioning.json`, `results/newman.json`,
  `results/report.html`, `results/history/` chứa **access token thật** (hạn 1 ngày) và
  Authorization header. Đã nằm trong `.gitignore`; **không commit, không gửi công khai**.
- Chỉ commit `results/summary.md` và `results/cases-table.md` (không có token).
- Tài khoản/tenant đều là dữ liệu giả sinh tự động; không dùng email/thông tin cá nhân thật.
- Khóa RSA trong `.env.docker.platform` là khóa local-only đã commit trong repo, không dùng
  cho production.

---

## 12. Checklist trước khi nộp

- [ ] `docker compose ps` đủ 8 service + gateway, `verify-local-stack.sh` in "Stack verified."
- [ ] `npm ci` trong `security-tests/` thành công.
- [ ] `npm test -- --gateway http://localhost:8080` chạy hết 118 case.
- [ ] `results/summary.md` có 116 Passed / 2 Failed đúng DEF-SEC-01/02.
- [ ] Mở `results/report.html` xem được.
- [ ] Đã chạy lại 3 lệnh Jest ở mục 8.
- [ ] Không commit `results/security-environment.json`, `newman.json`, `report.html`,
      `results/history/`.
- [ ] Đã khôi phục quota Free (nếu dùng máy chung).
