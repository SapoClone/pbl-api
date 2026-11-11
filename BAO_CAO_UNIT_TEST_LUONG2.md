# BÁO CÁO KIỂM THỬ ĐƠN VỊ (UNIT TEST) - PHẦN 2: DỊCH VỤ SALES
**Người thực hiện (Hius) - Chuyên viên Kiểm thử Phần mềm Chuyên sâu (Unit Test Engineer)**  
**Dự án:** Sapo Clone (PBL6 - SaaS Quản trị Bán lẻ Đa kênh)  
**Tài liệu quy chiếu:** `Testing-Scenario-v2.docx` (Phần 2: Unit test - Hius)  
**Mã nguồn kiểm thử:** `pbl-api/apps/sales/src/domain/sales-domain.ts`  
**File test thực thi:** `pbl-api/apps/sales/src/domain/sales-domain.spec.ts`

---

## 1. MỤC TIÊU & KỸ THUẬT ÁP DỤNG

### 1.1. Mục tiêu kiểm thử
Đảm bảo tính chính xác tuyệt đối của logic nghiệp vụ cốt lõi (Core Business Rules - BR-02) trong dịch vụ Sales ở tầng Domain thuần túy (Pure TypeScript Domain Layer):
1. **Chức năng 3 (FR-M06-03, FR-M06-05): Tính chiết khấu và giới hạn theo quyền (RBAC Discount Authority).**
   - Đảm bảo tính toán chiết khấu phần trăm (PERCENT) và chiết khấu số tiền (FIXED) theo quy tắc dòng và đơn hàng.
   - Kiểm soát nghiêm ngặt trần chiết khấu tối đa cho từng vai trò (`sales_staff: 10%`, `branch_manager: 30%`, `owner: 100%`, vai trò kế thừa `manager: 30%`, `cashier: 10%`, vai trò mặc định/không xác định: `10%`).
   - Kiểm tra cơ chế cấp quyền ngoại lệ (`sales.pos.discount.override` và wildcard `*`).
   - Kiểm tra thuật toán làm tròn tiền tệ VND (Half-up Rounding) đối với các phép tính phần trăm ra số thập phân.
2. **Chức năng 4 (FR-M06-08): Thanh toán kết hợp và tính tiền thừa (Combined Tenders & Change Due).**
   - Hỗ trợ thanh toán chia nhỏ (Split Tender) kết hợp nhiều phương thức: Tiền mặt (`CASH`), Chuyển khoản (`BANK_TRANSFER`), Thu hộ (`COD`).
   - Tính toán chính xác tiền thối (`changeDue = tenderedCash - amount`) cho dòng tiền mặt.
   - Xác định chính xác trạng thái xác thực (`CONFIRMED` khi có đủ `verified = true` và `externalRef`) và trạng thái thanh toán tổng thể đơn hàng (`PAID`, `PARTIALLY_PAID`, `UNPAID`).
   - Ngăn chặn triệt để các hành vi gian lận hoặc sai lệch tiền tệ (trả thiếu tiền mặt, phân bổ lệch tổng tiền đơn hàng, danh sách thanh toán rỗng, số tiền âm, số tiền thập phân).

---

### 1.2. Kỹ thuật kiểm thử & Thiết kế ca kiểm nghiệm
1. **Phân tích giá trị biên (Boundary Value Analysis - BVA):**
   - Tập trung vào các điểm kỳ dị và ngưỡng chuyển đổi trạng thái:
     - Tỷ lệ phần trăm chiết khấu: `0%` (biên dưới), `10%` (trần nhân viên), `10.01%` (vượt trần 0.01%), `30%` (trần quản lý), `30.01%` (vượt trần quản lý), `100%` (trần chủ cửa hàng), `-0.01%`, `100.01%`.
     - Chiết khấu tiền cố định: Bằng chính xác giá trị đơn hàng (thành tiền = 0đ) vs. Lớn hơn đúng 1đ (ném lỗi 422).
     - Làm tròn Half-up với tiền VND: `12.5%` của `99.999đ` (ra `12.499,875đ` -> làm tròn lên `12.500đ`) vs. `100.001đ` (ra `12.500,125đ` -> làm tròn xuống `12.500đ`); `0.5đ` làm tròn lên `1đ`, `0.49đ` làm tròn xuống `0đ`.
     - Tiền mặt đưa vào: `tenderedCash = amount` (tiền thừa 0đ) vs. `tenderedCash = amount - 1` (ném lỗi 422).
     - Đơn hàng 0 đồng (khách không phải trả tiền).
2. **Phân vùng tương đương (Equivalence Partitioning - EP):**
   - Phân chia đầu vào thành các lớp tương đương hợp lệ và không hợp lệ:
     - Lớp chiết khấu: `[0, MaxRole]` (Hợp lệ không cần duyệt) | `(MaxRole, 100]` (Cần quản lý duyệt - 403) | `(-∞, 0) ∪ (100, +∞)` (Dữ liệu không hợp lệ - 422).
     - Lớp thanh toán: Chuyển khoản đủ điều kiện (`verified = true && externalRef != null` -> `CONFIRMED`) vs. Thiếu 1 trong 2 điều kiện (`PENDING`).
     - Lớp tiền tệ: Số nguyên an toàn không âm (Hợp lệ) vs. Số âm hoặc số thực có phần thập phân (Bị từ chối với 422).
3. **Tối ưu hóa bằng Data-Driven Testing (`it.each`):**
   - Gom các kịch bản kiểm thử biên và ma trận vai trò vào các bảng dữ liệu `it.each` có cấu trúc rõ ràng. Giúp giảm hơn 70% độ dài mã nguồn lặp lại, tăng khả năng mở rộng và hiển thị báo cáo chi tiết từng dòng dữ liệu kiểm thử trực quan trong terminal.
4. **Môi trường Unit Test siêu nhẹ (Pure Domain Testing):**
   - Tất cả các hàm kiểm thử là Pure Functions nằm trong `sales-domain.ts`, không gọi I/O, không đụng tới Docker, Redis hay PostgreSQL. Toàn bộ test suite chạy hoàn tất chỉ trong ~7 giây.

---

## 2. BẢNG TỔNG HỢP TEST CASES MỚI BỔ SUNG

### 2.1. Chức năng 3: Tính chiết khấu & Giới hạn theo quyền (calculateItemDiscount, assertDiscountAuthority)

| Mã Test Case | Kịch bản / Mục tiêu kiểm thử | Kỹ thuật | Input dữ liệu | Kỳ vọng (Expected Code / Output) | Kết quả thực tế |
|---|---|:---:|---|---|:---:|
| **UT-DISC-01** | Chiết khấu phần trăm mốc 0% | BVA | `lineGross = 100000`, `percent = 0` | `discount = 0 VND` | **PASS** |
| **UT-DISC-02** | Chiết khấu phần trăm mốc 10% (trần nhân viên) | BVA | `lineGross = 100000`, `percent = 10` | `discount = 10000 VND` | **PASS** |
| **UT-DISC-03** | Chiết khấu phần trăm mốc 30% (trần quản lý) | BVA | `lineGross = 100000`, `percent = 30` | `discount = 30000 VND` | **PASS** |
| **UT-DISC-04** | Chiết khấu phần trăm mốc 50% (giảm một nửa) | EP | `lineGross = 100000`, `percent = 50` | `discount = 50000 VND` | **PASS** |
| **UT-DISC-05** | Chiết khấu phần trăm mốc 100% (miễn phí) | BVA | `lineGross = 100000`, `percent = 100` | `discount = 100000 VND` | **PASS** |
| **UT-DISC-06** | Biên dưới âm nhỏ nhất (-0.01%) | BVA | `lineGross = 100000`, `percent = -0.01` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-07** | Phần trăm chiết khấu âm (-5%) | EP | `lineGross = 100000`, `percent = -5` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-08** | Biên trên vượt 100% (100.01%) | BVA | `lineGross = 100000`, `percent = 100.01` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-09** | Phần trăm vượt 100% (105%) | EP | `lineGross = 100000`, `percent = 105` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-10** | Dữ liệu không hợp lệ (NaN, +Infinity) | EP | `percent = NaN`, `percent = +Infinity` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-11** | `sales_staff` trong trần cho phép (0%, 10%) | BVA | `role = 'sales_staff'`, `percent = 0`, `10` | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-12** | `branch_manager` trong trần cho phép (0%, 30%) | BVA | `role = 'branch_manager'`, `percent = 0`, `30` | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-13** | `owner` trong trần cho phép (0%, 100%) | BVA | `role = 'owner'`, `percent = 0`, `100` | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-14** | Vai trò cũ `manager` (30%), `cashier` (10%) | EP | `manager: 30%`, `cashier: 10%` | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-15** | Role không truyền hoặc role lạ nhận trần 10% | EP | `role = undefined`, `role = 'unknown_role'` (10%) | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-16** | `sales_staff` vượt trần (10.01%, 15%) | BVA | `role = 'sales_staff'`, `percent = 10.01`, `15` | Lỗi 403 `DISCOUNT_APPROVAL_REQUIRED` | **PASS** |
| **UT-DISC-17** | `branch_manager` vượt trần (30.01%, 35%) | BVA | `role = 'branch_manager'`, `percent = 30.01`, `35` | Lỗi 403 `DISCOUNT_APPROVAL_REQUIRED` | **PASS** |
| **UT-DISC-18** | Vai trò cũ `manager` (30.01%), `cashier` (10.01%) | BVA | `manager: 30.01%`, `cashier: 10.01%` | Lỗi 403 `DISCOUNT_APPROVAL_REQUIRED` | **PASS** |
| **UT-DISC-19** | Role không truyền hoặc role lạ vượt trần 10.01% | BVA | `role = undefined`, `role = 'trainee_intern'` (10.01%) | Lỗi 403 `DISCOUNT_APPROVAL_REQUIRED` | **PASS** |
| **UT-DISC-20** | Quyền đặc biệt override (`sales.pos.discount.override`, `*`) | EP | `sales_staff` chiết khấu 99.99%, wildcard `*` chiết khấu 100% | Hợp lệ (không ném lỗi) | **PASS** |
| **UT-DISC-21** | Chiết khấu FIXED đúng bằng tiền hàng dòng | BVA | `lineGross = 150000`, `fixed = 150000` | Chiết khấu `150000đ`, thành tiền `0đ` | **PASS** |
| **UT-DISC-22** | Chiết khấu FIXED đúng bằng tổng hóa đơn | BVA | `subtotal = 150000`, `orderDiscount = 150000` | `totalDiscount = 150000`, `grandTotal = 0` | **PASS** |
| **UT-DISC-23** | Chiết khấu FIXED lớn hơn tiền hàng dòng 1đ | BVA | `lineGross = 150000`, `fixed = 150001` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-24** | Chiết khấu FIXED lớn hơn tổng hóa đơn 1đ | BVA | `subtotal = 150000`, `orderDiscount = 150001` | Lỗi 422 `INVALID_DISCOUNT` | **PASS** |
| **UT-DISC-25** | Làm tròn Half-up: 12.5% của 99.999đ | BVA/Math | `gross = 99999`, `percent = 12.5` | `12500đ` (làm tròn lên từ 12499.875) | **PASS** |
| **UT-DISC-26** | Làm tròn Half-up: 12.5% của 100.001đ | BVA/Math | `gross = 100001`, `percent = 12.5` | `12500đ` (làm tròn xuống từ 12500.125) | **PASS** |
| **UT-DISC-27** | Làm tròn Half-up: 5% của 10đ (đúng 0.5đ) | BVA/Math | `gross = 10`, `percent = 5` | `1đ` (làm tròn half-up lên từ 0.5) | **PASS** |
| **UT-DISC-28** | Làm tròn Half-up: 4.9% của 10đ (0.49đ) | BVA/Math | `gross = 10`, `percent = 4.9` | `0đ` (làm tròn xuống từ 0.49) | **PASS** |

---

### 2.2. Chức năng 4: Thanh toán kết hợp & Tiền thừa (validateOrderTenders)

| Mã Test Case | Kịch bản / Mục tiêu kiểm thử | Kỹ thuật | Input dữ liệu | Kỳ vọng (Expected Code / Output) | Kết quả thực tế |
|---|---|:---:|---|---|:---:|
| **UT-PAY-01** | Thanh toán kết hợp: Tiền mặt + Chuyển khoản đủ điều kiện | EP | Đơn `500k`: Cash `200k` (đưa `250k`), Bank Transfer `300k` (`verified = true`, `ref = 'FT26303001'`) | Cả 2 dòng `CONFIRMED`, `changeDue = 50k`, `allConfirmed = true`, `paymentStatus = 'PAID'` | **PASS** |
| **UT-PAY-02** | Khách đưa tiền mặt lớn hơn phân bổ | BVA | Tiền hàng `200k`, khách đưa `tenderedCash = 250k` | `changeDue = 50000đ` | **PASS** |
| **UT-PAY-03** | Khách đưa tiền mặt rất lớn so với đơn | BVA | Tiền hàng `100k`, khách đưa `tenderedCash = 1000k` | `changeDue = 900000đ` | **PASS** |
| **UT-PAY-04** | Khách trả vừa khít tiền mặt | BVA | Tiền hàng `150k`, khách đưa `tenderedCash = 150k` | `changeDue = 0đ` | **PASS** |
| **UT-PAY-05** | Không truyền `tenderedCash` (mặc định) | EP | Tiền hàng `300k`, `tenderedCash = undefined` | `changeDue = 0đ` | **PASS** |
| **UT-PAY-06** | Đơn hàng 0 đồng (khách trả 0đ) | BVA | `grandTotal = 0`, Cash `amount = 0`, `tendered = 0` | `changeDue = 0đ`, `paymentStatus = 'PAID'` | **PASS** |
| **UT-PAY-07** | Chuyển khoản có mã ref nhưng chưa verified | EP | Transfer `300k`, `verified = false`, `ref = 'TX123'` | `status = 'PENDING'`, `paymentStatus = 'UNPAID'` | **PASS** |
| **UT-PAY-08** | Chuyển khoản verified = true nhưng thiếu mã ref | EP | Transfer `300k`, `verified = true`, `ref = undefined` | `status = 'PENDING'`, `paymentStatus = 'UNPAID'` | **PASS** |
| **UT-PAY-09** | Kết hợp: Cash (đã nhận) + Transfer (chưa verified) | EP | Cash `100k` (CONFIRMED) + Transfer `200k` (PENDING) | `allConfirmed = false`, `paymentStatus = 'PARTIALLY_PAID'` | **PASS** |
| **UT-PAY-10** | Phương thức COD luôn PENDING | EP | COD `300k` | `status = 'PENDING'`, `paymentStatus = 'UNPAID'` | **PASS** |
| **UT-PAY-11** | Tiền khách đưa thiếu 1đ so với phân bổ tiền mặt | BVA | Cash `amount = 100000`, `tenderedCash = 99999` | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-12** | Khách đưa 0đ cho khoản phân bổ tiền mặt | BVA | Cash `amount = 50000`, `tenderedCash = 0` | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-13** | Tổng tiền phân bổ thiếu so với đơn | BVA | Đơn `100k`, phân bổ `90k` | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-14** | Tổng tiền phân bổ thừa so với đơn | BVA | Đơn `100k`, phân bổ `110k` | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-15** | Phân bổ kết hợp không khớp tổng đơn | EP | Đơn `500k`, Cash `200k` + Transfer `250k` (tổng `450k`) | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-16** | Danh sách tenders rỗng | BVA | Đơn `100k`, `tenders = []` | Lỗi 422 `PAYMENT_AMOUNT_MISMATCH` | **PASS** |
| **UT-PAY-17** | Số tiền thanh toán âm | EP | Cash `amount = -50000` | Lỗi 422 `VALIDATION_ERROR` | **PASS** |
| **UT-PAY-18** | Số tiền thanh toán có số thập phân lẻ | EP | Cash `amount = 50000.5` | Lỗi 422 `VALIDATION_ERROR` | **PASS** |
| **UT-PAY-19** | Tiền khách đưa âm | EP | Cash `amount = 100000`, `tenderedCash = -10000` | Lỗi 422 `VALIDATION_ERROR` | **PASS** |
| **UT-PAY-20** | Tiền khách đưa có số thập phân lẻ | EP | Cash `amount = 100000`, `tenderedCash = 100000.75` | Lỗi 422 `VALIDATION_ERROR` | **PASS** |

---

## 3. HƯỚNG DẪN THỰC THI KIỂM THỬ & TRẢ LỜI VẤN ĐÁP

### 3.1. Các câu lệnh chạy kiểm thử trong Terminal

1. **Chạy riêng các test case liên quan đến Chiết khấu (Discount):**
   ```powershell
   pnpm exec jest apps/sales/src/domain -t "discount"
   ```
   *Kết quả:* Chạy 45 tests liên quan đến chiết khấu và RBAC trần quyền, 100% Passed.

2. **Chạy toàn bộ Unit Test suite của tầng Domain nghiệp vụ Sales:**
   ```powershell
   pnpm exec jest apps/sales/src/domain
   ```
   *Kết quả thực tế trên máy:*
   ```text
   PASS apps/sales/src/domain/sales-domain.spec.ts (5.717 s)
   PASS apps/sales/src/domain/cash-session.spec.ts (6.892 s)

   Test Suites: 2 passed, 2 total
   Tests:       100 passed, 100 total
   Snapshots:   0 total
   Time:        7.305 s
   Ran all test suites matching /apps\sales\src\domain/i.
   ```

---

### 3.2. Cẩm nang trả lời vấn đáp cho Giảng viên

#### Câu hỏi 1: "Tại sao nhóm chọn kiểm thử các chức năng này ở tầng Unit Test thay vì gọi API qua Postman/Newman?"
- **Trả lời:**
  - Theo mô hình **Test Diamond** và nguyên tắc phân chia trách nhiệm kiểm thử của nhóm:
    - Logic tính toán số học, làm tròn tiền tệ VND, phân tích giá trị biên (0%, 10%, 10.01%, v.v.), và xác thực tổ hợp thanh toán là **Pure Domain Logic** (hàm thuần túy).
    - Các hàm này không có tác dụng phụ (side-effects), không cần kết nối cơ sở dữ liệu Postgres hay cache Redis, nên kiểm thử ở tầng Unit Test bằng **Jest** cho tốc độ phản hồi cực nhanh (< 8 giây cho 100 test cases).
    - Tầng API (Postman/Newman do bạn Thịnh và Nguyên phụ trách) sẽ tập trung vào phân quyền HTTP, cô lập đa khách thuê (Multi-tenancy isolation), lưu vết cơ sở dữ liệu và vòng đời chuyển đổi trạng thái đơn hàng.

#### Câu hỏi 2: "Việc sử dụng `it.each` mang lại lợi ích gì so với viết từng hàm `it()` truyền thống?"
- **Trả lời:**
  - `it.each` là kỹ thuật **Parameterized Testing (Data-Driven Testing)** trong Jest.
  - Thay vì copy-paste hàng chục hàm `it()` với cùng cấu trúc assertion gây trùng lặp mã nguồn (Code Duplication) và khó bảo trì:
    1. Gom toàn bộ ma trận dữ liệu biên vào một mảng bảng dữ liệu duy nhất (`inputs`, `expected`).
    2. Tự động sinh tên test case linh hoạt thông qua cú pháp nội suy chuỗi `$desc`, `$percent`, `$role`.
    3. Khi cần bổ sung thêm ca kiểm thử mới (ví dụ thêm vai trò hoặc mốc biên mới), chỉ cần thêm đúng 1 dòng vào mảng dữ liệu mà không cần sửa logic assertion.

#### Câu hỏi 3: "Hệ thống phân biệt các mã lỗi 403, 409, và 422 như thế nào trong domain Sales?"
- **Trả lời:**
  - **Lỗi 403 `DISCOUNT_APPROVAL_REQUIRED`:** Dữ liệu chiết khấu hợp lệ về mặt toán học (0 - 100%), nhưng vượt quá thẩm quyền cho phép của vai trò người dùng (ví dụ: nhân viên bán hàng cố ý nhập chiết khấu 10.01% hoặc 15% khi trần chỉ là 10%). Cần người có quyền quản lý duyệt.
  - **Lỗi 422 `INVALID_DISCOUNT`:** Dữ liệu chiết khấu vi phạm quy tắc toán học nghiệp vụ (nhập số âm, nhập vượt quá 100%, hoặc chiết khấu số tiền lớn hơn tổng giá trị hàng).
  - **Lỗi 422 `PAYMENT_AMOUNT_MISMATCH`:** Vi phạm tính cân bằng của sổ sách thanh toán (khách đưa tiền mặt ít hơn số tiền mặt cần trả, tổng phân bổ các phương thức khác tổng giá trị hóa đơn, hoặc danh sách phương thức rỗng).
  - **Lỗi 422 `VALIDATION_ERROR`:** Vi phạm định dạng tiền tệ cơ bản (tiền VND bắt buộc là số nguyên an toàn `Number.isSafeInteger`, không chấp nhận số âm hoặc phần lẻ thập phân).
  - **Lỗi 409 `ORDER_INVALID_STATE`:** Đơn hàng vi phạm máy trạng thái 3 chiều (ví dụ hủy đơn đã hoàn tất).

#### Câu hỏi 4: "Tại sao tiền VND lại cần hàm làm tròn riêng `roundDivHalfUp` thay vì dùng `Math.round` của JavaScript?"
- **Trả lời:**
  - Toàn bộ phép tính tiền VND trong `sales-domain.ts` được tính toán bằng kiểu dữ liệu số nguyên lớn `bigint` để tránh hiện tượng sai số dấu phẩy động (Floating-point Drift) như `0.1 + 0.2 !== 0.3`.
  - Do `bigint` không hỗ trợ số thập phân và phép chia `bigint / bigint` mặc định bị làm tròn xuống (truncate towards zero), hệ thống triển khai hàm `roundDivHalfUp(numerator, denominator)` bằng công thức:
    $$\lfloor \frac{\text{numerator} + \lfloor \text{denominator} / 2 \rfloor}{\text{denominator}} \rfloor$$
    để đạt được quy chuẩn làm tròn **Half-Up (≥ 0.5 thì làm tròn lên)** chính xác tuyệt đối cho tiền đồng Việt Nam.
