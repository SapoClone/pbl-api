# Bàn giao kiểm thử API của Nguyên

Ngày 11/11/2026. Branch `test/nguyen-api-order-lifecycle-stock-reservation`.

## Phạm vi và file

Phần 3 `Testing-Scenario-v2.docx`: Chức năng 5 (vòng đời đơn online), Chức năng 6 (giữ tồn/mã đơn), đối chiếu SRS v1.1 và báo cáo mẫu. Bộ test tại `test/api/nguyen/`: `generate_collection.py`, `nguyen.postman_collection.json`, `run.mjs`, `package.json`, `.gitignore`, `README.md`. Báo cáo `docs/testing/BaoCao-KiemThu-API-Nguyen-DonOnline-GiuTon.docx`, mã tạo báo cáo `docs/testing/generate_nguyen_report.py`, log và JSON/HTML preflight đã lọc trong `docs/testing/evidence/nguyen/`.

Không đưa thay đổi có sẵn tại `docker/elasticmq.conf` vào commit. Các file `reports/` trong thư mục test bị ignore vì raw Newman JSON có thể chứa token.

## Cách chạy và kết quả quan sát

Từ root `pbl-api`, chạy `npm --prefix test/api/nguyen run test:api`. Lệnh tự bật Compose, seed tenant/chi nhánh/kho/SKU/tồn riêng, cài Newman và chạy collection. `README.md` ghi điều kiện tiên quyết và cách dùng stack đã có.

Đã gọi lệnh runner ba lần. Cả ba đều **BLOCKED trước seed và Newman**: Docker Desktop Linux named pipe trả `permission denied`. `docker --context default info` cũng bị từ chối tại `docker_engine`; cổng Gateway 8080 không lắng nghe. Vì vậy **25/25 ca Blocked, 0 Passed, 0 Failed nghiệp vụ**. Không có response API, truy vấn DB, Newman JSON/HTML hay lượt chạy lặp thành công. Các `attempt-1..3.log`, `.blocked.json`, `.blocked.html` ghi rõ `newmanExecuted=false`, `passedCases=0`; HTML này là báo cáo trở ngại, không phải Newman report.

Collection có 69 request cho TC-NG-01..25, gồm bước đọc lại order/tồn. Ca 25 gửi hai xác nhận gần đồng thời; ca 16 kiểm tranh chấp theo thứ tự. Các script Postman đã parse bằng Node VM; `run.mjs` qua `node --check`; DOCX OpenXML được parse hợp lệ. Những kiểm tra tĩnh này không thay thế cho thực thi API.

## Truy vết, defect, phần chưa phủ

Ma trận FR-M07-02/03, FR-M05-08, BR-02/05 và từng ca nằm trong báo cáo Word. `BLOCK-01`: quyền truy cập Docker daemon. Chưa có defect nghiệp vụ nào xác nhận; khác biệt dự đoán giữa SRS/code ở TC-NG-22 (complete trước ship) và TC-NG-23 (cờ thiếu tồn online) chỉ là giả thuyết cần response. BR-05 chưa kiểm định dạng **cấu hình được** và hai tenant; TC-NG-21 mới kiểm mã duy nhất/regex trong một tenant. Ca 25 là hai request gần đồng thời, không chứng minh xử lý đúng cùng một thời điểm trên mọi lịch thực thi.

## Các bước tiếp tục

1. Cho tài khoản chạy kiểm thử quyền truy cập Docker Desktop daemon; xác nhận `docker info`. Mở DNS/npm registry cho Newman. Kiểm tra Gateway 8080 và chạy lệnh README.
2. Dựa trên log, khắc phục lỗi seed hoặc assertion nếu phát sinh; đối chiếu `GET /sales/api/v1/orders/{id}`, `GET /inventory/api/v1/stock-levels?branchId=...` và SQL theo `tenant_id` riêng. Không đổi trạng thái Blocked thành Passed chỉ dựa trên source.
3. Chạy lại toàn bộ ít nhất hai lần trên tenant mới. Lưu Newman JSON/HTML và response, lọc bearer token trước khi commit bằng chứng. Lập defect có bước tái hiện và response thực tế; cập nhật số liệu báo cáo Word bằng `generate_nguyen_report.py`.
4. Bổ sung BR-05 cấu hình và đa tenant nếu API thực tế hỗ trợ; xác minh ca 22/23 với chủ yêu cầu khi hành vi khác kỳ vọng.
5. Push branch `test/nguyen-api-order-lifecycle-stock-reservation` khi GitHub truy cập được. Kiểm tra `git log -1 --oneline`, `git status --short`, `git push -u origin test/nguyen-api-order-lifecycle-stock-reservation` và xác nhận remote SHA.

## Commit và push

Commit cục bộ chứa các file nêu trên. Xem SHA bằng `git log -1 --oneline`; push chưa xác nhận vì `git ls-remote origin` lỗi kết nối (`getaddrinfo() thread failed to start`). Trạng thái này chỉ thay đổi sau khi lệnh push và đối chiếu remote thành công.
