### Bảng chi tiết test case (sinh từ newman.json — không chứa token)

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
| TC-SEC-AUTH-08 | Khóa thành viên (lock) có hiệu lực ngay với token cũ | POST /api/v1/tenants/current/members/ead499a0-caa2-4fc9-ada6-56208e254690/lock | — | 200 | 200 | Passed |
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
| TC-SEC-RBAC-13 | [owner] Sửa sản phẩm (products.update) → 404 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-14 | [branch_manager] Sửa sản phẩm (products.update) → 404 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-15 | [sales_staff] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-16 | [warehouse_staff] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-17 | [accountant] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-18 | [custom] Sửa sản phẩm (products.update) → 403 | PATCH /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-19 | [owner] Xóa sản phẩm (products.delete) → 404 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 404 | 404 | Passed |
| TC-SEC-RBAC-20 | [branch_manager] Xóa sản phẩm (products.delete) → 404 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 404 | 404 | Passed |
| TC-SEC-RBAC-21 | [sales_staff] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 403 | 403 | Passed |
| TC-SEC-RBAC-22 | [warehouse_staff] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 403 | 403 | Passed |
| TC-SEC-RBAC-23 | [accountant] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 403 | 403 | Passed |
| TC-SEC-RBAC-24 | [custom] Xóa sản phẩm (products.delete) → 403 | DELETE /api/v1/products/648893a1-07fc-475c-adde-31f486557d07 | — | 403 | 403 | Passed |
| TC-SEC-RBAC-25 | [owner] Duyệt phiếu nhập kho (inventory.approve) → 404 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-26 | [branch_manager] Duyệt phiếu nhập kho (inventory.approve) → 404 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 404 | 404 | Passed |
| TC-SEC-RBAC-27 | [sales_staff] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-28 | [warehouse_staff] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-29 | [accountant] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 403 | 403 | Passed |
| TC-SEC-RBAC-30 | [custom] Duyệt phiếu nhập kho (inventory.approve) → 403 | POST /api/v1/stock-receipts/f009cf87-0508-442c-9d53-cfdcbd9cb7e2/post | {} | 403 | 403 | Passed |

#### 03 — RBAC bổ sung

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-X-01 | Sales tạo khách hàng (customers.create) → 201 | POST /api/v1/customers | {"name":"Khách do sales tạo secmwc1avod307c","phone":"0912345679"} | 201 | 201 | Passed |
| TC-SEC-X-02 | Sales sửa khách hàng vừa tạo (customers.update) → 200 | PATCH /api/v1/customers/ed600918-6039-480c-8c04-023f8e071b1d | {"name":"Khách đã sửa secmwc1avod307c"} | 200 | 200 | Passed |
| TC-SEC-X-03 | Sales xóa khách hàng (customers.delete) → 403 | DELETE /api/v1/customers/ed600918-6039-480c-8c04-023f8e071b1d | — | 403 | 403 | Passed |
| TC-SEC-X-04 | Sales tạo đơn hàng (orders.create) → 422 do thiếu dữ liệu, không phải 403 | POST /api/v1/orders | {} | 422 | 422 | Passed |
| TC-SEC-X-05 | Kế toán tạo đơn hàng → 403 | POST /api/v1/orders | {} | 403 | 403 | Passed |
| TC-SEC-X-06 | Nhân viên kho tạo phiếu nhập với warehouseId không tồn tại → 404, không phải 403 | POST /api/v1/stock-receipts | {"warehouseId":"0bcaa108-04f3-47af-b6fd-5b77b026b3b8","items":[{"skuId":"648893a1-07fc-... | 404 | 404 | Passed |
| TC-SEC-X-07 | Kế toán tạo phiếu nhập → 403 | POST /api/v1/stock-receipts | {} | 403 | 403 | Passed |
| TC-SEC-X-08 | Kế toán xem đơn hàng (orders.view) → 200 | GET /api/v1/orders | — | 200 | 200 | Passed |
| TC-SEC-X-09 | Nhân viên kho xem khách hàng (customers.view) → 403 | GET /api/v1/customers | — | 403 | 403 | Passed |
| TC-SEC-X-10 | Quản lý chi nhánh thêm nhân viên (staff.create) → 403 | POST /api/v1/tenants/current/members | {} | 403 | 403 | Passed |
| TC-SEC-X-11 | Vai trò tùy chỉnh tạo vai trò khác (staff.update) → 403 | POST /api/v1/roles | {"name":"Should fail secmwc1avod307c","permissions":["products.view"]} | 403 | 403 | Passed |
| TC-SEC-X-12 | Sales đọc danh sách vai trò (staff.view) → 403 | GET /api/v1/roles | — | 403 | 403 | Passed |
| TC-SEC-X-13 | Chủ cửa hàng thêm nhân viên với body rỗng → 422 (đã qua guard) | POST /api/v1/tenants/current/members | {} | 422 | 422 | Passed |
| TC-SEC-X-14 | Quản lý chi nhánh sửa cài đặt cửa hàng (settings.update) → 403 | PATCH /api/v1/tenants/current | {} | 403 | 403 | Passed |
| TC-SEC-X-15 | Chủ cửa hàng sửa cài đặt cửa hàng với body rỗng → 200 | PATCH /api/v1/tenants/current | {} | 200 | 200 | Passed |
| TC-SEC-X-16 | Quản lý chi nhánh (không có settings.update) sửa chi nhánh A2 → 403 | PATCH /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750 | {} | 403 | 403 | Passed |

#### 04 — Vai trò & 400/409

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-ROLE-01 | Tạo vai trò tùy chỉnh hợp lệ → 201 | POST /api/v1/roles | {"name":"Created Role secmwc1avod307c","permissions":["products.view"]} | 201 | 201 | Passed |
| TC-SEC-ROLE-02 | Trùng tên vai trò → 409 R001 | POST /api/v1/roles | {"name":"Created Role secmwc1avod307c","permissions":["products.view"]} | 409 | 409 | Passed |
| TC-SEC-ROLE-03 | Mã quyền không tồn tại → 400 R003 | POST /api/v1/roles | {"name":"Bad Permission secmwc1avod307c","permissions":["nope.nope"]} | 400 | 400 | Passed |
| TC-SEC-ROLE-04 | Sửa vai trò owner → 400 R002 | PATCH /api/v1/roles/c53f22e9-ba95-4f16-a8fd-bd73cc6a34dd | {"name":"Hacked"} | 400 | 400 | Passed |
| TC-SEC-ROLE-05 | Xóa vai trò owner → 400 R004 | DELETE /api/v1/roles/c53f22e9-ba95-4f16-a8fd-bd73cc6a34dd | — | 400 | 400 | Passed |
| TC-SEC-ROLE-06 | Xóa vai trò mặc định (kế toán) → 400 R004 | DELETE /api/v1/roles/e2239663-f829-4374-a60c-e51e4920d4c9 | — | 400 | 400 | Passed |
| TC-SEC-ROLE-07 | Xóa vai trò đang có thành viên → 409 R005 | DELETE /api/v1/roles/76569080-64be-4063-9725-1e3d739d0516 | — | 409 | 409 | Passed |
| TC-SEC-ROLE-08 | Xóa vai trò tùy chỉnh không có thành viên → 204 | DELETE /api/v1/roles/7ccb6b1c-e86f-4df5-b89b-c47f18a367a2 | — | 204 | 204 | Passed |
| TC-SEC-ROLE-09 | Sales tạo vai trò → 403 | POST /api/v1/roles | {"name":"Sales Role secmwc1avod307c","permissions":["products.view"]} | 403 | 403 | Passed |
| TC-SEC-ROLE-10 | Sales đọc vai trò → 403 | GET /api/v1/roles | — | 403 | 403 | Passed |
| TC-SEC-ROLE-11 | Thêm thành viên không chọn vai trò → 400 R007 | POST /api/v1/tenants/current/members | {"email":"sec.ownerb.secmwc1avod307c@example.test"} | 400 | 400 | Passed |
| TC-SEC-ROLE-12 | Gán vai trò owner cho người khác → 400 R008 | POST /api/v1/tenants/current/members | {"email":"sec.ownerb.secmwc1avod307c@example.test","roleId":"c53f22e9-ba95-4f16-a8fd-bd... | 400 | 400 | Passed |
| TC-SEC-ROLE-13 | Gán roleId không tồn tại → 400 R007 | POST /api/v1/tenants/current/members | {"email":"sec.ownerb.secmwc1avod307c@example.test","roleId":"2c6b343d-4138-40f9-9b28-96... | 400 | 400 | Passed |
| TC-SEC-ROLE-14 | Thêm trùng thành viên → 400 T002 | POST /api/v1/tenants/current/members | {"email":"sec.sales.secmwc1avod307c@example.test","roleId":"5bd7a6f0-6d69-4561-8a94-73a... | 400 | 400 | Passed |
| TC-SEC-ROLE-15 | Đổi vai trò của owner → 400 T003 | PATCH /api/v1/tenants/current/members/d872b395-50ff-4065-82d4-d711080a4783 | {"roleId":"3bf0344c-3580-483d-af6f-11065e39b34c"} | 400 | 400 | Passed |
| TC-SEC-ROLE-16 | UUID không hợp lệ trên đường dẫn → 400 | GET /api/v1/branches/not-a-uuid | — | 400 | 400 | Passed |
| TC-SEC-ROLE-17 | Trùng mã chi nhánh → 400 B001 | POST /api/v1/branches | {"name":"Trùng mã","code":"A2"} | 400 | 400 | Passed |
| TC-SEC-ROLE-18 | Mã chi nhánh sai định dạng → 422 | POST /api/v1/branches | {"name":"Sai mã","code":"bad code!"} | 422 | 422 | Passed |
| TC-SEC-ROLE-19 | Tạo tenant trùng subdomain → 400 T001 | POST /api/v1/tenants | {"name":"Trùng subdomain","subdomain":"sec-a-secmwc1avod307c"} | 400 | 400 | Passed |

#### 05 — Tenant isolation

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-TEN-01 | Tenant B đọc sản phẩm của A → 404, không lộ dữ liệu | GET /api/v1/products/90ab1c02-04fc-47d0-a0b9-60be1967010f | — | 404 | 404 | Passed |
| TC-SEC-TEN-02 | Tenant B sửa sản phẩm của A → 404 | PATCH /api/v1/products/90ab1c02-04fc-47d0-a0b9-60be1967010f | {"name":"Hacked by B"} | 404 | 404 | Passed |
| TC-SEC-TEN-03 | Tenant B xóa sản phẩm của A → 404 | DELETE /api/v1/products/90ab1c02-04fc-47d0-a0b9-60be1967010f | — | 404 | 404 | Passed |
| TC-SEC-TEN-04 | Tenant B đọc khách hàng của A → 404, không lộ dữ liệu | GET /api/v1/customers/f6cc59ce-0df4-48e0-8bba-1812fd29c44f | — | 404 | 404 | Passed |
| TC-SEC-TEN-05 | Tenant B sửa khách hàng của A → 404 | PATCH /api/v1/customers/f6cc59ce-0df4-48e0-8bba-1812fd29c44f | {"name":"Hacked by B"} | 404 | 404 | Passed |
| TC-SEC-TEN-06 | Tenant B xóa khách hàng của A → 404 | DELETE /api/v1/customers/f6cc59ce-0df4-48e0-8bba-1812fd29c44f | — | 404 | 404 | Passed |
| TC-SEC-TEN-07 | Tenant B đọc chi nhánh A1 → 404 | GET /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a | — | 404 | 404 | Passed |
| TC-SEC-TEN-08 | Tenant B đọc cài đặt chi nhánh A1 → 404 | GET /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a/settings | — | 404 | 404 | Passed |
| TC-SEC-TEN-09 | Tenant B đọc vai trò tùy chỉnh của A → 404 R006 | GET /api/v1/roles/76569080-64be-4063-9725-1e3d739d0516 | — | 404 | 404 | Passed |
| TC-SEC-TEN-10 | Tenant B đọc thành viên của A → 404 | GET /api/v1/tenants/current/members/b51d9ebf-471d-44fd-a8ac-b0ce52fead04 | — | 404 | 404 | Passed |
| TC-SEC-TEN-11 | Tenant B sửa thành viên của A → 404 | PATCH /api/v1/tenants/current/members/b51d9ebf-471d-44fd-a8ac-b0ce52fead04 | {"roleId":"5bd7a6f0-6d69-4561-8a94-73a7bd0087bb"} | 404 | 404 | Passed |
| TC-SEC-TEN-12 | Tenant B xóa thành viên của A → 404 | DELETE /api/v1/tenants/current/members/b51d9ebf-471d-44fd-a8ac-b0ce52fead04 | — | 404 | 404 | Passed |
| TC-SEC-TEN-13 | Danh sách thành viên tenant B không lẫn tài khoản tenant A | GET /api/v1/tenants/current/members | — | 200 | 200 | Passed |
| TC-SEC-TEN-14 | Danh sách vai trò tenant B không lẫn vai trò tenant A | GET /api/v1/roles | — | 200 | 200 | Passed |
| TC-SEC-TEN-15 | GET /tenants/current của token B trả đúng tenant B | GET /api/v1/tenants/current | — | 200 | 200 | Passed |
| TC-SEC-TEN-16 | Chuyển sang tenant không phải thành viên → 404 | POST /api/v1/auth/switch-tenant | {"tenantId":"55592aa9-f95e-49f1-97d6-5bbe3768a753"} | 404 | 404 | Passed |
| TC-SEC-TEN-17 | Chèn tenantId của A vào body khi tạo chi nhánh → vẫn tạo ở B | POST /api/v1/branches | {"name":"Chi nhánh chèn tenant","code":"TXOD307C","tenantId":"55592aa9-f95e-49f1-97d6-5... | 201 | 201 | Passed |
| TC-SEC-TEN-18 | Query tenantId=A khi token B không thay đổi phạm vi dữ liệu | GET /api/v1/branches?tenantId=55592aa9-f95e-49f1-97d6-5bbe3768a753 | — | 200 | 200 | Passed |
| TC-SEC-TEN-19 | Tenant A đọc chi nhánh B1 → 404 | GET /api/v1/branches/e77bd538-6dcb-4adb-9122-c2921477ff79 | — | 404 | 404 | Passed |
| TC-SEC-TEN-20 | Header X-Tenant-Id=A khi token B không thay đổi phạm vi dữ liệu | GET /api/v1/branches | — | 200 | 200 | Passed |

#### 06 — Branch isolation

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-BRA-01 | Quản lý chỉ thấy chi nhánh A2 trong danh sách | GET /api/v1/branches | — | 200 | 200 | Passed |
| TC-SEC-BRA-02 | Quản lý đọc chi nhánh A1 ngoài phạm vi → 404 | GET /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a | — | 404 | 404 | Passed |
| TC-SEC-BRA-03 | Quản lý đọc cài đặt chi nhánh A1 ngoài phạm vi → 404 | GET /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a/settings | — | 404 | 404 | Passed |
| TC-SEC-BRA-04 | Quản lý đọc cài đặt chi nhánh A2 trong phạm vi → 200 | GET /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750/settings | — | 200 | 200 | Passed |
| TC-SEC-BRA-05 | Vai trò có settings.update nhưng giới hạn A2 sửa cài đặt A1 → 404 | PATCH /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a/settings | {} | 404 | 404 | Passed |
| TC-SEC-BRA-06 | Vai trò có settings.update trong phạm vi A2 sửa cài đặt A2 → 200 | PATCH /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750/settings | {} | 200 | 200 | Passed |
| TC-SEC-BRA-07 | Người bị giới hạn chi nhánh tạo chi nhánh mới → 403 B008 | POST /api/v1/branches | {"name":"Ngoài phạm vi","code":"OUT01"} | 403 | 403 | Passed |
| TC-SEC-BRA-08 | Context của quản lý chỉ trả chi nhánh A2 và branchCount=1 | GET /api/v1/tenants/current/context | — | 200 | 200 | Passed |
| TC-SEC-BRA-09 | Sales không bị giới hạn chi nhánh thấy cả A1 và A2 | GET /api/v1/branches | — | 200 | 200 | Passed |
| TC-SEC-BRA-10 | Sales đọc chi nhánh A1 → 200 | GET /api/v1/branches/bd14cfe8-8922-4a20-bce0-c84e99b2c11a | — | 200 | 200 | Passed |

#### 07 — Revocation

| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- |
| TC-SEC-REV-01 | Baseline: revokee có staff.create, thêm thành viên body rỗng → 422 | POST /api/v1/tenants/current/members | {} | 422 | 422 | Passed |
| TC-SEC-REV-02 | Chủ cửa hàng thu hồi staff.create khỏi vai trò → 200 | PATCH /api/v1/roles/6d4c4961-907c-478b-9129-f52634dbde43 | {"permissions":["staff.view"]} | 200 | 200 | Passed |
| TC-SEC-REV-03 | Token cũ (còn hạn) sau khi thu hồi staff.create phải bị 403 — yêu cầu thu hồi tức thời | POST /api/v1/tenants/current/members | {} | 403 | 422 | Failed |
| TC-SEC-REV-04 | Revokee đăng nhập lại để lấy token mới → 200 | POST /api/v1/auth/email/login | {"email":"sec.revokee.secmwc1avod307c@example.test","password":"••••••"} | 200 | 200 | Passed |
| TC-SEC-REV-05 | Token mới sau đăng nhập lại bị 403 với staff.create | POST /api/v1/tenants/current/members | {} | 403 | 403 | Passed |
| TC-SEC-REV-06 | Baseline: scopee đọc cài đặt A2 trong phạm vi → 200 | GET /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750/settings | — | 200 | 200 | Passed |
| TC-SEC-REV-07 | Chủ cửa hàng đổi phạm vi của scopee sang A1 → 200 | PATCH /api/v1/tenants/current/members/5b66c1c5-ca1d-4a04-b033-cf490c1a94fc | {"branchIds":["bd14cfe8-8922-4a20-bce0-c84e99b2c11a"]} | 200 | 200 | Passed |
| TC-SEC-REV-08 | Token cũ của scopee sau khi đổi phạm vi phải bị 404 khi đọc A2 — yêu cầu thu hồi tức thời | GET /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750/settings | — | 404 | 200 | Failed |
| TC-SEC-REV-09 | Scopee đăng nhập lại để lấy token mới → 200 | POST /api/v1/auth/email/login | {"email":"sec.scopee.secmwc1avod307c@example.test","password":"••••••"} | 200 | 200 | Passed |
| TC-SEC-REV-10 | Token mới của scopee bị 404 khi đọc A2 | GET /api/v1/branches/a633715d-6bf3-4fe3-aaae-fd05c19d7750/settings | — | 404 | 404 | Passed |
