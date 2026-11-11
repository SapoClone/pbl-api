# Bàn giao kiểm thử API của Nguyên

Ngày 11/11/2026. Branch `test/nguyen-api-order-lifecycle-stock-reservation`.

## Phạm vi và file

Phần 3 `Testing-Scenario-v2.docx`: Chức năng 5 (vòng đời đơn online), Chức năng 6 (giữ tồn/mã đơn), đối chiếu SRS v1.1 và báo cáo mẫu. Bộ test tại `test/api/nguyen/`: `generate_collection.py`, `nguyen.postman_collection.json`, `run.mjs`, `package.json`, `.gitignore`, `README.md`. Báo cáo `docs/testing/BaoCao-KiemThu-API-Nguyen-DonOnline-GiuTon.docx`, mã tạo báo cáo `docs/testing/generate_nguyen_report.py`, log và JSON/HTML preflight đã lọc trong `docs/testing/evidence/nguyen/`.

Không đưa thay đổi có sẵn tại `docker/elasticmq.conf` vào commit. Các file `reports/` trong thư mục test bị ignore vì raw Newman JSON có thể chứa token.

## Cách chạy và kết quả quan sát

Từ root `pbl-api`, chạy `npm --prefix test/api/nguyen run test:api`. Lệnh tự bật Compose, seed tenant/chi nhánh/kho/SKU/tồn riêng, cài Newman và chạy collection. `README.md` ghi điều kiện tiên quyết và cách dùng stack đã có.

Ba lượt đầu **BLOCKED trước seed** vì phiên agent không được truy cập Docker daemon. Lượt 4 từ PowerShell người dùng dừng ở **409 Q001** do tenant Free đã có chi nhánh mặc định. Bản sửa runner dùng `GET /branches` đã được xác minh ở lượt 5: seed thành công và Newman thực thi **71 HTTP request, 123 assertion, 6 assertion Failed**. Theo 25 case: **21 Passed, 4 Failed, 0 Blocked**. TC-NG-01/15 thất bại do assertion test mong `pending` trong khi API trả `new`; đã sửa generator/collection, chưa chạy lại. TC-NG-22/23 khác kịch bản yêu cầu và tiếp tục giữ Failed để triage. Chưa có lượt Newman thứ hai hoặc đối chiếu SQL trực tiếp. `attempt-5.summary.json`, `.newman.html`, `.log` là bằng chứng đã lọc; Newman JSON gốc nằm trong `test/api/nguyen/reports/` và không commit vì chứa token.

Collection có 69 request cho TC-NG-01..25, gồm bước đọc lại order/tồn. Ca 25 gửi hai xác nhận gần đồng thời; ca 16 kiểm tranh chấp theo thứ tự. Các script Postman đã parse bằng Node VM; `run.mjs` qua `node --check`; DOCX OpenXML được parse hợp lệ. Những kiểm tra tĩnh này không thay thế cho thực thi API.

## Truy vết, defect, phần chưa phủ

Ma trận FR-M07-02/03, FR-M05-08, BR-02/05 và từng ca nằm trong báo cáo Word. `DEF-01`: TC-NG-22 đơn ONLINE complete trước ship trả 200/delivered, kịch bản mong 409 ORDER_INVALID_STATE. `DEF-02`: TC-NG-23 đơn ONLINE `autoConfirm=true` thiếu tồn trả 409 INSUFFICIENT_STOCK, kịch bản mong tạo đơn và gắn cờ thiếu tồn. Hai khác biệt có response thật và cần chủ yêu cầu xác nhận phạm vi trước khi sửa nghiệp vụ. BR-05 chưa kiểm định dạng **cấu hình được** và hai tenant; TC-NG-21 mới kiểm mã duy nhất/regex trong một tenant. Ca 25 có một request 200, một 409 và tồn giữ đúng 10, nhưng không chứng minh mọi lịch thực thi đồng thời.

## Các bước tiếp tục

1. Từ PowerShell người dùng, chạy lại `node test/api/nguyen/run.mjs --existing-stack` sau khi TC-01/15 đã sửa assertion. Collection tạo tenant mới; stack đang bật nên không cần build lại.
2. Đối chiếu `GET /sales/api/v1/orders/{id}`, `GET /inventory/api/v1/stock-levels?branchId=...` và SQL theo `tenant_id` riêng. Kết quả lần 1 được tóm tắt tại `attempt-5.summary.json`; không coi 22/23 Passed.
3. Chạy lại toàn bộ ít nhất hai lần trên tenant mới. Lưu Newman JSON/HTML và response, lọc bearer token trước khi commit bằng chứng. Triage DEF-01/02 với chủ yêu cầu; cập nhật số liệu báo cáo Word bằng `generate_nguyen_report.py`.
4. Bổ sung BR-05 cấu hình và đa tenant nếu API thực tế hỗ trợ; xác minh ca 22/23 với chủ yêu cầu khi hành vi khác kỳ vọng.
5. Push branch `test/nguyen-api-order-lifecycle-stock-reservation` khi GitHub truy cập được. Kiểm tra `git log -1 --oneline`, `git status --short`, `git push -u origin test/nguyen-api-order-lifecycle-stock-reservation` và xác nhận remote SHA.

## Commit và push

Commit triển khai cục bộ: `484d472`; commit ghi trạng thái push: `9f18652`. Bản sửa Q001 được commit tiếp sau hai commit này. Lệnh `git push -u origin test/nguyen-api-order-lifecycle-stock-reservation` từng thất bại với `getaddrinfo() thread failed to start` trong phiên agent; push chưa xác nhận. Trạng thái này chỉ thay đổi sau khi lệnh push và đối chiếu remote thành công.
