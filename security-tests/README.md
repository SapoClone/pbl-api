# Security & Authorization API tests — Luồng 1 (Thịnh)

Bộ kiểm thử API cho hai chức năng:

1. **Phân quyền theo vai trò (RBAC)** — FR-M02-05, FR-M02-06, NFR-SE-04.
2. **Cô lập dữ liệu theo tenant và chi nhánh** — FR-M02-07, BR-01, NFR-SE-03.

Công cụ: **Postman Collection + Newman**, dữ liệu test được tạo tự động bởi
`provision.mjs` (2 tenant, 2 chi nhánh, 11 tài khoản: 10 ở tenant A và 1 ở tenant B), nên mỗi lần chạy
là một bộ dữ liệu mới và không phá dữ liệu của lần trước.

## Thành phần

| Tệp | Vai trò |
|---|---|
| `security-rbac.postman_collection.json` | Collection 118 test case, 8 nhóm |
| `provision.mjs` | Tạo tenant A/B, chi nhánh, tài khoản, vai trò tùy chỉnh, token từng vai trò; ghi `results/security-environment.json` |
| `build-collection.mjs` | Sinh collection từ bảng quyết định (6 vai trò × 5 thao tác) + các ca bổ sung |
| `run.mjs` | Chạy provision + Newman, sinh JSON/HTML/summary; `--gateway`, `--skip-provision`, `--strict` |
| `report-cases.mjs` | Sinh bảng test case chi tiết từ `newman.json` (không chứa token) |
| `HANDOFF_CONTEXT.md` | Hướng dẫn chạy lại từ đầu |
| `BAO_CAO_KIEM_THU_LUONG1.md` | Báo cáo kiểm thử ISTQB v4 |

## Chạy nhanh

```bash
# 1. Stack Docker của pbl-api đang chạy, gateway http://localhost:8080
cd pbl-api
docker compose up -d --build

# 2. Cài dependency của bộ test
cd security-tests
npm ci

# 3. Chạy toàn bộ (provision + Newman)
npm test -- --gateway http://localhost:8080
```

Kết quả:

- `results/summary.md` — bảng tổng hợp Passed/Failed.
- `results/cases-table.md` — bảng chi tiết từng test case.
- `results/report.html` — báo cáo Newman HtmlExtra (mở bằng trình duyệt).
- `results/newman.json` — dữ liệu thô cho máy đọc.
- `results/history/<runId>/` — lưu lại từng lần chạy.

Hai ca **TC-SEC-REV-03** và **TC-SEC-REV-08** được thiết kế để thất bại khi hệ thống
chưa thu hồi quyền tức thời; chúng là hai defect bảo mật được ghi trong báo cáo.
Chạy `npm run test:strict` nếu muốn CI trả mã lỗi khi còn bất kỳ ca Failed nào.

Xem `HANDOFF_CONTEXT.md` để biết tiền điều kiện, cách đọc mã 401/403/400/409 và
xử lý sự cố.
