# Defect report — API đơn online và giữ tồn

Ngày kiểm thử: 11/11/2026. Môi trường: Docker Compose local, KrakenD `localhost:8080`, PostgreSQL `pbl`. Newman đã chạy ba lượt với tenant và SKU riêng. Lượt bộ 26 ca: **24 Passed, 2 Failed, 0 Blocked**, 72 HTTP request, 127 assertion (4 Failed). Các ID dưới đây là sai khác với `Testing-Scenario-v2.docx`, cần chủ yêu cầu xác nhận trước khi sửa nghiệp vụ.

## DEF-01 — Đơn ONLINE hoàn tất giao hàng khi chưa ship

- **Yêu cầu / ca:** FR-M07-02, TC-NG-22. Kịch bản yêu cầu `complete` đơn giao hàng trước `ship` trả 409 `ORDER_INVALID_STATE`, trạng thái và tồn không đổi.
- **Bước tái hiện:** Tạo tenant mới, chi nhánh/kho/SKU, nhập 12 đơn vị. Tạo đơn ONLINE x1 với `autoConfirm=false`; gọi `/orders/{id}/confirm`; khi chưa `pack`/`ship`, gọi `POST /sales/api/v1/orders/{id}/complete` với version hiện hành qua Gateway.
- **Thực tế:** Cả ba lượt Newman trả **200**; response `fulfillmentStatus=delivered`. PostgreSQL lượt mới ghi đơn `c88449e7-c656-446d-9444-67df4fee428a` là `CONFIRMED/FULFILLED`, `fulfillmentStage=null`. Tồn SKU từ 10 còn **9**, `reserved=0`, chứng tỏ giữ tồn đã được commit dù chưa ship.
- **Mức độ đề xuất:** High, vì bỏ qua bước giao hàng và làm thay đổi tồn thực tế. **Trạng thái:** Open, cần triage quy tắc ONLINE so với POS pickup.
- **Bằng chứng:** `attempt-5.summary.json`, `attempt-6.summary.json`, `attempt-7.summary.json`, `attempt-7.db.json`; Newman HTML/log tương ứng trong `evidence/nguyen/`.

## DEF-02 — Thiếu tồn trả 409 nhưng vẫn lưu đơn x100 không gắn cờ

- **Yêu cầu / ca:** FR-M05-08, BR-02, TC-NG-23. Kịch bản yêu cầu đơn đa kênh thiếu tồn vẫn tạo và gắn cờ cảnh báo, trong khi POS thiếu tồn bị chặn 409.
- **Bước tái hiện:** Sau khi tạo SKU và nhập 12 đơn vị, gọi `POST /sales/api/v1/orders/omnichannel` cho đơn ONLINE x100, `autoConfirm=true`, qua Gateway.
- **Thực tế:** Cả ba lượt Newman trả **409 `INSUFFICIENT_STOCK`** thay vì 201/cờ thiếu tồn. PostgreSQL tenant lượt mới vẫn lưu đơn `63789b02-73f3-46bc-b3b7-afa5184b0e75`, mã `HD-20261111-000010`, dòng **100**, `orderStatus=PENDING`, `fulfillmentStatus=UNFULFILLED`, `exceptionCode=null`. Response 409 không trả ID đơn cho client. Source tạo order trong transaction riêng rồi mới gọi confirm; lỗi confirm không rollback order.
- **Mức độ đề xuất:** High, vì client có thể retry sau 409 và tạo thêm đơn không gắn cờ. **Trạng thái:** Open, cần triage liệu chính sách cờ thiếu hàng áp dụng cho public `autoConfirm` hay chỉ nguồn webhook; dù chính sách nào, tác dụng phụ sau 409 cần xử lý rõ.
- **Bằng chứng:** `attempt-5.summary.json`, `attempt-6.summary.json`, `attempt-7.summary.json`, `attempt-7.db.json` và `apps/sales/src/modules/orders/m3-orders.service.ts`.

## Giới hạn và quyết định cần làm rõ

- **DEF-03 / BR-05 (sai khác tĩnh):** SRS yêu cầu mã đơn duy nhất trong tenant và format cấu hình được. `apps/sales/src/infrastructure/persistence/sales-code.generator.ts` cố định `HD-yyyyMMdd-######`, chỉ nhận `tenantId`, prefix và thời gian; không đọc cấu hình format theo tenant. TC-NG-21 xác minh mã không trùng trong tenant và regex hiện hành; TC-NG-26 **Passed**, xác minh tenant B có sequence riêng qua Gateway. Cần hợp đồng API/thiết lập format trước khi có thể viết ca cấu hình động; không gán Passed cho phần này.
- Bằng chứng PostgreSQL dùng truy vấn chỉ đọc theo `tenant_id` của từng lượt. JSON gốc của Newman chứa token và chỉ lưu local trong `test/api/nguyen/reports/`; các bản trong `docs/testing/evidence/nguyen/` đã giới hạn trường và không chứa token.
- Chưa sửa mã nghiệp vụ. Sau khi thống nhất quy tắc, giao chủ module Sales sửa, sau đó chạy lại toàn bộ collection và đối chiếu DB.
