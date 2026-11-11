# Hướng dẫn push code lên Git — Luồng 1 (Thịnh)

Repo: `https://github.com/SapoClone/pbl-api`
Nhánh đề xuất: `test/thinh-security` (hợp lệ với regex branch của repo:
`^(feature|feat|chore|fix|bugfix|hotfix|docs|refactor|test|build|perf|style|ci|release|merge)/...`).

## 0. Kiểm tra trạng thái

```bash
cd pbl-api
git status
git branch --show-current
git remote -v
```

Nếu chưa cấu hình danh tính Git trên máy:

```bash
git config user.name "Thịnh"
git config user.email "<email GitHub của bạn>"
```

(Thay `<email GitHub của bạn>` bằng email thật gắn với tài khoản GitHub; không dùng email giả.)

## 1. Tạo nhánh riêng

```bash
git switch -c test/thinh-security
```

Nếu nhánh đã tồn tại từ trước:

```bash
git switch test/thinh-security
```

## 2. Kiểm tra file sẽ commit

```bash
git status --short security-tests
```

Kỳ vọng thấy các tệp:

- `security-tests/package.json`, `package-lock.json`, `.gitignore`, `README.md`
- `security-tests/security-rbac.postman_collection.json`
- `security-tests/postman-environment.example.json`
- `security-tests/provision.mjs`, `build-collection.mjs`, `run.mjs`, `report-cases.mjs`
- `security-tests/lib/api.mjs`
- `security-tests/results/summary.md`, `security-tests/results/cases-table.md`
- `security-tests/HANDOFF_CONTEXT.md`, `security-tests/BAO_CAO_KIEM_THU_LUONG1.md`
- `security-tests/PUSH_GUIDE.md`

**Không** thấy (đã bị `.gitignore` chặn, có chứa token):

- `security-tests/node_modules/`
- `security-tests/results/security-environment.json`
- `security-tests/results/provisioning.json`
- `security-tests/results/newman.json`
- `security-tests/results/report.html`
- `security-tests/results/summary.json`
- `security-tests/results/history/`

Kiểm tra lại bằng:

```bash
git check-ignore -v security-tests/results/security-environment.json
git check-ignore -v security-tests/results/newman.json
```

## 3. Stage và kiểm tra diff

```bash
git add security-tests
git diff --cached --stat
git diff --cached --name-only
```

Nếu lỡ stage file chứa token:

```bash
git restore --staged security-tests/results/security-environment.json
```

## 4. Commit

```bash
git commit -m "test(security): add RBAC and tenant isolation API test suite" -m "118 Postman/Newman cases cover the 6-role x 5-operation decision table, 401/403/400/409 handling, custom roles, tenant and branch isolation, and immediate revocation. Provisioning creates two tenants, two branches and per-role tokens per run. Two Major defects (stale permission and branch claims) are reported and reproduced by TC-SEC-REV-03/08."
```

Commit message theo Conventional Commits; pre-commit của repo chạy lint-staged (chỉ áp dụng
TypeScript, không đụng `.mjs`/JSON/MD của bộ test).

Nếu pre-push hook chạy test lâu, có thể chạy trước:

```bash
npx pnpm@9.12.3 exec jest --config apps/platform/jest.config.json --runInBand \
  --testPathPattern "api/(role|tenant|branch)"
```

Không khuyến nghị dùng `--no-verify`; chỉ dùng khi hook hỏng vì môi trường và đã ghi rõ lý do.

## 5. Push lên remote

```bash
git push -u origin test/thinh-security
```

Lần push đầu đặt upstream; các lần sau chỉ cần:

```bash
git push
```

## 6. Xác minh trên GitHub

```bash
git log --oneline -3
git status
git ls-remote --heads origin test/thinh-security
```

Mở GitHub → repo `SapoClone/pbl-api` → tab **Branches** → thấy `test/thinh-security`; tạo Pull
Request vào `main` nếu giảng viên/nhóm yêu cầu.

## 7. Nếu cần cập nhật sau khi sửa test

```bash
git add security-tests
git commit -m "test(security): refine RBAC assertions and evidence"
git push
```

## 8. Lưu ý bảo mật

- `results/security-environment.json`, `provisioning.json`, `newman.json`, `report.html`,
  `results/history/` chứa **access token thật** (hạn 1 ngày) và Authorization header.
  Không commit, không đính kèm vào báo cáo gửi công khai.
- Chỉ commit `results/summary.md` và `results/cases-table.md` (không có token).
- Nếu đã lỡ commit token, thu hồi bằng cách đăng xuất toàn bộ hoặc để token hết hạn, rồi
  xóa khỏi lịch sử Git (`git filter-repo`/BFG) trước khi push công khai.
