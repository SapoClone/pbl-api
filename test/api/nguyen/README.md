# Kiểm thử API của Nguyên

## Phạm vi

Phần 3 của `Testing-Scenario-v2.docx`: Chức năng 5 (vòng đời đơn online) và Chức năng 6 (giữ tồn, mã đơn); FR-M07-02/03, FR-M05-08, BR-02/05. Collection Postman v2.1 chỉ gọi KrakenD API Gateway tại `http://localhost:8080`. Seed dựa trên `scripts/demo-events.sh`; không dùng mock. Bộ Jest tích hợp sẵn trong `apps/sales/test` là nguồn tham khảo, không được tính là lượt chạy Newman.

## Một lệnh chạy từ root `pbl-api`

Yêu cầu Docker Desktop/Engine với Compose v2, Node.js 20+, npm và kết nối npm registry để cài Newman lần đầu. Người chạy phải truy cập được Docker daemon; kiểm tra `docker info`. Các cổng 8080, 3000, 25432, 6379, 9324 cần trống hoặc cấu hình lại biến cổng trong Compose. Chạy:

```bash
npm --prefix test/api/nguyen run test:api
```

Runner gọi `docker compose up -d --build`, chờ gateway, tạo tenant A và người dùng riêng, đọc chi nhánh mặc định (gói Free chỉ cho phép một chi nhánh), tạo warehouse, SKU, nhập 12 đơn vị bằng receipt. Runner còn tạo tenant B, sản phẩm và đơn đầu tiên để TC-NG-26 so sánh mã; sau đó cài Newman 6.2.1 nếu thiếu, chạy collection, tạo summary và đối chiếu PostgreSQL chỉ đọc. Mỗi lần chạy tạo dữ liệu nhận diện duy nhất, không xóa volume hoặc DB. Muốn dùng stack đang bật: `node test/api/nguyen/run.mjs --existing-stack`. Có thể đặt `GATEWAY_URL` (thí dụ `http://localhost:8081`); nếu runner tự khởi động Compose thì cũng đặt `GATEWAY_HOST_PORT=8081`.

Sau khi sửa generator: `python test/api/nguyen/generate_collection.py`. Có thể import `nguyen.postman_collection.json` vào Postman để xem các bước. Chạy thủ công phải cấp `base`, `token`, `staffToken`, `accountantToken`, `branchId`, `warehouseId`, `variantId`, `tenantBToken`, `tenantBOrderId`, `tenantBCode`, `tenantBId` của hai tenant thử nghiệm mới; lệnh một bước tự cấp các biến này.

## Kết quả và bằng chứng

`test/api/nguyen/reports/` lưu `.log`, Newman `.json`/`.html`, `.summary.json` đã lọc token và `.db.json` PostgreSQL khi tới bước Newman. JSON gốc có thể chứa access token, nên thư mục bị loại khỏi Git. Chỉ đưa bằng chứng đã lọc token vào `docs/testing/evidence/nguyen/`. Khi dừng trước Newman, runner ghi `.blocked.json/.blocked.html` để giải thích trở ngại; chúng **không phải** Newman report hay ca Passed. Mã thoát khác 0 là Failed hoặc Blocked.

Tóm tắt Newman JSON thành số ca và response lỗi đã lọc trường nhạy cảm: `node test/api/nguyen/summarize_newman.mjs test/api/nguyen/reports/<timestamp>.json docs/testing/evidence/nguyen/<run>.summary.json`. File `.html` của runner chỉ chứa tên request, HTTP và assertion; kiểm tra lại nội dung trước khi chia sẻ. `package-lock.json` cố định dependency Newman cho lần cài lại.

Đối chiếu PostgreSQL chỉ đọc cho một lượt đã chạy: `node test/api/nguyen/verify_db.mjs test/api/nguyen/reports/<timestamp>.json test/api/nguyen/reports/<timestamp>.db.json`. Lệnh dùng tenant/warehouse/SKU và order ID trong Newman JSON, truy vấn `inventory.stock_balance`, `sales.orders` qua `docker compose exec`; output không chứa token. Trên máy không có quyền Docker, chạy lệnh này từ terminal đã chạy được bộ test.

Đối chiếu qua `GET /sales/api/v1/orders/{id}` và `GET /inventory/api/v1/stock-levels?branchId=...` sau thao tác; collection chờ tồn hội tụ tối đa 45 lượt, cách nhau 1 giây. Nếu cần SQL, truy vấn các schema `sales`, `inventory` với `tenant_id` riêng của lượt chạy. Chạy toàn bộ lệnh lần thứ hai trên tenant mới trước khi báo ổn định.

## Phạm vi từng nhóm ca và giới hạn

- TC-NG-01..14, 22: chuyển trạng thái, version, hủy, giao và thanh toán.
- TC-NG-15..16, 23..25: thiếu tồn, POS, giữ tồn, tranh tồn tuần tự và hai xác nhận gửi gần đồng thời. Ca 25 không bảo đảm scheduler xử lý đúng cùng một thời điểm.
- TC-NG-17..20: quyền; TC-NG-21: mã duy nhất trong một tenant và regex hiện hành; TC-NG-26: sequence/mã ở tenant B qua Gateway.
- BR-05 yêu cầu định dạng mã **cấu hình được**. `sales-code.generator.ts` cố định sáu chữ số, không đọc cấu hình tenant; chưa có API cấu hình format để kiểm thử động. Ghi DEF-03, chỉ kết luận phần này sau khi nhóm Sales thiết kế và triển khai cấu hình.
- Ca 22 và 23 cố ý kiểm kỳ vọng theo kịch bản/SRS có thể khác logic hiện hành. Chỉ lập defect nghiệp vụ sau khi thu response thực tế và xác nhận với yêu cầu.

## Khắc phục sự cố

- Docker named pipe `permission denied`: mở Docker Desktop và chạy `docker info` với tài khoản có quyền Docker. Nếu gateway sẵn có, dùng `--existing-stack`.
- Gateway không lên: `docker compose ps`, `docker compose logs krakend platform sales inventory catalog elasticmq`.
- `npm ENOTFOUND`: cho phép DNS/npm registry, hoặc cài Newman trong `test/api/nguyen` trước khi chạy.
- Projection chưa hội tụ: xem log các consumer và báo cáo `.log`; seed chờ tối đa 45 giây cho inventory, gateway 90 giây. Không sửa dữ liệu nghiệp vụ trực tiếp để ép Passed.
