# KHỞI ĐỘNG LẠI MÁY VÀ CHẠY TEST — LUỒNG 1

> **Phạm vi:** dành cho máy test hiện tại, nơi có thư mục `D:\baocaokiemthu\runtime`
> (PostgreSQL/Redis/ElasticMQ binaries + script local). Với máy khác, dùng Docker theo
> `HANDOFF_CONTEXT.md`.

**Mục đích:** sau khi tắt/mở lại máy, bật lại môi trường và chạy bộ test bảo mật trong ~2 phút.

---

## 0. Chỉ làm một lần (hoặc sau khi `node_modules` bị xóa)

```powershell
cd D:\baocaokiemthu\pbl-api\security-tests
npm ci
```

Dữ liệu PostgreSQL, Redis, ElasticMQ nằm trong `D:\baocaokiemthu\runtime` nên **không mất**
khi tắt máy; không cần tạo lại database.

---

## 1. Bật môi trường

### Cách A — Có Docker Desktop (chuẩn, dùng gateway :8080)

1. Mở **Docker Desktop**, chờ trạng thái **Running**.
2. Chạy:

```powershell
cd D:\baocaokiemthu\pbl-api
docker compose up -d --build
bash scripts/verify-local-stack.sh
```

Thấy `Stack verified.` là được.

### Cách B — Không dùng Docker (máy này)

```powershell
cd D:\baocaokiemthu
powershell -ExecutionPolicy Bypass -File .\runtime\start-stack.ps1
```

Script tự bật:

```text
PostgreSQL :25432
Redis      :6379
ElasticMQ  :9324
platform   :3000
catalog    :3001
inventory  :3002
sales      :3003
customer   :3004
```

Khi thấy `== Stack san sang ==` là được (khoảng 20–40 giây).  
Nếu script đã in `Stack san sang` mà cửa sổ vẫn chưa trả prompt, nhấn `Ctrl+C`; các service
đã được tách tiến trình và vẫn chạy. Kiểm tra nhanh bằng `curl.exe -s http://127.0.0.1:3000/health`.

Nếu script lỗi hoặc treo, dùng **Phụ lục A** để bật thủ công.

---

## 2. Chạy test

```powershell
cd D:\baocaokiemthu\pbl-api\security-tests
npm run test:direct
```

Nếu dùng Docker/gateway:

```powershell
npm run test:gateway
```

### Kết quả kỳ vọng

```text
Test case : 118
Passed    : 116
Failed    : 2 (known defects: 2, unexpected: 0)
Assertion : 353 (failed: 3)
Thời gian : ~7 giây
```

2 case Failed là **DEF-SEC-01** (`TC-SEC-REV-03`) và **DEF-SEC-02** (`TC-SEC-REV-08`) —
defect bảo mật đã biết, không phải lỗi môi trường.

Xem báo cáo:

```text
results\summary.md       # tổng hợp
results\report.html      # chi tiết từng request/assertion
results\cases-table.md   # bảng test case
```

---

## 3. Tắt môi trường

**Direct mode:**

```powershell
powershell -ExecutionPolicy Bypass -File D:\baocaokiemthu\runtime\stop-stack.ps1
```

**Docker:**

```powershell
cd D:\baocaokiemthu\pbl-api
docker compose down
```

---

## 4. Lỗi thường gặp (xử lý nhanh)

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `Stack chưa sẵn sàng ... fetch failed` khi dùng `--gateway` | Cổng 8080 không chạy (Docker/KrakenD chưa bật) | Bật Docker Desktop → `docker compose up -d --build`; hoặc bỏ `--gateway`, dùng `npm run test:direct` |
| `409 Q001` | Quota Free 1 chi nhánh/3 user | Chạy lại `npm test` để provision nâng quota |
| Nhiều `401` | Token cũ/hết hạn | Chạy lại `npm test`, đừng dùng `--skip-provision` |
| `ECONNREFUSED` | Stack chưa lên đủ | Chờ health; xem log trong `D:\baocaokiemthu\logs` |
| `npm` báo thiếu newman | Chưa `npm ci` | `cd security-tests; npm ci` |
| Cổng đã bị chiếm | Stack cũ còn chạy | Chạy `stop-stack.ps1` hoặc `docker compose down` |

---

## Phụ lục A — Bật thủ công bằng 8 cửa sổ PowerShell

Mở PowerShell tại `D:\baocaokiemthu`, mỗi dòng một cửa sổ:

```powershell
.\runtime\pg\pgsql\bin\postgres.exe -D .\runtime\pg\data -p 25432
.\runtime\redis\redis-server.exe .\runtime\redis\redis-local.conf
java "-Dconfig.file=D:\baocaokiemthu\runtime\elasticmq\elasticmq.conf" -jar "D:\baocaokiemthu\runtime\elasticmq\elasticmq-server.jar"
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-platform.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name catalog   -Port 3001 -Schema catalog
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name inventory -Port 3002 -Schema inventory
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name sales     -Port 3003 -Schema sales
powershell -NoProfile -ExecutionPolicy Bypass -File .\runtime\start-service.ps1 -Name customer  -Port 3004 -Schema customer
```

Đợi 20–30 giây, kiểm tra nhanh:

```powershell
curl.exe -s http://127.0.0.1:3000/health
curl.exe -s http://127.0.0.1:3001/health
```

Rồi chạy test như mục 2.

---

**Chốt:** mở máy → `start-stack.ps1` → `npm run test:direct` → xem `results\summary.md`.
Nếu có Docker: mở Docker Desktop → `docker compose up -d --build` → `npm run test:gateway`.
