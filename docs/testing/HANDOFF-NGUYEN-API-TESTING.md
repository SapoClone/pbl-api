# Bàn giao kiểm thử API của Nguyên

Ngày 11/11/2026. Branch `test/nguyen-api-order-lifecycle-stock-reservation`.

## Phạm vi và file

Phần 3 `Testing-Scenario-v2.docx`: Chức năng 5 (vòng đời đơn online), Chức năng 6 (giữ tồn/mã đơn), đối chiếu SRS v1.1 và báo cáo mẫu. Bộ test tại `test/api/nguyen/`: `generate_collection.py`, `nguyen.postman_collection.json`, `run.mjs`, `compose.override.yml`, `summarize_newman.mjs`, `verify_db.mjs`, `package.json`, `package-lock.json`, `.gitignore`, `README.md`. Báo cáo `docs/testing/BaoCao-KiemThu-API-Nguyen-DonOnline-GiuTon.docx`, `DEFECTS-NGUYEN-API.md`, mã tạo báo cáo `docs/testing/generate_nguyen_report.py`, log và JSON/HTML/DB evidence đã lọc trong `docs/testing/evidence/nguyen/`.

Không đưa thay đổi có sẵn tại `docker/elasticmq.conf` vào commit. Các file `reports/` trong thư mục test bị ignore vì raw Newman JSON có thể chứa token.

## Cách chạy và kết quả quan sát

Từ root `pbl-api`, chạy `npm --prefix test/api/nguyen run test:api`. Lệnh tự bật Compose, seed tenant/chi nhánh/kho/SKU/tồn riêng, cài Newman và chạy collection. `README.md` ghi điều kiện tiên quyết và cách dùng stack đã có.

Ba lượt đầu **BLOCKED trước seed** vì phiên agent không được truy cập Docker daemon. Lượt 4 từ PowerShell người dùng dừng ở **409 Q001** do tenant Free đã có chi nhánh mặc định. Bản sửa runner dùng `GET /branches` đã được xác minh ở lượt 5. Newman chạy hai lượt bộ 25 ca trên tenant riêng: lượt 5 có 21 Passed, 4 Failed; lượt 6 có 23 Passed, 2 Failed. Lượt Compose `05-57-50` bị chặn trước Newman do `fetch failed` lúc seed; runner đã bổ sung bước chờ Platform API. Lượt `06-05-07` **chạy bộ 26 ca: 24 Passed, 2 Failed, 0 Blocked**, 72 HTTP request, 127 assertion, 4 assertion Failed. PostgreSQL cùng lượt xác nhận stock 9/0/9, order TC-22 FULFILLED; đơn x100 của TC-23 còn lưu PENDING, `exceptionCode=null`, dù API trả 409; không có mã trùng. Xem `attempt-7.db.json`. `attempt-5/6/7.summary.json`, `.newman.html`, `.log` là bằng chứng đã lọc; Newman JSON gốc nằm trong `test/api/nguyen/reports/` và không commit vì chứa token.

Collection hiện có 70 item cho TC-NG-01..26, gồm bước đọc lại order/tồn; lượt mới thực hiện 72 HTTP request do polling. Hai lượt Newman trước khi bổ sung TC-NG-26 chạy bộ 69 item. Ca 25 gửi hai xác nhận gần đồng thời; ca 16 kiểm tranh chấp theo thứ tự. TC-NG-26 kiểm tenant B qua Gateway và Passed. Các script Postman đã parse bằng Node VM; `run.mjs` qua `node --check`; DOCX OpenXML được parse hợp lệ.

## Truy vết, defect, phần chưa phủ

Ma trận FR-M07-02/03, FR-M05-08, BR-02/05 và từng ca nằm trong báo cáo Word và `DEFECTS-NGUYEN-API.md`. `DEF-01`: TC-NG-22 đơn ONLINE complete trước ship trả 200/delivered, DB ghi FULFILLED và trừ 1 đơn vị tồn; kịch bản mong 409 ORDER_INVALID_STATE. `DEF-02`: TC-NG-23 đơn ONLINE `autoConfirm=true` thiếu tồn trả 409 INSUFFICIENT_STOCK nhưng DB vẫn lưu đơn x100 `PENDING`, `exceptionCode=null`, không trả ID cho client; kịch bản mong tạo đơn có cờ thiếu tồn. `DEF-03` là sai khác tĩnh của BR-05: generator cố định sáu chữ số, thiếu cấu hình format theo tenant. TC-NG-26 đã xác minh sequence giữa hai tenant nhưng không chứng minh khả năng cấu hình format. Ca 25 có một request 200, một 409 và tồn giữ đúng 10, nhưng không chứng minh mọi lịch thực thi đồng thời.

## Các bước tiếp tục

1. Đối chiếu bằng chứng `attempt-6.db-detail.json` và `DEFECTS-NGUYEN-API.md`: đơn x100 sau 409 đã được xác nhận. Không cần chạy lại truy vấn này để chốt hai defect.
2. Đối chiếu `GET /sales/api/v1/orders/{id}`, `GET /inventory/api/v1/stock-levels?branchId=...` với DB theo `tenant_id` riêng. Lượt 5/6 được tóm tắt tại `attempt-5/6.summary.json`; không coi 22/23 Passed.
3. Bộ 26 ca đã chạy trên tenant mới bằng `node test/api/nguyen/run.mjs --existing-stack` sau lượt `npm --prefix test/api/nguyen run test:api` khởi động Compose nhưng dừng trước Newman do startup timing. Runner tự ghi Newman summary/HTML/log và đối chiếu DB. Chạy lại toàn bộ `npm --prefix test/api/nguyen run test:api` trên tenant mới để xác nhận đường chạy một lệnh; chỉ cập nhật số liệu nếu thực tế thay đổi.
4. Triage DEF-01/02 với chủ yêu cầu. DEF-03 cần thiết kế API cấu hình format; TC-NG-26 giải quyết phần mã hai tenant nhưng không chứng minh cấu hình được.
5. Sau khi đối chiếu DB và hoàn chỉnh báo cáo, push branch `test/nguyen-api-order-lifecycle-stock-reservation` khi GitHub truy cập được. Kiểm tra `git log -1 --oneline`, `git status --short`, `git push -u origin test/nguyen-api-order-lifecycle-stock-reservation` và xác nhận remote SHA. Push nhánh có defect Failed là bàn giao bằng chứng, không đồng nghĩa kiểm thử đạt.

## Commit và push

Commit triển khai cục bộ: `484d472`; commit ghi trạng thái push: `9f18652`. Bản sửa Q001 được commit tiếp sau hai commit này. Lệnh `git push -u origin test/nguyen-api-order-lifecycle-stock-reservation` từng thất bại với `getaddrinfo() thread failed to start` trong phiên agent; push chưa xác nhận. Trạng thái này chỉ thay đổi sau khi lệnh push và đối chiếu remote thành công.
