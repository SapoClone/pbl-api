# TRƯỜNG ĐẠI HỌC BÁCH KHOA
## KHOA CÔNG NGHỆ THÔNG TIN

# SOFTWARE TEST DOCUMENTATION
### (ISTQB v4 Standard & AI Integrated)

## Nền tảng SaaS quản trị bán lẻ đa kênh
## Luồng 1: Bảo mật và Phân quyền (Security & Authorization Testing)

**Sinh viên thực hiện:** Thịnh
**Đà Nẵng, 11 - 2026**

---

# Mục lục

- [I. Record of Changes](#i-record-of-changes)
- [II. Testing Documentation](#ii-testing-documentation)
  - [1. Scope of Testing](#1-scope-of-testing)
  - [2. Test Strategy & Approach](#2-test-strategy--approach)
  - [3. Test Plan](#3-test-plan)
  - [4. Static Testing - Cross-Review Log](#4-static-testing---cross-review-log)
  - [5. Test Cases & Reports](#5-test-cases--reports)
    - [5.1 Tổng hợp kết quả](#51-tổng-hợp-kết-quả)
    - [5.2 Danh sách test case và kết quả thực tế](#52-danh-sách-test-case-và-kết-quả-thực-tế)
    - [5.3 Ma trận truy vết](#53-ma-trận-truy-vết-test-case--fr--br--nfr)
    - [5.4 Báo cáo lỗi](#54-báo-cáo-lỗi-defect-report)
    - [5.5 Kết quả chạy lại các test hiện có](#55-kết-quả-chạy-lại-các-test-hiện-có)
    - [5.6 Cách chạy lại test](#56-cách-chạy-lại-test)
    - [5.7 Bằng chứng thực thi](#57-bằng-chứng-thực-thi)
- [Kết luận](#kết-luận)
- [Phụ lục A — Dữ liệu kiểm thử](#phụ-lục-a--dữ-liệu-kiểm-thử)
- [Phụ lục B — Môi trường và công cụ](#phụ-lục-b--môi-trường-và-công-cụ)

---

# I. Record of Changes

| Ngày | A/M/D | Người thực hiện | Mô tả thay đổi |
|---|---|---|---|
| 11/11/2026 | A | Thịnh | Khởi tạo tài liệu kiểm thử Luồng 1: phạm vi RBAC và cô lập tenant/chi nhánh; xác định yêu cầu FR-M02-05, FR-M02-06, FR-M02-07, NFR-SE-03, NFR-SE-04, BR-01 |
| 11/11/2026 | A | Thịnh | Thiết kế bảng quyết định 6 vai trò × 5 thao tác; viết Postman Collection 118 test case và script tự tạo dữ liệu `provision.mjs` |
| 11/11/2026 | A | Thịnh | Thực thi Newman 2 lần độc lập trên stack local; ghi nhận 116/118 Passed, 2 Failed; lưu JSON, HTML, summary |
| 11/11/2026 | A | Thịnh | Bổ sung báo cáo lỗi DEF-SEC-01, DEF-SEC-02; ma trận truy vết; chạy lại 27 suite Jest hiện có (407 test) |
| 11/11/2026 | A | Thịnh | Hoàn thiện HANDOFF_CONTEXT.md và hướng dẫn Git CLI |

*Ghi chú: A – Added, M – Modified, D – Deleted.*

---

# II. Testing Documentation

## 1. Scope of Testing

### a. In-scope (Trong phạm vi kiểm thử)

Luồng 1 trong kế hoạch kiểm thử nhóm: **Bảo mật và Phân quyền ở tầng API**, theo mô hình
Test Diamond (tầng API/integration dày nhất). Phạm vi gồm đúng hai chức năng được phân công:

| Loại kiểm thử | Chức năng | Nội dung kiểm tra |
|---|---|---|
| API (Postman + Newman) | **Phân quyền theo vai trò (RBAC)** | Ma trận 6 vai trò × 5 thao tác (xem, thêm, sửa, xóa, duyệt) trên module sản phẩm và duyệt phiếu nhập kho; 5 vai trò mặc định + 1 vai trò tùy chỉnh; chặn 401/403/400/409; quản lý vai trò tùy chỉnh; thu hồi quyền tức thời |
| API (Postman + Newman) | **Cô lập dữ liệu theo Tenant và Chi nhánh** | Tenant A không đọc/sửa/xóa được dữ liệu Tenant B và ngược lại; IDOR trên sản phẩm, khách hàng, chi nhánh, vai trò, thành viên; branch scope trả 404; chèn tenantId vào body/query/header không có tác dụng; switch-tenant trái phép |
| Kiểm thử hiện có (Jest) | Guard, token, RBAC, tenant, branch, quota | Chạy lại làm bằng chứng bổ sung, **không viết mới, không sửa** test của repo |

**Yêu cầu liên quan (SRS v1.1):** FR-M02-05, FR-M02-06, FR-M02-07, NFR-SE-03, NFR-SE-04, BR-01.

### b. Out-of-Scope (Ngoài phạm vi kiểm thử)

- Các luồng 2, 3, 4, 5 do thành viên khác phụ trách (chỉ ghi chú chéo khi cần).
- Kiểm thử giao diện web/mobile: Luồng 1 kiểm ở tầng API; không kiểm hành trình UI.
- Kiểm thử tải, spike, stress (NFR-PF-02) và kiểm thử xâm nhập chuyên sâu (pentest).
- Kiểm thử hạ tầng AWS thật (SNS/SQS, RDS, ECS); môi trường dùng PostgreSQL/Redis/ElasticMQ cục bộ.
- Nghiệp vụ của catalog/inventory/sales/customer ngoài khía cạnh phân quyền (ví dụ tính tồn, giá vốn, chiết khấu).
- Rà soát toàn bộ mã nguồn; chỉ đối chiếu các tệp liên quan trực tiếp đến xác thực, phân quyền, tenant và branch.

### c. Assumptions & Constraints (Giả định và ràng buộc)

- Yêu cầu và quy tắc nghiệp vụ lấy từ SRS v1.1 và bảng phân công Testing Scenario v2.
- “Thu hồi quyền ngay lập tức” là yêu cầu kiểm thử của Luồng 1: sau khi chủ cửa hàng bỏ quyền
  hoặc đổi phạm vi chi nhánh, token cũ còn hạn **không được** tiếp tục thực hiện thao tác.
  Đây là điểm xung đột với ADR-0020 (xem mục 4) và là cơ sở của DEF-SEC-01/02.
- Stack local: 8 service NestJS, PostgreSQL 16, Redis, ElasticMQ, KrakenD 2.6.3. Bằng chứng
  trong báo cáo được chạy ở **chế độ direct** (platform 3000, catalog 3001, inventory 3002,
  sales 3003, customer 3004) vì máy chạy không khởi động được Docker Desktop/WSL; cùng
  collection chạy được qua gateway bằng `--gateway http://localhost:8080` mà không sửa test.
- Mỗi lần chạy tạo dữ liệu mới (2 tenant, 2 chi nhánh, 11 tài khoản: 10 ở tenant A và 1 ở tenant B, 4 vai trò tùy chỉnh),
  dùng `runId` duy nhất; không xóa dữ liệu cũ và không sửa dữ liệu có sẵn.
- Gói Free mặc định giới hạn 1 chi nhánh / 3 người dùng. Bộ test **tự nâng** hạn mức trong
  bảng `platform.plan` lên 10 chi nhánh / 50 người dùng (chỉ dữ liệu môi trường, không sửa
  mã nguồn). Đây là điều kiện cần để dựng đủ 2 chi nhánh và 10 tài khoản trong tenant A.
- Access token có TTL 1 ngày (`AUTH_JWT_TOKEN_EXPIRES_IN=1d`); refresh token 365 ngày.
- Không kiểm thử email thật; địa chỉ dùng `@example.test`, mật khẩu giả `Passw0rd!`.

---

## 2. Test Strategy & Approach

### 2.1 Testing Types

| Loại | Mục tiêu | Kỹ thuật / kiểm tra | Bằng chứng hoàn thành |
|---|---|---|---|
| Functional API — RBAC | Xác minh mỗi vai trò chỉ làm được đúng thao tác được cấp | **Decision Table** 6 vai trò × 5 thao tác; black-box; so khớp `DEFAULT_ROLE_PERMISSIONS` trong `libs/contracts/src/permissions.ts` | 30 test case `TC-SEC-RBAC-01..30`; 30/30 Passed |
| Security — Authentication | Token thiếu/sai/hết hạn/bị sửa/bị thu hồi phải bị chặn | Token tampering, expired token ký bằng khóa local, Basic auth, logout, lock | 9 test case `TC-SEC-AUTH-01..09`; 9/9 Passed |
| Security — Authorization | Không leo thang quyền; không tin header/body/query do client gửi | Gọi thẳng API bằng token từng vai trò; không dựa vào ẩn nút UI | 16 test case `TC-SEC-X-01..16`; 16/16 Passed |
| Role management | Vai trò tùy chỉnh, mã lỗi 400/409, không sửa/xóa owner, không xóa vai trò đang dùng | CRUD vai trò; biên mã quyền; xung đột tên; ràng buộc owner | 19 test case `TC-SEC-ROLE-01..19`; 19/19 Passed |
| Isolation — Tenant | Tenant B không đọc/sửa/xóa dữ liệu tenant A; danh sách không lẫn; không lộ tồn tại | IDOR trên ID sản phẩm/khách hàng/chi nhánh/vai trò/thành viên; switch-tenant; chèn `tenantId` vào body/query/header | 20 test case `TC-SEC-TEN-01..20`; 20/20 Passed |
| Isolation — Branch | Người bị giới hạn chi nhánh chỉ thấy/làm việc trong phạm vi; ngoài phạm vi 404 | Token có `branches=[A2]`; đọc/sửa A1 và A2; context; tạo chi nhánh | 10 test case `TC-SEC-BRA-01..10`; 10/10 Passed |
| Revocation | Thu hồi quyền/phạm vi phải có hiệu lực ngay với token cũ | Đổi permission của role; đổi `branchIds` của member; so token cũ và token mới | 10 test case `TC-SEC-REV-01..10`; 8 Passed, **2 Failed** (DEF-SEC-01/02) |
| Regression (Jest có sẵn) | Guard/token/RBAC/tenant/branch/quota vẫn đạt | Chạy lại 27 suite hiện có | 407 test Passed |

### 2.2 Bảng quyết định (Decision Table)

Bảng dưới đây là **kỳ vọng** dùng để sinh test case. `A` = được phép (request đi tiếp và
trả 200/422/404 tùy dữ liệu); `D` = bị chặn (403).

| Vai trò | Xem sản phẩm<br>`products.view` | Tạo sản phẩm<br>`products.create` | Sửa sản phẩm<br>`products.update` | Xóa sản phẩm<br>`products.delete` | Duyệt phiếu nhập<br>`inventory.approve` |
|---|:---:|:---:|:---:|:---:|:---:|
| owner | A (200) | A (422) | A (404) | A (404) | A (404) |
| branch_manager | A (200) | A (422) | A (404) | A (404) | A (404) |
| sales_staff | A (200) | D (403) | D (403) | D (403) | D (403) |
| warehouse_staff | A (200) | D (403) | D (403) | D (403) | D (403) |
| accountant | D (403) | D (403) | D (403) | D (403) | D (403) |
| custom (chỉ 6 quyền xem) | A (200) | D (403) | D (403) | D (403) | D (403) |

**Vì sao 422/404 là “được phép”?** Với vai trò có quyền, request vượt qua guard và đi vào
validate/nghiệp vụ. Body `{}` hoặc UUID ngẫu nhiên không tồn tại nên trả 422/404. Với vai
trò không có quyền, guard trả 403 **trước khi** chạm dữ liệu. Đây là dấu hiệu phân biệt
“được đi tiếp” và “bị chặn”, không phải lỗi chức năng.

**Pairwise:** Ma trận đầy đủ chỉ có 6 × 5 = 30 tổ hợp, nhỏ hơn ngưỡng cần lấy mẫu, nên nhóm
chạy **toàn bộ 30 tổ hợp** thay vì pairwise. Cách này cho coverage 100% bảng quyết định và
vẫn chạy chỉ ~6 giây.

### 2.3 Test Levels Matrix (Test Diamond)

| Tầng | Bộ test | Số test | Vai trò |
|---|---|---:|---|
| E2E giao diện (đỉnh) | Không có — ngoài phạm vi Luồng 1 | 0 | — |
| Tích hợp / API (giữa, dày nhất) | Newman: 118 test case; gọi 5 service thật, DB thật, Redis/ElasticMQ thật | 118 | Hành vi thật: guard, token, tenant, branch, role |
| Unit (đáy, mỏng — chạy lại) | Jest có sẵn: platform role/tenant/branch, `@pbl/auth`, quota | 407 | Quy tắc thuần, không thay thế API test |

Tỷ trọng API = 118/118 test case do nhóm viết (100%), phù hợp Test Diamond cho một luồng bảo mật
thuần API. Các test Jest chỉ chạy lại, không tính vào số test nhóm viết.

### 2.4 Supporting Tools

| Mục đích | Công cụ | Phiên bản / bằng chứng |
|---|---|---|
| API test | Postman Collection + Newman | Newman 6.2.3; collection `security-rbac.postman_collection.json`; 118 request |
| Báo cáo | `newman-reporter-htmlextra` + JSON | `results/report.html`, `results/newman.json` |
| Runtime | Node.js | v24.21.0 (đúng `.nvmrc` = 24) |
| Backend | 5 service NestJS: platform, catalog, inventory, sales, customer | Chạy trực tiếp trên Windows |
| Database | PostgreSQL | 16.9 (Windows x64 binaries) |
| Cache/session | Redis | 5.0.14 (Windows port) — dùng cho deny-list logout/lock |
| Queue | ElasticMQ | 1.7.1 (Java 17) — thay SQS local |
| Gateway (chế độ chuẩn) | KrakenD | 2.6.3 trong Docker Compose; không dùng ở lần chạy bằng chứng |
| Regression | Jest + ts-jest | 29.7.0; 27 suite / 407 test |

### 2.5 Risk-Based Testing (RBT)

| Risk ID | Mô tả rủi ro | L | I | Mức | Biện pháp / test case |
|---|---|---:|---:|---|---|
| R-01 | Token cũ vẫn giữ quyền sau khi bị thu hồi — leo thang quyền trong tối đa 1 ngày | 4 | 5 | **20 — Cao** | TC-SEC-REV-01..05, đặc biệt REV-03 |
| R-02 | Token cũ vẫn giữ phạm vi chi nhánh sau khi đổi `branchIds` | 4 | 4 | **16 — Cao** | TC-SEC-REV-06..10, đặc biệt REV-08 |
| R-03 | Rò rỉ dữ liệu giữa tenant bằng token hợp lệ (IDOR) | 2 | 5 | **10 — Trung bình-Cao** | TC-SEC-TEN-01..20 |
| R-04 | Vai trò tùy chỉnh được cấp quá nhiều quyền hoặc bỏ qua guard | 2 | 5 | **10 — Trung bình-Cao** | TC-SEC-RBAC-01..30, SETUP-03, X-11, ROLE-01..08 |
| R-05 | Người bị giới hạn chi nhánh đọc/sửa dữ liệu ngoài phạm vi | 3 | 4 | **12 — Cao** | TC-SEC-BRA-01..10 |
| R-06 | Dữ liệu test tích lũy gây nhiễu hoặc chạy lại thất bại | 3 | 3 | **9 — Trung bình** | `runId` duy nhất; 2 lần chạy lặp lại cho cùng kết quả |

### 2.6 AI Usage & Integrity Declaration

| Mục đích sử dụng AI | Có / Không | Ghi chú |
|---|---|---|
| Hỗ trợ lên ý tưởng / sinh test case | Có | AI hỗ trợ đọc mã nguồn, lập bảng quyết định, sinh khung test case |
| Hỗ trợ viết mã automation | Có | AI sinh `provision.mjs`, collection, `run.mjs`; tác giả đọc, chạy và chỉnh |
| Phân tích tĩnh / tìm lỗi | Có | AI đối chiếu ADR-0020 và mã nguồn để giải thích root cause |

**Cam kết:** dữ liệu kiểm thử là dữ liệu giả sinh tự động, không có thông tin cá nhân hay
bí mật. Tác giả đã đọc hiểu, chạy thật và chịu trách nhiệm chuyên môn về toàn bộ kịch bản.
Các kết quả trong báo cáo là kết quả chạy thật ngày 11/11/2026 trên stack local; các nhận
định về mã nguồn có dẫn chứng tệp tại mục 4.

---

## 3. Test Plan

### 3.1 Human Resources & Independence Levels

| Thành viên | Vai trò | Mức độc lập | Trách nhiệm |
|---|---|---|---|
| Thịnh | API / Security Tester (Luồng 1) | Mức 1 | Thiết kế bảng quyết định, viết collection, provision dữ liệu, thực thi Newman, ghi nhận defect, chạy lại Jest, viết báo cáo |

### 3.2 Test Environment

| Mục đích | Công cụ / thành phần | Phiên bản |
|---|---|---|
| Hệ điều hành | Windows 11 | 10.0.26200 |
| Runtime | Node.js | 24.21.0 |
| API test | Newman | 6.2.3 |
| Backend | platform, catalog, inventory, sales, customer (NestJS) | Mã nguồn `pbl-api` tại thời điểm 11/11/2026 |
| Database | PostgreSQL | 16.9 |
| Cache | Redis | 5.0.14 (Windows) |
| Queue | ElasticMQ | 1.7.1 |
| Gateway (chuẩn) | KrakenD | 2.6.3 (Docker) |
| Báo cáo | HtmlExtra | 1.23.1 |

**Chế độ chạy bằng chứng:** direct mode (không qua KrakenD). Lý do môi trường: Docker
Desktop không khởi động được trong phiên chạy (WSL bị từ chối quyền), nên 5 service được
chạy trực tiếp trên host với cùng PostgreSQL/Redis/ElasticMQ. Collection dùng biến
`platformBase`, `catalogBase`, … nên khi có gateway chỉ cần đổi biến, không sửa test.

### 3.3 Test Milestones

| Công việc | Bắt đầu | Kết thúc |
|---|---|---|
| Đọc SRS, Testing Scenario v2 và mã nguồn (auth, role, tenant, branch) | 11/11/2026 | 11/11/2026 |
| Thiết kế bảng quyết định và test case | 11/11/2026 | 11/11/2026 |
| Viết collection + provision + run harness | 11/11/2026 | 11/11/2026 |
| Thực thi Newman lần 1, sửa kỳ vọng sai do môi trường | 11/11/2026 | 11/11/2026 |
| Thực thi Newman lần 2 và lần 3 (repeatability) | 11/11/2026 | 11/11/2026 |
| Chạy lại Jest, viết báo cáo và handoff | 11/11/2026 | 11/11/2026 |

### 3.4 Entry and Exit Criteria

#### 3.4.1 Entry Criteria

- SRS v1.1 có FR-M02-05, FR-M02-06, FR-M02-07, NFR-SE-03, NFR-SE-04, BR-01.
- Stack local trả 200 ở `/health` của platform và 4 service; JWKS đọc được.
- PostgreSQL, Redis, ElasticMQ hoạt động; tạo được tenant và đăng nhập.
- Bộ test tự tạo được 2 tenant, 2 chi nhánh, 11 tài khoản (10 ở tenant A, 1 ở tenant B).
- **Thực tế:** đạt đủ; riêng gateway 8080 không dựng được nên dùng direct mode.

#### 3.4.2 Exit Criteria và mức đạt

| Tiêu chí | Kết quả thực tế | Đánh giá |
|---|---|---|
| 100% test case theo kế hoạch được thực thi | 118/118 test case | **Đạt** |
| Pass rate tối thiểu 95% | 116/118 = **98,3%** | **Đạt** |
| 0 lỗi Critical / Blocker | 0 | **Đạt** |
| 0 lỗi Major / High chưa xử lý | **2 lỗi Major** (DEF-SEC-01, DEF-SEC-02) | **Không đạt** |
| Có báo cáo và bằng chứng (JSON, HTML, summary) | `newman.json`, `report.html`, `summary.md`, 2 run ID | **Đạt** |

**Kết luận exit gate:** **Không đạt** vì còn 2 lỗi Major về thu hồi quyền tức thời. Các phần
RBAC, xác thực, cô lập tenant và cô lập chi nhánh đều đạt; cần sửa DEF-SEC-01/02 rồi chạy
lại `TC-SEC-REV-03` và `TC-SEC-REV-08`.

---

## 4. Static Testing - Cross-Review Log

Đối chiếu SRS v1.1, Testing Scenario v2 và mã nguồn `pbl-api`. Dẫn chứng lấy tại thời điểm
kiểm thử (11/11/2026).

| ID | Vị trí / Yêu cầu | Loại (4C) | Mô tả / Dẫn chứng | Khuyến nghị |
|---|---|---|---|---|
| OB-SEC-01 | `docs/decisions/0020-permissions-and-branch-scope.md` dòng 36, 63; FR-M02-06; NFR-SE-04 | **Consistency** | ADR-0020 ghi rõ: “A change to a role or a member applies at the next refresh or sign-in” và “Role and permission edits are not instant: up to the access-token lifetime (1 day today)”. Trong khi yêu cầu kiểm thử của Luồng 1 là thu hồi quyền **ngay**. Đây là xung đột yêu cầu – thiết kế, không phải lỗi coding đơn thuần. | Chốt lại yêu cầu với giảng viên/nhóm: nếu “ngay lập tức” là bắt buộc, phải bổ sung cơ chế version/deny-list cho quyền; nếu chấp nhận trễ, cập nhật SRS và hạ mức DEF-SEC-01/02 thành “known limitation”. |
| OB-SEC-02 | `apps/platform/src/api/role/role.service.ts` dòng 176–211; `member.service.ts` dòng 329–401 | **Completeness** | `RoleService.update` chỉ ghi `role`, `role_permission`; `MemberService.update` chỉ ghi `account_tenant`/`account_tenant_branch`. Không có lời gọi `SessionService.revokeAll`, không tăng `tokenVersion`, không ghi deny-list. Token cũ giữ nguyên `perms`/`branches`. | Khi update role hoặc member: thu hồi session liên quan, hoặc tăng `permVersion`/`branchVersion` trong token và kiểm tra ở guard; hoặc rút ngắn TTL access token + refresh. |
| OB-SEC-03 | `libs/auth/src/auth.guard.ts` dòng 106; `libs/auth/src/auth.helpers.ts` dòng 8–30; `libs/auth/src/access-token.verifier.ts` dòng 82–91 | **Correctness** (thiết kế) | Guard kiểm tra `user.permissions`/`user.branches` lấy từ claim JWT; `canAccessBranch` so trực tiếp mảng `branches` trong token. Không truy vấn DB/Redis để xác nhận quyền hiện tại. Đây là lý do trực tiếp của DEF-SEC-01/02. | Giữ stateless token nhưng thêm cơ chế vô hiệu hóa token cũ (revocation epoch) — không cần query DB mỗi request. |
| OB-SEC-04 | `.env.docker.platform` (`AUTH_JWT_TOKEN_EXPIRES_IN=1d`); `access-token.service.ts` dòng 54, 88–109 | **Completeness** | Access token sống 1 ngày, trong khi pbl-web chưa có refresh. Cửa sổ rủi ro của quyền bị thu hồi lên tới 24 giờ. | Giảm TTL (ví dụ 15 phút) và bật refresh ở client; hoặc buộc refresh khi role/member đổi. |
| OB-SEC-05 | `apps/platform/src/filters/global-exception.filter.ts` dòng 55–57; `APP_DEBUG=true` trong `.env.docker.platform` | **Correctness / Security hygiene** | Khi `app.debug=true`, response lỗi chứa `stack` và `trace` (quan sát thấy ở 401/403/404/422). Ở local là tiện cho debug, nhưng nếu bật ở production sẽ lộ đường dẫn nội bộ, tên class, cấu trúc code. | Đảm bảo `APP_DEBUG=false` ở production; có test cấu hình cho việc này. Không tính là defect của bản chạy local. |
| OB-SEC-06 | `krakend/krakend.json` (auth/validator); `CLAUDE.md` mục Auth rules | **Consistency** | Gateway chỉ xác thực chữ ký/claims; phân quyền thật nằm ở từng service (`@RequirePermission`). Đây là thiết kế đúng (defense in depth), nhưng nghĩa là test phải gọi service/gateway với token thật, không thể tin header `X-Roles` do gateway forward. Bộ test đã làm đúng. | Giữ nguyên; không thêm authorization chỉ ở gateway. |
| OB-SEC-07 | `apps/inventory/src/stock/stock.controller.ts` (`POST /stock-receipts` trả 410 khi thiếu `warehouseId`) | **Clarity** | Endpoint nhập kho cũ đã bị bỏ (D15); tạo phiếu phải gửi `warehouseId` + `items`. Test nào gửi body rỗng sẽ nhận 410 chứ không phải 422. | Ghi rõ trong tài liệu API/test; bộ test dùng body có `warehouseId` + `items` để nhận 404 (được phép) thay vì 410. |
| OB-SEC-08 | `apps/platform/src/api/subscription/default-plans.ts` (free: 1 branch/3 users) | **Completeness** | Bộ test cần 2 chi nhánh + 10 tài khoản trong tenant A, vượt quota Free. Đã nâng quota bằng SQL môi trường, không sửa code. | Ghi rõ trong handoff; cân nhắc dùng tenant/plan test riêng thay vì sửa `free` toàn cục. |

---

## 5. Test Cases & Reports

### 5.1 Tổng hợp kết quả

**Lần chạy chính:** `secmwc1avod307c` — 11/11/2026 — direct mode.

| Nhóm | Số test case | Passed | Failed | Pass rate |
|---|---:|---:|---:|---:|
| 00 — Preconditions (kiểm tra dữ liệu provision) | 4 | 4 | 0 | 100% |
| 01 — Authentication guard (401) | 9 | 9 | 0 | 100% |
| 02 — RBAC decision table (6 vai trò × 5 thao tác) | 30 | 30 | 0 | 100% |
| 03 — RBAC bổ sung theo module | 16 | 16 | 0 | 100% |
| 04 — Vai trò tùy chỉnh & mã lỗi 400/409 | 19 | 19 | 0 | 100% |
| 05 — Cô lập tenant | 20 | 20 | 0 | 100% |
| 06 — Cô lập chi nhánh | 10 | 10 | 0 | 100% |
| 07 — Thu hồi quyền tức thời (revocation) | 10 | 8 | **2** | 80% |
| **Tổng** | **118** | **116** | **2** | **98,3%** |

- **118 request**, **353 assertion**, **3 assertion lỗi**, thời gian **7,30 giây**, độ trễ trung bình 5,8 ms.
- **2 Failed** đúng hai ca được thiết kế để phát hiện lỗi thu hồi quyền: `TC-SEC-REV-03` và
  `TC-SEC-REV-08`; **0 unexpected failure**.
- Lần chạy lặp lại `secmwc1anew900c`: 118 case, 116 Passed, 2 Failed, 353 assertion, 7,06 giây
  — cùng kết quả, chứng minh tính repeatable.

**Kết quả nổi bật:**

- 30/30 tổ hợp RBAC đúng kỳ vọng; không có leo thang quyền theo vai trò.
- 20/20 ca cô lập tenant trả 404/rỗng đúng; không lộ dữ liệu tenant A cho tenant B.
- 10/10 ca branch scope đúng; ngoài phạm vi trả 404, danh sách chỉ trả chi nhánh được phép.
- 9/9 ca xác thực đúng: thiếu/sai/hết hạn/bị sửa token đều 401; logout và lock thu hồi ngay.
- 19/19 ca quản lý vai trò và mã lỗi 400/409 đúng.
- **02 ca thất bại**: quyền bị thu hồi và phạm vi chi nhánh bị đổi vẫn có hiệu lực với token cũ.

### 5.2 Danh sách test case và kết quả thực tế

**Quy ước cột:**

- **Thao tác:** method + path (bỏ host; chạy direct trên cổng service tương ứng).
- **Dữ liệu chính:** body/điều kiện chính; token của vai trò ghi trong tên case.
- **Mong đợi / Thực tế:** HTTP status.
- **Kết quả:** Passed nếu tất cả assertion đạt; Failed nếu có ít nhất một assertion lỗi.

> Nguồn: `results/cases-table.md`, sinh từ `results/newman.json` của lần chạy
> `secmwc1avod307c`. Không chứa token. ID/email cụ thể của lần chạy được thay bằng biến
> môi trường tương ứng (`{{runId}}`, `{{productAId}}`, …) cho dễ đọc; dữ liệu gốc là dữ
> liệu giả của lần chạy.

#### 00 — Preconditions

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-SETUP-01 | Năm vai trò mặc định tồn tại trong tenant A | GET /api/v1/roles | — | 200 | 200 | Passed |
| TC-SEC-SETUP-02 | Token của quản lý chi nhánh mang đúng tid/roles/perms/branches | GET /api/v1/tenants/current/context | — | 200 | 200 | Passed |
| TC-SEC-SETUP-03 | Vai trò tùy chỉnh chỉ mang đúng 6 quyền đã cấp | GET /api/v1/tenants/current/context | — | 200 | 200 | Passed |
| TC-SEC-SETUP-04 | Token chủ cửa hàng A và B gắn đúng tenant, không lẫn nhau | GET /api/v1/tenants/current | — | 200 | 200 | Passed |

#### 01 — Authentication

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-AUTH-01 | Không có token → 401 | GET /api/v1/tenants/current/members | — | 401 | 401 | Passed |
| TC-SEC-AUTH-02 | Chuỗi token không phải JWT → 401 | GET /api/v1/tenants/current/members | — | 401 | 401 | Passed |
| TC-SEC-AUTH-03 | Token bị sửa payload, giữ chữ ký cũ → 401 | GET /api/v1/tenants/current/members | — | 401 | 401 | Passed |
| TC-SEC-AUTH-04 | Token hết hạn (exp trong quá khứ, chữ ký hợp lệ) → 401 | GET /api/v1/tenants/current/members | — | 401 | 401 | Passed |
| TC-SEC-AUTH-05 | Sai loại xác thực (Basic thay vì Bearer) → 401 | GET /api/v1/tenants/current/members | — | 401 | 401 | Passed |
| TC-SEC-AUTH-06 | Đăng xuất thu hồi access token ngay (POST /auth/logout) | POST /api/v1/auth/logout | — | 200 | 200 | Passed |
| TC-SEC-AUTH-07 | Access token sau đăng xuất bị từ chối → 401 | GET /api/v1/branches | — | 401 | 401 | Passed |
| TC-SEC-AUTH-08 | Khóa thành viên (lock) có hiệu lực ngay với token cũ | POST /api/v1/tenants/current/members/{lockeeAccountId}/lock | — | 200 | 200 | Passed |
| TC-SEC-AUTH-09 | Token của thành viên đã bị khóa → 401 | GET /api/v1/branches | — | 401 | 401 | Passed |

#### 02 — RBAC matrix

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-RBAC-01 | [owner] Xem sản phẩm (products.view) → 200 | GET /api/v1/products | — | 200 | 200 | Passed |
| TC-SEC-RBAC-02 | [branch_manager] Xem sản phẩm (products.view) → 200 | GET /api/v1/products | — | 200 | 200 | Passed |
| TC-SEC-RBAC-03 | [sales_staff] Xem sản phẩm (products.view) → 200 | GET /api/v1/products | — | 200 | 200 | Passed |
| TC-SEC-RBAC-04 | [warehouse_staff] Xem sản phẩm (products.view) → 200 | GET /api/v1/products | — | 200 | 200 | Passed |
| TC-SEC-RBAC-05 | [accountant] Xem sản phẩm (products.view) → 403 | GET /api/v1/products | — | 403 | 403 | Passed |
| TC-SEC-RBAC-06 | [custom] Xem sản phẩm (products.view) → 200 | GET /api/v1/products | — | 200 | 200 | Passed |
| TC-SEC-RBAC-07 | [owner] Tạo sản phẩm (products.create) → 422 | POST /api/v1/products | {} | 422 | 422 | Passed |
| TC-SEC-RBAC-08 | [branch_manager] Tạo sản phẩm (products.create) → 422 | POST /api/v1/products | {} | 422 | 422 | Passed |
| TC-SEC-RBAC-09 | [sales_staff] Tạo sản phẩm (products.create) → 403 | POST /api/v1/products | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-10 | [warehouse_staff] Tạo sản phẩm (products.create) → 403 | POST /api/v1/products | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-11 | [accountant] Tạo sản phẩm (products.create) → 403 | POST /api/v1/products | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-12 | [custom] Tạo sản phẩm (products.create) → 403 | POST /api/v1/products | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-13 | [owner] Sửa sản phẩm (products.update) → 404 | PATCH /api/v1/products/{randomProductId} | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-14 | [branch_manager] Sửa sản phẩm (products.update) → 404 | PATCH /api/v1/products/{randomProductId} | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-15 | [sales_staff] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/{randomProductId} | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-16 | [warehouse_staff] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/{randomProductId} | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-17 | [accountant] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/{randomProductId} | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-18 | [custom] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/{randomProductId} | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-19 | [owner] Xóa sản phẩm (products.delete) → 404 | DELETE /api/v1/products/{randomProductId} | — | 404 | 404 | Passed |
| TC-SEC-RBAC-20 | [branch_manager] Xóa sản phẩm (products.delete) → 404 | DELETE /api/v1/products/{randomProductId} | — | 404 | 404 | Passed |
| TC-SEC-RBAC-21 | [sales_staff] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/{randomProductId} | — | 403 | 403 | Passed |
| TC-SEC-RBAC-22 | [warehouse_staff] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/{randomProductId} | — | 403 | 403 | Passed |
| TC-SEC-RBAC-23 | [accountant] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/{randomProductId} | — | 403 | 403 | Passed |
| TC-SEC-RBAC-24 | [custom] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/{randomProductId} | — | 403 | 403 | Passed |
| TC-SEC-RBAC-25 | [owner] Duyệt phiếu nhập kho (inventory.approve) → 404 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-26 | [branch_manager] Duyệt phiếu nhập kho (inventory.approve) → 404 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-27 | [sales_staff] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-28 | [warehouse_staff] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-29 | [accountant] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-30 | [custom] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/{randomReceiptId}/post | {} | 403 | 403 | Passed |

#### 03 — RBAC bổ sung

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-X-01 | Sales tạo khách hàng (customers.create) → 201 | POST /api/v1/customers | {"name":"Khách do sales tạo {{runId}}","phone":"0912345679"} | 201 | 201 | Passed |
| TC-SEC-X-02 | Sales sửa khách hàng vừa tạo (customers.update) → 200 | PATCH /api/v1/customers/{salesCustomerId} | {"name":"Khách đã sửa {{runId}}"} | 200 | 200 | Passed |
| TC-SEC-X-03 | Sales xóa khách hàng (customers.delete) → 403 | DELETE /api/v1/customers/{salesCustomerId} | — | 403 | 403 | Passed |
| TC-SEC-X-04 | Sales tạo đơn hàng (orders.create) → 422 do thiếu dữ liệu, không phải 403 | POST /api/v1/orders | {} | 422 | 422 | Passed |
| TC-SEC-X-05 | Kế toán tạo đơn hàng → 403 | POST /api/v1/orders | {} | 403 | 403 | Passed |
| TC-SEC-X-06 | Nhân viên kho tạo phiếu nhập với warehouseId không tồn tại → 404, không phải 403 | POST /api/v1/stock-receipts | {"warehouseId":"{{randomWarehouseId}}","items":[{"skuId":"{{randomProductId}}","qty":"1"}]} | 404 | 404 | Passed |
| TC-SEC-X-07 | Kế toán tạo phiếu nhập → 403 | POST /api/v1/stock-receipts | {} | 403 | 403 | Passed |
| TC-SEC-X-08 | Kế toán xem đơn hàng (orders.view) → 200 | GET /api/v1/orders | — | 200 | 200 | Passed |
| TC-SEC-X-09 | Nhân viên kho xem khách hàng (customers.view) → 403 | GET /api/v1/customers | — | 403 | 403 | Passed |
| TC-SEC-X-10 | Quản lý chi nhánh thêm nhân viên (staff.create) → 403 | POST /api/v1/tenants/current/members | {} | 403 | 403 | Passed |
| TC-SEC-X-11 | Vai trò tùy chỉnh tạo vai trò khác (staff.update) → 403 | POST /api/v1/roles | {"name":"Should fail {{runId}}","permissions":["products.view"]} | 403 | 403 | Passed |
| TC-SEC-X-12 | Sales đọc danh sách vai trò (staff.view) → 403 | GET /api/v1/roles | — | 403 | 403 | Passed |
| TC-SEC-X-13 | Chủ cửa hàng thêm nhân viên với body rỗng → 422 (đã qua guard) | POST /api/v1/tenants/current/members | {} | 422 | 422 | Passed |
| TC-SEC-X-14 | Quản lý chi nhánh sửa cài đặt cửa hàng (settings.update) → 403 | PATCH /api/v1/tenants/current | {} | 403 | 403 | Passed |
| TC-SEC-X-15 | Chủ cửa hàng sửa cài đặt cửa hàng với body rỗng → 200 | PATCH /api/v1/tenants/current | {} | 200 | 200 | Passed |
| TC-SEC-X-16 | Quản lý chi nhánh (không có settings.update) sửa chi nhánh A2 → 403 | PATCH /api/v1/branches/{{branchA2}} | {} | 403 | 403 | Passed |

#### 04 — Vai trò & 400/409

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-ROLE-01 | Tạo vai trò tùy chỉnh hợp lệ → 201 | POST /api/v1/roles | {"name":"Created Role {{runId}}","permissions":["products.view"]} | 201 | 201 | Passed |
| TC-SEC-ROLE-02 | Trùng tên vai trò → 409 R001 | POST /api/v1/roles | {"name":"Created Role {{runId}}","permissions":["products.view"]} | 409 | 409 | Passed |
| TC-SEC-ROLE-03 | Mã quyền không tồn tại → 400 R003 | POST /api/v1/roles | {"name":"Bad Permission {{runId}}","permissions":["nope.nope"]} | 400 | 400 | Passed |
| TC-SEC-ROLE-04 | Sửa vai trò owner → 400 R002 | PATCH /api/v1/roles/{{ownerRoleId}} | {"name":"Hacked"} | 400 | 400 | Passed |
| TC-SEC-ROLE-05 | Xóa vai trò owner → 400 R004 | DELETE /api/v1/roles/{{ownerRoleId}} | — | 400 | 400 | Passed |
| TC-SEC-ROLE-06 | Xóa vai trò mặc định (kế toán) → 400 R004 | DELETE /api/v1/roles/{{accountantRoleId}} | — | 400 | 400 | Passed |
| TC-SEC-ROLE-07 | Xóa vai trò đang có thành viên → 409 R005 | DELETE /api/v1/roles/{{customRoleId}} | — | 409 | 409 | Passed |
| TC-SEC-ROLE-08 | Xóa vai trò tùy chỉnh không có thành viên → 204 | DELETE /api/v1/roles/{{unusedRoleId}} | — | 204 | 204 | Passed |
| TC-SEC-ROLE-09 | Sales tạo vai trò → 403 | POST /api/v1/roles | {"name":"Sales Role {{runId}}","permissions":["products.view"]} | 403 | 403 | Passed |
| TC-SEC-ROLE-10 | Sales đọc vai trò → 403 | GET /api/v1/roles | — | 403 | 403 | Passed |
| TC-SEC-ROLE-11 | Thêm thành viên không chọn vai trò → 400 R007 | POST /api/v1/tenants/current/members | {"email":"{{ownerBEmail}}"} | 400 | 400 | Passed |
| TC-SEC-ROLE-12 | Gán vai trò owner cho người khác → 400 R008 | POST /api/v1/tenants/current/members | {"email":"{{ownerBEmail}}","roleId":"{{ownerRoleId}}"} | 400 | 400 | Passed |
| TC-SEC-ROLE-13 | Gán roleId không tồn tại → 400 R007 | POST /api/v1/tenants/current/members | {"email":"{{ownerBEmail}}","roleId":"{{randomRoleId}}"} | 400 | 400 | Passed |
| TC-SEC-ROLE-14 | Thêm trùng thành viên → 400 T002 | POST /api/v1/tenants/current/members | {"email":"{{salesEmail}}","roleId":"{{salesRoleId}}"} | 400 | 400 | Passed |
| TC-SEC-ROLE-15 | Đổi vai trò của owner → 400 T003 | PATCH /api/v1/tenants/current/members/{{ownerAccountId}} | {"roleId":"{{managerRoleId}}"} | 400 | 400 | Passed |
| TC-SEC-ROLE-16 | UUID không hợp lệ trên đường dẫn → 400 | GET /api/v1/branches/not-a-uuid | — | 400 | 400 | Passed |
| TC-SEC-ROLE-17 | Trùng mã chi nhánh → 400 B001 | POST /api/v1/branches | {"name":"Trùng mã","code":"A2"} | 400 | 400 | Passed |
| TC-SEC-ROLE-18 | Mã chi nhánh sai định dạng → 422 | POST /api/v1/branches | {"name":"Sai mã","code":"bad code!"} | 422 | 422 | Passed |
| TC-SEC-ROLE-19 | Tạo tenant trùng subdomain → 400 T001 | POST /api/v1/tenants | {"name":"Trùng subdomain","subdomain":"{{tenantASubdomain}}"} | 400 | 400 | Passed |

#### 05 — Cô lập tenant

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-TEN-01 | Tenant B đọc sản phẩm của A → 404, không lộ dữ liệu | GET /api/v1/products/{{productAId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-02 | Tenant B sửa sản phẩm của A → 404 | PATCH /api/v1/products/{{productAId}} | {"name":"Hacked by B"} | 404 | 404 | Passed |
| TC-SEC-TEN-03 | Tenant B xóa sản phẩm của A → 404 | DELETE /api/v1/products/{{productAId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-04 | Tenant B đọc khách hàng của A → 404, không lộ dữ liệu | GET /api/v1/customers/{{customerAId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-05 | Tenant B sửa khách hàng của A → 404 | PATCH /api/v1/customers/{{customerAId}} | {"name":"Hacked by B"} | 404 | 404 | Passed |
| TC-SEC-TEN-06 | Tenant B xóa khách hàng của A → 404 | DELETE /api/v1/customers/{{customerAId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-07 | Tenant B đọc chi nhánh A1 → 404 | GET /api/v1/branches/{{branchA1}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-08 | Tenant B đọc cài đặt chi nhánh A1 → 404 | GET /api/v1/branches/{{branchA1}}/settings | — | 404 | 404 | Passed |
| TC-SEC-TEN-09 | Tenant B đọc vai trò tùy chỉnh của A → 404 R006 | GET /api/v1/roles/{{customRoleId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-10 | Tenant B đọc thành viên của A → 404 | GET /api/v1/tenants/current/members/{{managerAccountId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-11 | Tenant B sửa thành viên của A → 404 | PATCH /api/v1/tenants/current/members/{{managerAccountId}} | {"roleId":"{{salesRoleId}}"} | 404 | 404 | Passed |
| TC-SEC-TEN-12 | Tenant B xóa thành viên của A → 404 | DELETE /api/v1/tenants/current/members/{{managerAccountId}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-13 | Danh sách thành viên tenant B không lẫn tài khoản tenant A | GET /api/v1/tenants/current/members | — | 200 | 200 | Passed |
| TC-SEC-TEN-14 | Danh sách vai trò tenant B không lẫn vai trò tenant A | GET /api/v1/roles | — | 200 | 200 | Passed |
| TC-SEC-TEN-15 | GET /tenants/current của token B trả đúng tenant B | GET /api/v1/tenants/current | — | 200 | 200 | Passed |
| TC-SEC-TEN-16 | Chuyển sang tenant không phải thành viên → 404 | POST /api/v1/auth/switch-tenant | {"tenantId":"{{tenantA}}"} | 404 | 404 | Passed |
| TC-SEC-TEN-17 | Chèn tenantId của A vào body khi tạo chi nhánh → vẫn tạo ở B | POST /api/v1/branches | {"name":"Chi nhánh chèn tenant","code":"{{unusedBranchCode}}","tenantId":"{{tenantA}}"} | 201 | 201 | Passed |
| TC-SEC-TEN-18 | Query tenantId=A khi token B không thay đổi phạm vi dữ liệu | GET /api/v1/branches?tenantId={{tenantA}} | — | 200 | 200 | Passed |
| TC-SEC-TEN-19 | Tenant A đọc chi nhánh B1 → 404 | GET /api/v1/branches/{{branchB1}} | — | 404 | 404 | Passed |
| TC-SEC-TEN-20 | Header X-Tenant-Id=A khi token B không thay đổi phạm vi dữ liệu | GET /api/v1/branches | Header `X-Tenant-Id: {{tenantA}}` | 200 | 200 | Passed |

#### 06 — Cô lập chi nhánh

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-BRA-01 | Quản lý chỉ thấy chi nhánh A2 trong danh sách | GET /api/v1/branches | — | 200 | 200 | Passed |
| TC-SEC-BRA-02 | Quản lý đọc chi nhánh A1 ngoài phạm vi → 404 | GET /api/v1/branches/{{branchA1}} | — | 404 | 404 | Passed |
| TC-SEC-BRA-03 | Quản lý đọc cài đặt chi nhánh A1 ngoài phạm vi → 404 | GET /api/v1/branches/{{branchA1}}/settings | — | 404 | 404 | Passed |
| TC-SEC-BRA-04 | Quản lý đọc cài đặt chi nhánh A2 trong phạm vi → 200 | GET /api/v1/branches/{{branchA2}}/settings | — | 200 | 200 | Passed |
| TC-SEC-BRA-05 | Vai trò có settings.update nhưng giới hạn A2 sửa cài đặt A1 → 404 | PATCH /api/v1/branches/{{branchA1}}/settings | {} | 404 | 404 | Passed |
| TC-SEC-BRA-06 | Vai trò có settings.update trong phạm vi A2 sửa cài đặt A2 → 200 | PATCH /api/v1/branches/{{branchA2}}/settings | {} | 200 | 200 | Passed |
| TC-SEC-BRA-07 | Người bị giới hạn chi nhánh tạo chi nhánh mới → 403 B008 | POST /api/v1/branches | {"name":"Ngoài phạm vi","code":"OUT01"} | 403 | 403 | Passed |
| TC-SEC-BRA-08 | Context của quản lý chỉ trả chi nhánh A2 và branchCount=1 | GET /api/v1/tenants/current/context | — | 200 | 200 | Passed |
| TC-SEC-BRA-09 | Sales không bị giới hạn chi nhánh thấy cả A1 và A2 | GET /api/v1/branches | — | 200 | 200 | Passed |
| TC-SEC-BRA-10 | Sales đọc chi nhánh A1 → 200 | GET /api/v1/branches/{{branchA1}} | — | 200 | 200 | Passed |

#### 07 — Revocation

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-REV-01 | Baseline: revokee có staff.create, thêm thành viên body rỗng → 422 | POST /api/v1/tenants/current/members | {} | 422 | 422 | Passed |
| TC-SEC-REV-02 | Chủ cửa hàng thu hồi staff.create khỏi vai trò → 200 | PATCH /api/v1/roles/{{revokeRoleId}} | {"permissions":["staff.view"]} | 200 | 200 | Passed |
| TC-SEC-REV-03 | Token cũ (còn hạn) sau khi thu hồi staff.create phải bị 403 — yêu cầu thu hồi tức thời | POST /api/v1/tenants/current/members | {} | 403 | **422** | **Failed** |
| TC-SEC-REV-04 | Revokee đăng nhập lại để lấy token mới → 200 | POST /api/v1/auth/email/login | {"email":"{{revokeeEmail}}","password":"••••••"} | 200 | 200 | Passed |
| TC-SEC-REV-05 | Token mới sau đăng nhập lại bị 403 với staff.create | POST /api/v1/tenants/current/members | {} | 403 | 403 | Passed |
| TC-SEC-REV-06 | Baseline: scopee đọc cài đặt A2 trong phạm vi → 200 | GET /api/v1/branches/{{branchA2}}/settings | — | 200 | 200 | Passed |
| TC-SEC-REV-07 | Chủ cửa hàng đổi phạm vi của scopee sang A1 → 200 | PATCH /api/v1/tenants/current/members/{{scopeeAccountId}} | {"branchIds":["{{branchA1}}"]} | 200 | 200 | Passed |
| TC-SEC-REV-08 | Token cũ của scopee sau khi đổi phạm vi phải bị 404 khi đọc A2 — yêu cầu thu hồi tức thời | GET /api/v1/branches/{{branchA2}}/settings | — | 404 | **200** | **Failed** |
| TC-SEC-REV-09 | Scopee đăng nhập lại để lấy token mới → 200 | POST /api/v1/auth/email/login | {"email":"{{scopeeEmail}}","password":"••••••"} | 200 | 200 | Passed |
| TC-SEC-REV-10 | Token mới của scopee bị 404 khi đọc A2 | GET /api/v1/branches/{{branchA2}}/settings | — | 404 | 404 | Passed |

### 5.3 Ma trận truy vết (test case → FR / BR / NFR)

| Yêu cầu | Nội dung (SRS v1.1) | Test case | Kết quả |
|---|---|---|---|
| **FR-M02-05** | Phân quyền theo vai trò ở tầng API | SETUP-01..03; RBAC-01..30; X-01..16; ROLE-01..19 | **Đạt** (30/30 ma trận, 16/16 bổ sung, 19/19 vai trò) |
| **FR-M02-06** | Vai trò tùy chỉnh và thu hồi quyền | SETUP-03; ROLE-01..08; X-11; REV-01..05 | **Có lỗi** — REV-03 (DEF-SEC-01); phần tạo/sửa/xóa vai trò đạt |
| **FR-M02-07** | Phạm vi theo chi nhánh | BRA-01..10; TEN-07/08; REV-06..10 | **Có lỗi** — REV-08 (DEF-SEC-02); phần cô lập chi nhánh đạt |
| **NFR-SE-03** | Cô lập dữ liệu theo tenant | TEN-01..20; SETUP-04 | **Đạt** (20/20) |
| **NFR-SE-04** | Chặn quyền ở tầng API | AUTH-01..09; RBAC-01..30; X-01..16; ROLE-09/10; REV-03/08 | **Đạt** phần guard; **có lỗi** thu hồi tức thời (REV-03/08) |
| **BR-01** | Mọi dữ liệu gắn `tenant_id`, không truy vấn xuyên tenant | TEN-01..20; SETUP-04; ROLE-19 | **Đạt** (20/20) |

**Độ phủ:** 118/118 test case ánh xạ tới ít nhất một yêu cầu; 100% FR/BR/NFR trong phạm vi
có test case tương ứng.

### 5.4 Báo cáo lỗi (Defect Report)

| Defect ID | Test case | Mô tả | Mức độ | Trạng thái |
|---|---|---|---|---|
| **DEF-SEC-01** | TC-SEC-REV-03 | Token cũ vẫn dùng được quyền `staff.create` sau khi quyền bị thu hồi khỏi vai trò | **Major** | Open |
| **DEF-SEC-02** | TC-SEC-REV-08 | Token cũ vẫn đọc được chi nhánh A2 sau khi phạm vi của thành viên bị đổi sang A1 | **Major** | Open |

---

#### DEF-SEC-01 — Thu hồi quyền không có hiệu lực với access token còn hạn

| Trường | Nội dung |
|---|---|
| **Defect ID** | DEF-SEC-01 |
| **Test case phát hiện** | TC-SEC-REV-03 (liên quan REV-01, REV-02, REV-04, REV-05) |
| **Mức độ (Severity)** | **Major** — lỗi bảo mật/phân quyền, ảnh hưởng trực tiếp NFR-SE-04, FR-M02-06 |
| **Ưu tiên (Priority)** | **High** |
| **Trạng thái** | Open |
| **Thành phần** | platform — `RoleService.update`, `AuthGuard`/`hasPermission`, `AccessTokenService` |
| **Môi trường** | Stack local, platform 3000, PostgreSQL 16.9, Redis 5.0.14; run `secmwc1avod307c` |
| **Điều kiện tiên quyết** | Tenant A có vai trò tùy chỉnh `Revoke Demo` với `staff.view` + `staff.create`; tài khoản `revokee` đã được gán vai trò và đã đăng nhập (token còn hạn) |

**Các bước tái hiện:**

1. Chủ cửa hàng A tạo vai trò `Revoke Demo` với `permissions = ["staff.view","staff.create"]`.
2. Gán tài khoản `revokee` vào vai trò này.
3. `revokee` đăng nhập, lưu `accessToken` (token cũ).
4. Gọi `POST /api/v1/tenants/current/members` bằng token cũ với body `{}` → nhận **422**
   (request đã qua guard, chỉ lỗi validate email) — chứng minh quyền `staff.create` đang có hiệu lực.
5. Chủ cửa hàng gọi `PATCH /api/v1/roles/{roleId}` với `{"permissions":["staff.view"]}` → 200.
6. Gọi lại `POST /api/v1/tenants/current/members` bằng **token cũ** với body `{}`.
7. `revokee` đăng nhập lại, lấy token mới; gọi lại cùng request.

**Kết quả mong đợi:** bước 6 trả **403 Forbidden** (quyền đã bị thu hồi, phải có hiệu lực ngay).

**Kết quả thực tế:**

- Bước 6: **HTTP 422 Unprocessable Entity** — guard vẫn cho qua vì token cũ còn `staff.create`
  trong claim `perms`; lỗi 422 chỉ là validate body rỗng. Nếu body hợp lệ, tài khoản sẽ tạo
  được thành viên mới.
- Bước 7: **HTTP 403 Forbidden** — token mới (sau đăng nhập lại) mới phản ánh quyền đã thu hồi.
- Assertion lỗi: `HTTP 403: expected response to have status code 403 but got 422` và
  `Từ chối 403 Forbidden: expected 'Unprocessable Entity' to deeply equal 'Forbidden'`.

**Bằng chứng:** run `secmwc1avod307c` và `secmwc1anew900c`; `TC-SEC-REV-03` Failed ở cả hai;
`results/history/<runId>/newman.json`, `results/report.html`.

**Nguyên nhân gốc (root cause):**

- Quyền được nhúng vào JWT claim `perms` khi đăng nhập/refresh
  (`libs/auth/src/access-token.verifier.ts` dòng 82–91).
- Guard kiểm tra `user.permissions` từ token (`libs/auth/src/auth.guard.ts` dòng 106;
  `auth.helpers.ts` dòng 8–14), không tra DB/Redis.
- `RoleService.update` chỉ thay bảng `role_permission` (`role.service.ts` dòng 176–211),
  không thu hồi session, không tăng version token.
- ADR-0020 dòng 36, 63 chấp nhận “áp dụng ở lần đăng nhập/refresh kế tiếp”, tối đa 1 ngày
  (`AUTH_JWT_TOKEN_EXPIRES_IN=1d`). Đây là xung đột với yêu cầu “thu hồi ngay” của Luồng 1.

**Ảnh hưởng:** nhân viên bị thu hồi quyền (hoặc nghỉ việc) vẫn giữ quyền tối đa 24 giờ; có
thể tạo/sửa/xóa dữ liệu nhạy cảm, leo thang quyền trong cửa sổ token còn hạn. Rủi ro cao
trong môi trường nhiều tenant.

**Đề xuất khắc phục:**

1. Thêm `permVersion` (hoặc `tokenVersion`) vào token và lưu ở tenant/member; khi role hoặc
   membership đổi, tăng version; guard so version trong token với version hiện tại (cache Redis).
2. Hoặc gọi `SessionService.revokeAll(accountId, {tenantId})` cho mọi thành viên giữ role khi
   role bị sửa; thu hồi cả khi member đổi role.
3. Hoặc rút ngắn access-token TTL (15 phút) và bắt buộc refresh; vẫn cần cơ chế thu hồi cho
   trường hợp khẩn cấp.
4. Bổ sung test hồi quy: sau PATCH role, token cũ phải 403; sau refresh, token mới phản ánh
   đúng quyền.

**Kế hoạch retest:** sửa xong chạy lại `TC-SEC-REV-03` (và REV-01/02/04/05) trên run mới;
kỳ vọng 403 ở token cũ, 403 ở token mới.

---

#### DEF-SEC-02 — Đổi phạm vi chi nhánh không có hiệu lực với access token còn hạn

| Trường | Nội dung |
|---|---|
| **Defect ID** | DEF-SEC-02 |
| **Test case phát hiện** | TC-SEC-REV-08 (liên quan REV-06, REV-07, REV-09, REV-10) |
| **Mức độ (Severity)** | **Major** — lỗi cô lập chi nhánh, ảnh hưởng FR-M02-07, NFR-SE-03 |
| **Ưu tiên (Priority)** | **High** |
| **Trạng thái** | Open |
| **Thành phần** | platform — `MemberService.update`, `canAccessBranch`/`allowedBranches`, token claim `branches` |
| **Môi trường** | Stack local, run `secmwc1avod307c` |
| **Điều kiện tiên quyết** | Tenant A có chi nhánh A1, A2; tài khoản `scopee` có vai trò `Branch Admin` (`settings.view`, `settings.update`) và chỉ được gán A2; đã đăng nhập |

**Các bước tái hiện:**

1. Chủ cửa hàng gán `scopee` vào vai trò `Branch Admin`, `branchIds = [A2]`.
2. `scopee` đăng nhập, lưu token cũ (claim `branches = [A2]`).
3. Gọi `GET /api/v1/branches/{A2}/settings` bằng token cũ → 200 (đúng phạm vi).
4. Chủ cửa hàng gọi `PATCH /api/v1/tenants/current/members/{scopeeAccountId}` với
   `{"branchIds":["A1"]}` → 200.
5. Gọi lại `GET /api/v1/branches/{A2}/settings` bằng **token cũ**.
6. `scopee` đăng nhập lại, lấy token mới; gọi lại cùng request.

**Kết quả mong đợi:** bước 5 trả **404 Not Found** (A2 đã ngoài phạm vi; hệ thống dùng 404
để không lộ sự tồn tại của chi nhánh, theo ADR-0020).

**Kết quả thực tế:**

- Bước 5: **HTTP 200 OK** — token cũ vẫn có `branches = [A2]`; `canAccessBranch` chỉ so
  claim trong token, nên vẫn đọc được cài đặt A2.
- Bước 6: **HTTP 404 Not Found** — token mới mới phản ánh phạm vi A1.
- Assertion lỗi: `HTTP 404: expected response to have status code 404 but got 200`.

**Bằng chứng:** run `secmwc1avod307c` và `secmwc1anew900c`; `TC-SEC-REV-08` Failed ở cả hai;
`results/history/<runId>/newman.json`.

**Nguyên nhân gốc:**

- `MemberService.update` ghi `account_tenant_branch` (`member.service.ts` dòng 329–401) nhưng
  không thu hồi session/token của thành viên.
- `canAccessBranch` và `allowedBranches` chỉ đọc `user.branches` từ token
  (`libs/auth/src/auth.helpers.ts` dòng 19–30); token cũ giữ mảng cũ.
- ADR-0020 dòng 36, 63: thay đổi thành viên áp dụng ở lần đăng nhập/refresh kế tiếp.

**Ảnh hưởng:** nhân viên bị chuyển khỏi chi nhánh vẫn đọc/sửa dữ liệu chi nhánh cũ tối đa
1 ngày; vi phạm cô lập chi nhánh và có thể lộ dữ liệu doanh thu/tồn kho của chi nhánh khác.

**Đề xuất khắc phục:** tương tự DEF-SEC-01 — `branchVersion` trong token hoặc thu hồi session
khi `branchIds` thay đổi; guard kiểm tra version/phạm vi hiện tại; test hồi quy REV-08.

**Kế hoạch retest:** sửa xong chạy lại `TC-SEC-REV-08` (và REV-06/07/09/10).

---

#### Quan sát bảo mật (không tính vào Pass/Fail)

| ID | Nội dung | Mức độ | Khuyến nghị |
|---|---|---|---|
| OB-SEC-03 | Response lỗi chứa `stack` và `trace` khi `APP_DEBUG=true` (`global-exception.filter.ts` dòng 55–57). Quan sát thấy ở 401/403/404/422 với kích thước 2,6–4,0 KB. | Informational (local dev) | Đặt `APP_DEBUG=false` ở production; thêm test cấu hình để đảm bảo không lộ stack. |
| OB-SEC-04 | Access token TTL 1 ngày, chưa có refresh ở web; làm trầm trọng DEF-SEC-01/02. | Major (thiết kế) | Rút ngắn TTL, bật refresh, hoặc thêm cơ chế version/revocation. |

### 5.5 Kết quả chạy lại các test hiện có (bằng chứng bổ sung)

Chạy trên cùng mã nguồn, không sửa test nào của repo:

| Bộ test | Test suite | Test | Kết quả | Thời gian |
|---|---:|---:|---|---:|
| Platform — role, tenant, branch (`apps/platform/src/api/{role,tenant,branch}`) | 18 | 310 | **310 Passed, 0 Failed** | 101,47 s |
| `@pbl/auth` — guard, token verifier, branch scope, session revocation | 8 | 93 | **93 Passed, 0 Failed** | 22,75 s |
| Platform — quota service (`subscription/quota.service.spec.ts`) | 1 | 4 | **4 Passed, 0 Failed** | 9,19 s |
| **Tổng** | **27** | **407** | **407 Passed, 0 Failed** | — |

**Lệnh đã dùng:**

```bash
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "api/(role|tenant|branch)"

npx pnpm@9.12.3 exec jest --runInBand --testPathPattern "libs/auth"

npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "subscription/quota.service"
```

**Ghi chú trung thực:** lần chạy gộp đầu tiên của quota dùng Jest config gốc (không có alias
`@/`) nên suite không khởi động được; đây là lỗi cấu hình lệnh chạy, không phải lỗi sản phẩm.
Chạy lại với `apps/platform/jest.config.json` thì 4/4 test pass. Các test Jest dùng
repository/guard giả lập nên **không** phát hiện DEF-SEC-01/02; đây là lý do bộ Newman là
bằng chứng chính.

### 5.6 Cách chạy lại test

Tóm tắt từ `HANDOFF_CONTEXT.md` (chi tiết đầy đủ trong tệp đó):

```bash
# 1. Stack
cd pbl-api
docker compose up -d --build
bash scripts/verify-local-stack.sh

# 2. Cài dependency bộ test
cd security-tests
npm ci

# 3. Chạy qua gateway
npm test -- --gateway http://localhost:8080

# 4. Xem kết quả
#    results/summary.md, results/cases-table.md, results/report.html
```

- Chạy lại không tạo dữ liệu mới: `npm test -- --skip-provision` (token còn hạn).
- Chạy CI nghiêm ngặt: `npm run test:strict` (trả mã 1 nếu còn Failed).
- Chạy Newman thuần: xem mục 5.4 của `HANDOFF_CONTEXT.md`.
- Nếu chưa có gateway, chạy `npm test` để dùng port trực tiếp 3000–3004.

**Đọc mã lỗi nhanh:** 401 = chưa xác thực/token sai/hết hạn/bị thu hồi; 403 = thiếu quyền;
404 = không tồn tại **hoặc** ngoài phạm vi tenant/chi nhánh (cố ý); 400 = lỗi nghiệp vụ có
`errorCode` (R001, R003, R007, T001…); 409 = xung đột (R001 trùng tên, R005 role đang dùng);
422 = dữ liệu sai định dạng (với vai trò có quyền, đây là “được đi tiếp”, không phải 403).

### 5.7 Bằng chứng thực thi

| Bằng chứng | Vị trí | Ghi chú |
|---|---|---|
| Kết quả Newman (JSON) | `results/newman.json` + `results/history/<runId>/newman.json` | Chứa Authorization header — **không commit** |
| Báo cáo HTML | `results/report.html` + `results/history/<runId>/report.html` | Mở bằng trình duyệt; **không commit** vì có token |
| Tổng hợp Passed/Failed | `results/summary.md` | Không chứa token; commit được |
| Bảng chi tiết test case | `results/cases-table.md` | Sinh từ Newman; không chứa token; commit được |
| Dữ liệu provision | `results/provisioning.json` | Chứa ID/token — **không commit** |
| Môi trường Postman | `results/security-environment.json` | Chứa token — **không commit** |
| Lịch sử 2 lần chạy | `results/history/secmwc1anew900c`, `.../secmwc1avod307c` | Mỗi lần đủ JSON/HTML/summary |

**Hai lần chạy độc lập:**

| Run ID | Thời điểm | Test case | Passed | Failed | Assertion | Thời gian |
|---|---|---:|---:|---:|---:|---:|
| `secmwc1anew900c` | 11/11/2026 | 118 | 116 | 2 | 353 (3 failed) | 7,06 s |
| `secmwc1avod307c` | 11/11/2026 | 118 | 116 | 2 | 353 (3 failed) | 7,30 s |

Kết quả giống nhau ở cả hai lần: cùng 2 defect, không có unexpected failure; chứng minh bộ
test **repeatable** và không phụ thuộc dữ liệu cũ.

---

## Kết luận

### Kết quả đạt được

1. **RBAC theo vai trò đúng:** 30/30 tổ hợp bảng quyết định (6 vai trò × 5 thao tác) trả đúng
   kỳ vọng; owner và branch_manager được phép, sales/warehouse chỉ được xem sản phẩm, kế toán
   bị chặn ở module sản phẩm, vai trò tùy chỉnh chỉ có đúng 6 quyền xem. Không phát hiện leo
   thang quyền qua vai trò.
2. **Xác thực đúng:** 9/9 ca 401 (thiếu token, token rác, sửa chữ ký, hết hạn, sai scheme);
   logout và khóa thành viên thu hồi token ngay qua deny-list Redis.
3. **Cô lập tenant đúng:** 20/20 ca; tenant B không đọc/sửa/xóa được sản phẩm, khách hàng,
   chi nhánh, vai trò, thành viên của A; danh sách không lẫn; switch-tenant trái phép 404;
   chèn `tenantId` vào body/query không thay đổi phạm vi.
4. **Cô lập chi nhánh đúng:** 10/10 ca; người chỉ có A2 chỉ thấy A2, đọc/sửa A1 trả 404,
   context chỉ trả A2; người không giới hạn thấy cả A1/A2.
5. **Quản lý vai trò và mã lỗi đúng:** 19/19 ca; 400 R002/R003/R004/R007/R008/T001/T002/T003/B001,
   409 R001/R005, 422 validation, 204 xóa thành công.
6. **Phát hiện 2 lỗi Major thật:** thu hồi quyền và đổi phạm vi chi nhánh không có hiệu lực
   với access token còn hạn — đúng loại rủi ro mà Luồng 1 cần tìm.

### Hạn chế

- Chạy ở direct mode, không qua KrakenD, do Docker Desktop không khởi động được trong phiên
  chạy. Collection hỗ trợ gateway; cần chạy lại `--gateway` để có bằng chứng đúng môi trường
  Docker trước khi nộp chính thức.
- Chưa kiểm thử tải/pentest; chưa kiểm tra UI ẩn/hiện nút (ngoài phạm vi).
- Dữ liệu test tích lũy giữa các lần chạy (không xóa tenant); chấp nhận được nhờ `runId`
  duy nhất, nhưng nên reset volume khi bàn giao máy.

### Đánh giá cuối

| Tiêu chí | Kết quả |
|---|---|
| Chức năng RBAC | **Đạt** |
| Cô lập tenant | **Đạt** |
| Cô lập chi nhánh | **Đạt** |
| Thu hồi quyền tức thời | **Không đạt** — DEF-SEC-01, DEF-SEC-02 |
| Exit criteria tổng | **Không đạt** do còn 2 lỗi Major chưa xử lý |

**Khuyến nghị:** sửa DEF-SEC-01/02 bằng cơ chế version/revocation cho token (hoặc thu hồi
session khi role/member đổi, kèm rút ngắn TTL), sau đó chạy lại `TC-SEC-REV-03` và
`TC-SEC-REV-08`. Nếu nhóm chấp nhận thiết kế trễ theo ADR-0020, cần cập nhật SRS và chuyển
hai ca này thành “known limitation” thay vì defect.

---

## Phụ lục A — Dữ liệu kiểm thử

| Đối tượng | Giá trị (mỗi run có `<runId>` riêng) |
|---|---|
| Tenant A | `Security Store A <runId>`, subdomain `sec-a-<runId>` |
| Tenant B | `Security Store B <runId>`, subdomain `sec-b-<runId>` |
| Chi nhánh A1 | Mặc định, mã `CN01` |
| Chi nhánh A2 | Tạo thêm, mã `A2` |
| Chi nhánh B1 | Mặc định của B, mã `CN01` |
| Tài khoản | owner A/B, manager (branch_manager, A2), sales (sales_staff, mọi chi nhánh), warehouse, accountant, custom (6 quyền xem), branchAdmin (settings.view/update, A2), scopee (A2), revokee, lockee |
| Vai trò tùy chỉnh | `Custom Viewer` (6 quyền xem), `Branch Admin` (settings.view/update), `Revoke Demo` (staff.view/create), `Unused` |
| Sản phẩm/khách hàng A | 1 sản phẩm, 1 khách hàng — dùng cho test IDOR |
| Mật khẩu | `Passw0rd!` (dữ liệu giả) |
| Token hết hạn | RS256, ký bằng khóa local, `exp` cách hiện tại 1 giờ |
| Token bị sửa | Token thật, đổi ký tự cuối của chữ ký |

## Phụ lục B — Môi trường và công cụ

| Thành phần | Phiên bản |
|---|---|
| Windows | 11 (10.0.26200) |
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Newman | 6.2.3 |
| newman-reporter-htmlextra | 1.23.1 |
| PostgreSQL | 16.9 |
| Redis | 5.0.14 (Windows port) |
| ElasticMQ | 1.7.1 |
| KrakenD (chế độ gateway) | 2.6.3 |
| Jest / ts-jest | 29.7.0 / 29.2.5 |
| Trình duyệt xem báo cáo | Chrome/Edge |

---

*Hết báo cáo.*
