import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_COLLECTION = path.join(HERE, 'security-rbac.postman_collection.json');
const OUT_ENV_EXAMPLE = path.join(HERE, 'postman-environment.example.json');

const ROLE_META = {
  owner: { label: 'Chủ cửa hàng', token: 'ownerToken' },
  branch_manager: { label: 'Quản lý chi nhánh', token: 'managerToken' },
  sales_staff: { label: 'Nhân viên bán hàng', token: 'salesToken' },
  warehouse_staff: { label: 'Nhân viên kho', token: 'warehouseToken' },
  accountant: { label: 'Kế toán', token: 'accountantToken' },
  custom: { label: 'Vai trò tùy chỉnh', token: 'customToken' },
};

/** Bảng quyết định: 5 thao tác trên module sản phẩm + duyệt phiếu nhập kho. */
export const MATRIX = [
  {
    id: 'VIEW',
    name: 'Xem sản phẩm',
    method: 'GET',
    base: 'catalogBase',
    path: '/products',
    permission: 'products.view',
    allowed: ['owner', 'branch_manager', 'sales_staff', 'warehouse_staff', 'custom'],
    allowedStatus: 200,
  },
  {
    id: 'CREATE',
    name: 'Tạo sản phẩm',
    method: 'POST',
    base: 'catalogBase',
    path: '/products',
    body: {},
    permission: 'products.create',
    allowed: ['owner', 'branch_manager'],
    allowedStatus: 422,
  },
  {
    id: 'UPDATE',
    name: 'Sửa sản phẩm',
    method: 'PATCH',
    base: 'catalogBase',
    path: '/products/{{randomProductId}}',
    body: {},
    permission: 'products.update',
    allowed: ['owner', 'branch_manager'],
    allowedStatus: 404,
  },
  {
    id: 'DELETE',
    name: 'Xóa sản phẩm',
    method: 'DELETE',
    base: 'catalogBase',
    path: '/products/{{randomProductId}}',
    permission: 'products.delete',
    allowed: ['owner', 'branch_manager'],
    allowedStatus: 404,
  },
  {
    id: 'APPROVE',
    name: 'Duyệt phiếu nhập kho',
    method: 'POST',
    base: 'inventoryBase',
    path: '/stock-receipts/{{randomReceiptId}}/post',
    body: {},
    permission: 'inventory.approve',
    allowed: ['owner', 'branch_manager'],
    allowedStatus: 404,
  },
];

const CHECKS = {
  status(code) {
    return `pm.test("HTTP ${code}", function () { pm.response.to.have.status(${code}); });`;
  },
  time: 'pm.test("Thời gian phản hồi < 3000 ms", function () { pm.expect(pm.response.responseTime).to.be.below(3000); });',
  no5xx: 'pm.test("Không có lỗi 5xx", function () { pm.expect(pm.response.code).to.be.below(500); });',
  forbidden: 'pm.test("Từ chối 403 Forbidden", function () { pm.expect(pm.response.json().error).to.eql("Forbidden"); });',
  unauthorized: 'pm.test("Từ chối 401 Unauthorized", function () { pm.expect(pm.response.json().error).to.eql("Unauthorized"); });',
  errorCode(code) {
    return `pm.test("Mã lỗi ${code}", function () { pm.expect(pm.response.json().errorCode).to.eql("${code}"); });`;
  },
  notContainsEnv(key, label = 'không lộ dữ liệu') {
    return `pm.test("${label}", function () { pm.expect(pm.response.text()).to.not.include(pm.environment.get("${key}")); });`;
  },
  arrayNotInclude(pointer, key, label = 'không chứa bản ghi của tenant khác') {
    return `pm.test("${label}", function () { const ids = pm.response.json()${pointer}.map(function (x) { return x.id; }); pm.expect(ids).to.not.include(pm.environment.get("${key}")); });`;
  },
  arrayIncludes(pointer, key, label = 'có chứa bản ghi mong đợi') {
    return `pm.test("${label}", function () { const ids = pm.response.json()${pointer}.map(function (x) { return x.id; }); pm.expect(ids).to.include(pm.environment.get("${key}")); });`;
  },
};

function requestItem({
  id,
  name,
  method,
  base,
  path,
  token,
  body,
  authHeader,
  extraHeaders,
  checks = [],
  description,
}) {
  const headers = [];
  if (body !== undefined) headers.push({ key: 'Content-Type', value: 'application/json' });
  if (authHeader) headers.push({ key: 'Authorization', value: authHeader });
  else if (token) headers.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  if (extraHeaders) headers.push(...extraHeaders);

  const exec = [`// ${id} — ${name}`, ...checks];
  return {
    id,
    name: `${id} — ${name}`,
    ...(description ? { description } : {}),
    request: {
      method,
      header: headers,
      ...(body !== undefined
        ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      url: `{{${base}}}${path}`,
    },
    event: [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec },
      },
    ],
  };
}

function folder(name, items) {
  return { name, item: items };
}

function matrixCases() {
  const items = [];
  let counter = 0;
  for (const operation of MATRIX) {
    for (const role of Object.keys(ROLE_META)) {
      counter += 1;
      const allowed = operation.allowed.includes(role);
      const expected = allowed ? operation.allowedStatus : 403;
      const checks = [
        CHECKS.status(expected),
        CHECKS.time,
        CHECKS.no5xx,
        ...(allowed ? [] : [CHECKS.forbidden]),
      ];
      items.push(
        requestItem({
          id: `TC-SEC-RBAC-${String(counter).padStart(2, '0')}`,
          name: `[${role}] ${operation.name} (${operation.permission}) → ${expected}`,
          method: operation.method,
          base: operation.base,
          path: operation.path,
          token: ROLE_META[role].token,
          body: operation.body,
          checks,
          description: `Vai trò ${ROLE_META[role].label}; quyền cần: ${operation.permission}; mong đợi ${expected}.`,
        }),
      );
    }
  }
  return items;
}

const decodeHelper = [
  'function decodeJwt(token) {',
  '  const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");',
  '  return JSON.parse(Buffer.from(part, "base64").toString("utf8"));',
  '}',
];

function setupCases() {
  return [
    requestItem({
      id: 'TC-SEC-SETUP-01',
      name: 'Năm vai trò mặc định tồn tại trong tenant A',
      method: 'GET',
      base: 'platformBase',
      path: '/roles',
      token: 'ownerToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("Đủ 5 vai trò mặc định", function () { const codes = pm.response.json().data.map(function (r) { return r.code; }); pm.expect(codes).to.include.members(["owner","branch_manager","sales_staff","warehouse_staff","accountant"]); });`,
        `pm.test("Chỉ owner là isOwner", function () { const owners = pm.response.json().data.filter(function (r) { return r.isOwner; }).map(function (r) { return r.code; }); pm.expect(owners).to.eql(["owner"]); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-SETUP-02',
      name: 'Token của quản lý chi nhánh mang đúng tid/roles/perms/branches',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/context',
      token: 'managerToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        ...decodeHelper,
        `const p = decodeJwt(pm.environment.get("managerToken"));`,
        `pm.test("tid là tenant A", function () { pm.expect(p.tid).to.eql(pm.environment.get("tenantA")); });`,
        `pm.test("roles là branch_manager", function () { pm.expect(p.roles).to.eql(["branch_manager"]); });`,
        `pm.test("chỉ có chi nhánh A2", function () { pm.expect(p.branches).to.eql([pm.environment.get("branchA2")]); });`,
        `pm.test("có settings.view nhưng không có settings.update", function () { pm.expect(p.perms).to.include("settings.view"); pm.expect(p.perms).to.not.include("settings.update"); });`,
        `pm.test("context chỉ trả chi nhánh A2", function () { pm.expect(pm.response.json().branches.map(function (b) { return b.id; })).to.eql([pm.environment.get("branchA2")]); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-SETUP-03',
      name: 'Vai trò tùy chỉnh chỉ mang đúng 6 quyền đã cấp',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/context',
      token: 'customToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        ...decodeHelper,
        `const p = decodeJwt(pm.environment.get("customToken"));`,
        `pm.test("đúng 6 quyền", function () { pm.expect(p.perms.slice().sort()).to.eql(["customers.view","inventory.view","orders.view","products.view","settings.view","staff.view"]); });`,
        `pm.test("role là mã vai trò tùy chỉnh", function () { pm.expect(p.roles[0]).to.match(/^custom_viewer_/); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-SETUP-04',
      name: 'Token chủ cửa hàng A và B gắn đúng tenant, không lẫn nhau',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        ...decodeHelper,
        `const a = decodeJwt(pm.environment.get("ownerToken"));`,
        `const b = decodeJwt(pm.environment.get("ownerBToken"));`,
        `pm.test("token A trỏ tenant A", function () { pm.expect(a.tid).to.eql(pm.environment.get("tenantA")); });`,
        `pm.test("token B trỏ tenant B", function () { pm.expect(b.tid).to.eql(pm.environment.get("tenantB")); });`,
        `pm.test("GET /tenants/current trả tenant B", function () { pm.expect(pm.response.json().id).to.eql(pm.environment.get("tenantB")); });`,
      ],
    }),
  ];
}

function authCases() {
  return [
    requestItem({
      id: 'TC-SEC-AUTH-01',
      name: 'Không có token → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-02',
      name: 'Chuỗi token không phải JWT → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      authHeader: 'Bearer not-a-jwt',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-03',
      name: 'Token bị sửa payload, giữ chữ ký cũ → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      authHeader: 'Bearer {{tamperedToken}}',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-04',
      name: 'Token hết hạn (exp trong quá khứ, chữ ký hợp lệ) → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      authHeader: 'Bearer {{expiredToken}}',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-05',
      name: 'Sai loại xác thực (Basic thay vì Bearer) → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      authHeader: 'Basic dXNlcjpwYXNz',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-06',
      name: 'Đăng xuất thu hồi access token ngay (POST /auth/logout)',
      method: 'POST',
      base: 'platformBase',
      path: '/auth/logout',
      token: 'logoutSessionToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-07',
      name: 'Access token sau đăng xuất bị từ chối → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/branches',
      token: 'logoutSessionToken',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-08',
      name: 'Khóa thành viên (lock) có hiệu lực ngay với token cũ',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members/{{lockeeAccountId}}/lock',
      token: 'ownerToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-AUTH-09',
      name: 'Token của thành viên đã bị khóa → 401',
      method: 'GET',
      base: 'platformBase',
      path: '/branches',
      token: 'lockeeToken',
      checks: [CHECKS.status(401), CHECKS.time, CHECKS.unauthorized],
    }),
  ];
}

function extraCases() {
  return [
    requestItem({
      id: 'TC-SEC-X-01',
      name: 'Sales tạo khách hàng (customers.create) → 201',
      method: 'POST',
      base: 'customerBase',
      path: '/customers',
      token: 'salesToken',
      body: { name: 'Khách do sales tạo {{runId}}', phone: '0912345679' },
      checks: [
        CHECKS.status(201),
        CHECKS.time,
        `pm.test("lưu id khách hàng vừa tạo", function () { pm.environment.set("salesCustomerId", pm.response.json().id); pm.expect(pm.response.json().id).to.be.a("string"); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-X-02',
      name: 'Sales sửa khách hàng vừa tạo (customers.update) → 200',
      method: 'PATCH',
      base: 'customerBase',
      path: '/customers/{{salesCustomerId}}',
      token: 'salesToken',
      body: { name: 'Khách đã sửa {{runId}}' },
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-03',
      name: 'Sales xóa khách hàng (customers.delete) → 403',
      method: 'DELETE',
      base: 'customerBase',
      path: '/customers/{{salesCustomerId}}',
      token: 'salesToken',
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-04',
      name: 'Sales tạo đơn hàng (orders.create) → 422 do thiếu dữ liệu, không phải 403',
      method: 'POST',
      base: 'salesBase',
      path: '/orders',
      token: 'salesToken',
      body: {},
      checks: [CHECKS.status(422), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-05',
      name: 'Kế toán tạo đơn hàng → 403',
      method: 'POST',
      base: 'salesBase',
      path: '/orders',
      token: 'accountantToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-06',
      name: 'Nhân viên kho tạo phiếu nhập với warehouseId không tồn tại → 404, không phải 403',
      method: 'POST',
      base: 'inventoryBase',
      path: '/stock-receipts',
      token: 'warehouseToken',
      body: {
        warehouseId: '{{randomWarehouseId}}',
        items: [{ skuId: '{{randomProductId}}', qty: '1' }],
      },
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-07',
      name: 'Kế toán tạo phiếu nhập → 403',
      method: 'POST',
      base: 'inventoryBase',
      path: '/stock-receipts',
      token: 'accountantToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-08',
      name: 'Kế toán xem đơn hàng (orders.view) → 200',
      method: 'GET',
      base: 'salesBase',
      path: '/orders',
      token: 'accountantToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-09',
      name: 'Nhân viên kho xem khách hàng (customers.view) → 403',
      method: 'GET',
      base: 'customerBase',
      path: '/customers',
      token: 'warehouseToken',
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-10',
      name: 'Quản lý chi nhánh thêm nhân viên (staff.create) → 403',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'managerToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-11',
      name: 'Vai trò tùy chỉnh tạo vai trò khác (staff.update) → 403',
      method: 'POST',
      base: 'platformBase',
      path: '/roles',
      token: 'customToken',
      body: { name: 'Should fail {{runId}}', permissions: ['products.view'] },
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-12',
      name: 'Sales đọc danh sách vai trò (staff.view) → 403',
      method: 'GET',
      base: 'platformBase',
      path: '/roles',
      token: 'salesToken',
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-13',
      name: 'Chủ cửa hàng thêm nhân viên với body rỗng → 422 (đã qua guard)',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerToken',
      body: {},
      checks: [CHECKS.status(422), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-14',
      name: 'Quản lý chi nhánh sửa cài đặt cửa hàng (settings.update) → 403',
      method: 'PATCH',
      base: 'platformBase',
      path: '/tenants/current',
      token: 'managerToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-X-15',
      name: 'Chủ cửa hàng sửa cài đặt cửa hàng với body rỗng → 200',
      method: 'PATCH',
      base: 'platformBase',
      path: '/tenants/current',
      token: 'ownerToken',
      body: {},
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-X-16',
      name: 'Quản lý chi nhánh (không có settings.update) sửa chi nhánh A2 → 403',
      method: 'PATCH',
      base: 'platformBase',
      path: '/branches/{{branchA2}}',
      token: 'managerToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
  ];
}

function roleCases() {
  return [
    requestItem({
      id: 'TC-SEC-ROLE-01',
      name: 'Tạo vai trò tùy chỉnh hợp lệ → 201',
      method: 'POST',
      base: 'platformBase',
      path: '/roles',
      token: 'ownerToken',
      body: { name: 'Created Role {{runId}}', permissions: ['products.view'] },
      checks: [
        CHECKS.status(201),
        CHECKS.time,
        `pm.test("lưu roleId vừa tạo", function () { pm.environment.set("createdRoleId", pm.response.json().id); pm.expect(pm.response.json().permissionCount).to.eql(1); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-02',
      name: 'Trùng tên vai trò → 409 R001',
      method: 'POST',
      base: 'platformBase',
      path: '/roles',
      token: 'ownerToken',
      body: { name: 'Created Role {{runId}}', permissions: ['products.view'] },
      checks: [CHECKS.status(409), CHECKS.time, CHECKS.errorCode('R001')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-03',
      name: 'Mã quyền không tồn tại → 400 R003',
      method: 'POST',
      base: 'platformBase',
      path: '/roles',
      token: 'ownerToken',
      body: { name: 'Bad Permission {{runId}}', permissions: ['nope.nope'] },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R003')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-04',
      name: 'Sửa vai trò owner → 400 R002',
      method: 'PATCH',
      base: 'platformBase',
      path: '/roles/{{ownerRoleId}}',
      token: 'ownerToken',
      body: { name: 'Hacked' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R002')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-05',
      name: 'Xóa vai trò owner → 400 R004',
      method: 'DELETE',
      base: 'platformBase',
      path: '/roles/{{ownerRoleId}}',
      token: 'ownerToken',
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R004')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-06',
      name: 'Xóa vai trò mặc định (kế toán) → 400 R004',
      method: 'DELETE',
      base: 'platformBase',
      path: '/roles/{{accountantRoleId}}',
      token: 'ownerToken',
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R004')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-07',
      name: 'Xóa vai trò đang có thành viên → 409 R005',
      method: 'DELETE',
      base: 'platformBase',
      path: '/roles/{{customRoleId}}',
      token: 'ownerToken',
      checks: [CHECKS.status(409), CHECKS.time, CHECKS.errorCode('R005')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-08',
      name: 'Xóa vai trò tùy chỉnh không có thành viên → 204',
      method: 'DELETE',
      base: 'platformBase',
      path: '/roles/{{unusedRoleId}}',
      token: 'ownerToken',
      checks: [CHECKS.status(204), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-09',
      name: 'Sales tạo vai trò → 403',
      method: 'POST',
      base: 'platformBase',
      path: '/roles',
      token: 'salesToken',
      body: { name: 'Sales Role {{runId}}', permissions: ['products.view'] },
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-10',
      name: 'Sales đọc vai trò → 403',
      method: 'GET',
      base: 'platformBase',
      path: '/roles',
      token: 'salesToken',
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-11',
      name: 'Thêm thành viên không chọn vai trò → 400 R007',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerToken',
      body: { email: '{{ownerBEmail}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R007')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-12',
      name: 'Gán vai trò owner cho người khác → 400 R008',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerToken',
      body: { email: '{{ownerBEmail}}', roleId: '{{ownerRoleId}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R008')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-13',
      name: 'Gán roleId không tồn tại → 400 R007',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerToken',
      body: { email: '{{ownerBEmail}}', roleId: '{{randomRoleId}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('R007')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-14',
      name: 'Thêm trùng thành viên → 400 T002',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerToken',
      body: { email: '{{salesEmail}}', roleId: '{{salesRoleId}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('T002')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-15',
      name: 'Đổi vai trò của owner → 400 T003',
      method: 'PATCH',
      base: 'platformBase',
      path: '/tenants/current/members/{{ownerAccountId}}',
      token: 'ownerToken',
      body: { roleId: '{{managerRoleId}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('T003')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-16',
      name: 'UUID không hợp lệ trên đường dẫn → 400',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/not-a-uuid',
      token: 'ownerToken',
      checks: [CHECKS.status(400), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-17',
      name: 'Trùng mã chi nhánh → 400 B001',
      method: 'POST',
      base: 'platformBase',
      path: '/branches',
      token: 'ownerToken',
      body: { name: 'Trùng mã', code: 'A2' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('B001')],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-18',
      name: 'Mã chi nhánh sai định dạng → 422',
      method: 'POST',
      base: 'platformBase',
      path: '/branches',
      token: 'ownerToken',
      body: { name: 'Sai mã', code: 'bad code!' },
      checks: [CHECKS.status(422), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-ROLE-19',
      name: 'Tạo tenant trùng subdomain → 400 T001',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants',
      token: 'ownerToken',
      body: { name: 'Trùng subdomain', subdomain: '{{tenantASubdomain}}' },
      checks: [CHECKS.status(400), CHECKS.time, CHECKS.errorCode('T001')],
    }),
  ];
}

function tenantCases() {
  return [
    requestItem({
      id: 'TC-SEC-TEN-01',
      name: 'Tenant B đọc sản phẩm của A → 404, không lộ dữ liệu',
      method: 'GET',
      base: 'catalogBase',
      path: '/products/{{productAId}}',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(404),
        CHECKS.time,
        CHECKS.notContainsEnv('productAName', 'không trả tên sản phẩm của tenant A'),
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-02',
      name: 'Tenant B sửa sản phẩm của A → 404',
      method: 'PATCH',
      base: 'catalogBase',
      path: '/products/{{productAId}}',
      token: 'ownerBToken',
      body: { name: 'Hacked by B' },
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-03',
      name: 'Tenant B xóa sản phẩm của A → 404',
      method: 'DELETE',
      base: 'catalogBase',
      path: '/products/{{productAId}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-04',
      name: 'Tenant B đọc khách hàng của A → 404, không lộ dữ liệu',
      method: 'GET',
      base: 'customerBase',
      path: '/customers/{{customerAId}}',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(404),
        CHECKS.time,
        CHECKS.notContainsEnv('customerAName', 'không trả tên khách hàng của tenant A'),
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-05',
      name: 'Tenant B sửa khách hàng của A → 404',
      method: 'PATCH',
      base: 'customerBase',
      path: '/customers/{{customerAId}}',
      token: 'ownerBToken',
      body: { name: 'Hacked by B' },
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-06',
      name: 'Tenant B xóa khách hàng của A → 404',
      method: 'DELETE',
      base: 'customerBase',
      path: '/customers/{{customerAId}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-07',
      name: 'Tenant B đọc chi nhánh A1 → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA1}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-08',
      name: 'Tenant B đọc cài đặt chi nhánh A1 → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA1}}/settings',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-09',
      name: 'Tenant B đọc vai trò tùy chỉnh của A → 404 R006',
      method: 'GET',
      base: 'platformBase',
      path: '/roles/{{customRoleId}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time, CHECKS.errorCode('R006')],
    }),
    requestItem({
      id: 'TC-SEC-TEN-10',
      name: 'Tenant B đọc thành viên của A → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members/{{managerAccountId}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-11',
      name: 'Tenant B sửa thành viên của A → 404',
      method: 'PATCH',
      base: 'platformBase',
      path: '/tenants/current/members/{{managerAccountId}}',
      token: 'ownerBToken',
      body: { roleId: '{{salesRoleId}}' },
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-12',
      name: 'Tenant B xóa thành viên của A → 404',
      method: 'DELETE',
      base: 'platformBase',
      path: '/tenants/current/members/{{managerAccountId}}',
      token: 'ownerBToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-13',
      name: 'Danh sách thành viên tenant B không lẫn tài khoản tenant A',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("không có owner A", function () { const ids = pm.response.json().map(function (m) { return m.accountId; }); pm.expect(ids).to.not.include(pm.environment.get("ownerAccountId")); });`,
        `pm.test("không có quản lý A", function () { const ids = pm.response.json().map(function (m) { return m.accountId; }); pm.expect(ids).to.not.include(pm.environment.get("managerAccountId")); });`,
        `pm.test("chỉ có owner B", function () { pm.expect(pm.response.json()).to.have.length(1); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-14',
      name: 'Danh sách vai trò tenant B không lẫn vai trò tenant A',
      method: 'GET',
      base: 'platformBase',
      path: '/roles',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("không có vai trò tùy chỉnh của A", function () { const ids = pm.response.json().data.map(function (r) { return r.id; }); pm.expect(ids).to.not.include(pm.environment.get("customRoleId")); pm.expect(ids).to.not.include(pm.environment.get("unusedRoleId")); });`,
        `pm.test("không có owner role của A", function () { const ids = pm.response.json().data.map(function (r) { return r.id; }); pm.expect(ids).to.not.include(pm.environment.get("ownerRoleId")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-15',
      name: 'GET /tenants/current của token B trả đúng tenant B',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("đúng tenant B", function () { pm.expect(pm.response.json().id).to.eql(pm.environment.get("tenantB")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-16',
      name: 'Chuyển sang tenant không phải thành viên → 404',
      method: 'POST',
      base: 'platformBase',
      path: '/auth/switch-tenant',
      token: 'ownerBToken',
      body: { tenantId: '{{tenantA}}' },
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-17',
      name: 'Chèn tenantId của A vào body khi tạo chi nhánh → vẫn tạo ở B',
      method: 'POST',
      base: 'platformBase',
      path: '/branches',
      token: 'ownerBToken',
      body: { name: 'Chi nhánh chèn tenant', code: '{{unusedBranchCode}}', tenantId: '{{tenantA}}' },
      checks: [
        CHECKS.status(201),
        CHECKS.time,
        `pm.test("lưu id chi nhánh vừa tạo ở B", function () { pm.environment.set("txBranchId", pm.response.json().id); pm.expect(pm.response.json().code).to.eql(pm.environment.get("unusedBranchCode")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-18',
      name: 'Query tenantId=A khi token B không thay đổi phạm vi dữ liệu',
      method: 'GET',
      base: 'platformBase',
      path: '/branches?tenantId={{tenantA}}',
      token: 'ownerBToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("không trả chi nhánh A1/A2", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.not.include(pm.environment.get("branchA1")); pm.expect(ids).to.not.include(pm.environment.get("branchA2")); });`,
        `pm.test("có chi nhánh B1", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.include(pm.environment.get("branchB1")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-TEN-19',
      name: 'Tenant A đọc chi nhánh B1 → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchB1}}',
      token: 'ownerToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-TEN-20',
      name: 'Header X-Tenant-Id=A khi token B không thay đổi phạm vi dữ liệu',
      method: 'GET',
      base: 'platformBase',
      path: '/branches',
      token: 'ownerBToken',
      extraHeaders: [{ key: 'X-Tenant-Id', value: '{{tenantA}}' }],
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("không trả chi nhánh A1/A2", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.not.include(pm.environment.get("branchA1")); pm.expect(ids).to.not.include(pm.environment.get("branchA2")); });`,
        `pm.test("có chi nhánh B1", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.include(pm.environment.get("branchB1")); });`,
      ],
    }),
  ];
}

function branchCases() {
  return [
    requestItem({
      id: 'TC-SEC-BRA-01',
      name: 'Quản lý chỉ thấy chi nhánh A2 trong danh sách',
      method: 'GET',
      base: 'platformBase',
      path: '/branches',
      token: 'managerToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("chỉ một chi nhánh", function () { pm.expect(pm.response.json().data).to.have.length(1); });`,
        `pm.test("đó là A2", function () { pm.expect(pm.response.json().data[0].id).to.eql(pm.environment.get("branchA2")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-BRA-02',
      name: 'Quản lý đọc chi nhánh A1 ngoài phạm vi → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA1}}',
      token: 'managerToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-BRA-03',
      name: 'Quản lý đọc cài đặt chi nhánh A1 ngoài phạm vi → 404',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA1}}/settings',
      token: 'managerToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-BRA-04',
      name: 'Quản lý đọc cài đặt chi nhánh A2 trong phạm vi → 200',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA2}}/settings',
      token: 'managerToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-BRA-05',
      name: 'Vai trò có settings.update nhưng giới hạn A2 sửa cài đặt A1 → 404',
      method: 'PATCH',
      base: 'platformBase',
      path: '/branches/{{branchA1}}/settings',
      token: 'branchAdminToken',
      body: {},
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-BRA-06',
      name: 'Vai trò có settings.update trong phạm vi A2 sửa cài đặt A2 → 200',
      method: 'PATCH',
      base: 'platformBase',
      path: '/branches/{{branchA2}}/settings',
      token: 'branchAdminToken',
      body: {},
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-BRA-07',
      name: 'Người bị giới hạn chi nhánh tạo chi nhánh mới → 403 B008',
      method: 'POST',
      base: 'platformBase',
      path: '/branches',
      token: 'branchAdminToken',
      body: { name: 'Ngoài phạm vi', code: 'OUT01' },
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.errorCode('B008')],
    }),
    requestItem({
      id: 'TC-SEC-BRA-08',
      name: 'Context của quản lý chỉ trả chi nhánh A2 và branchCount=1',
      method: 'GET',
      base: 'platformBase',
      path: '/tenants/current/context',
      token: 'managerToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("branchCount=1", function () { pm.expect(pm.response.json().branchCount).to.eql(1); });`,
        `pm.test("branches chỉ có A2", function () { const ids = pm.response.json().branches.map(function (b) { return b.id; }); pm.expect(ids).to.eql([pm.environment.get("branchA2")]); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-BRA-09',
      name: 'Sales không bị giới hạn chi nhánh thấy cả A1 và A2',
      method: 'GET',
      base: 'platformBase',
      path: '/branches',
      token: 'salesToken',
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("có A1", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.include(pm.environment.get("branchA1")); });`,
        `pm.test("có A2", function () { const ids = pm.response.json().data.map(function (b) { return b.id; }); pm.expect(ids).to.include(pm.environment.get("branchA2")); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-BRA-10',
      name: 'Sales đọc chi nhánh A1 → 200',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA1}}',
      token: 'salesToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
  ];
}

function revocationCases() {
  return [
    requestItem({
      id: 'TC-SEC-REV-01',
      name: 'Baseline: revokee có staff.create, thêm thành viên body rỗng → 422',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'revokeeToken',
      body: {},
      checks: [CHECKS.status(422), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-REV-02',
      name: 'Chủ cửa hàng thu hồi staff.create khỏi vai trò → 200',
      method: 'PATCH',
      base: 'platformBase',
      path: '/roles/{{revokeRoleId}}',
      token: 'ownerToken',
      body: { permissions: ['staff.view'] },
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-REV-03',
      name: 'Token cũ (còn hạn) sau khi thu hồi staff.create phải bị 403 — yêu cầu thu hồi tức thời',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'revokeeToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-REV-04',
      name: 'Revokee đăng nhập lại để lấy token mới → 200',
      method: 'POST',
      base: 'platformBase',
      path: '/auth/email/login',
      body: { email: '{{revokeeEmail}}', password: '{{testPassword}}' },
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("lưu token mới", function () { pm.environment.set("newRevokeeToken", pm.response.json().accessToken); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-REV-05',
      name: 'Token mới sau đăng nhập lại bị 403 với staff.create',
      method: 'POST',
      base: 'platformBase',
      path: '/tenants/current/members',
      token: 'newRevokeeToken',
      body: {},
      checks: [CHECKS.status(403), CHECKS.time, CHECKS.forbidden],
    }),
    requestItem({
      id: 'TC-SEC-REV-06',
      name: 'Baseline: scopee đọc cài đặt A2 trong phạm vi → 200',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA2}}/settings',
      token: 'scopeeToken',
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-REV-07',
      name: 'Chủ cửa hàng đổi phạm vi của scopee sang A1 → 200',
      method: 'PATCH',
      base: 'platformBase',
      path: '/tenants/current/members/{{scopeeAccountId}}',
      token: 'ownerToken',
      body: { branchIds: ['{{branchA1}}'] },
      checks: [CHECKS.status(200), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-REV-08',
      name: 'Token cũ của scopee sau khi đổi phạm vi phải bị 404 khi đọc A2 — yêu cầu thu hồi tức thời',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA2}}/settings',
      token: 'scopeeToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
    requestItem({
      id: 'TC-SEC-REV-09',
      name: 'Scopee đăng nhập lại để lấy token mới → 200',
      method: 'POST',
      base: 'platformBase',
      path: '/auth/email/login',
      body: { email: '{{scopeeEmail}}', password: '{{testPassword}}' },
      checks: [
        CHECKS.status(200),
        CHECKS.time,
        `pm.test("lưu token mới", function () { pm.environment.set("newScopeeToken", pm.response.json().accessToken); });`,
      ],
    }),
    requestItem({
      id: 'TC-SEC-REV-10',
      name: 'Token mới của scopee bị 404 khi đọc A2',
      method: 'GET',
      base: 'platformBase',
      path: '/branches/{{branchA2}}/settings',
      token: 'newScopeeToken',
      checks: [CHECKS.status(404), CHECKS.time],
    }),
  ];
}

export function buildCollection() {
  const collection = {
    info: {
      name: 'PBL Luồng 1 — Security & Authorization (RBAC, Tenant/Branch Isolation)',
      description:
        'Bộ kiểm thử API cho Luồng 1: phân quyền theo vai trò (FR-M02-05, FR-M02-06, NFR-SE-04) và cô lập tenant/chi nhánh (FR-M02-07, BR-01, NFR-SE-03). Dữ liệu được tạo bởi provision.mjs; collection dùng biến môi trường do provision sinh ra. Chạy: node run.mjs.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'platformBase', value: 'http://localhost:8080/platform/api/v1' },
      { key: 'catalogBase', value: 'http://localhost:8080/catalog/api/v1' },
      { key: 'inventoryBase', value: 'http://localhost:8080/inventory/api/v1' },
      { key: 'salesBase', value: 'http://localhost:8080/sales/api/v1' },
      { key: 'customerBase', value: 'http://localhost:8080/customer/api/v1' },
    ],
    item: [
      folder('00 — Preconditions (kiểm tra dữ liệu provision)', setupCases()),
      folder('01 — Authentication guard (401)', authCases()),
      folder('02 — RBAC decision table: 6 vai trò × 5 thao tác', matrixCases()),
      folder('03 — RBAC bổ sung theo module', extraCases()),
      folder('04 — Vai trò tùy chỉnh & mã lỗi 400/409', roleCases()),
      folder('05 — Cô lập tenant', tenantCases()),
      folder('06 — Cô lập chi nhánh', branchCases()),
      folder('07 — Thu hồi quyền tức thời (revocation)', revocationCases()),
    ],
  };
  return collection;
}

export function writeCollection() {
  const collection = buildCollection();
  fs.writeFileSync(OUT_COLLECTION, JSON.stringify(collection, null, 2));
  const env = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'PBL Security — ví dụ (được provision.mjs ghi đè)',
    values: [
      ['platformBase', 'http://localhost:8080/platform/api/v1'],
      ['catalogBase', 'http://localhost:8080/catalog/api/v1'],
      ['inventoryBase', 'http://localhost:8080/inventory/api/v1'],
      ['salesBase', 'http://localhost:8080/sales/api/v1'],
      ['customerBase', 'http://localhost:8080/customer/api/v1'],
      ['runId', 'example'],
      ['tenantA', '<provision sinh>'],
      ['tenantB', '<provision sinh>'],
      ['ownerToken', '<provision sinh>'],
      ['ownerBToken', '<provision sinh>'],
    ].map(([key, value]) => ({ key, value, type: 'default', enabled: true })),
    _postman_variable_scope: 'environment',
  };
  fs.writeFileSync(OUT_ENV_EXAMPLE, JSON.stringify(env, null, 2));
  return { collectionPath: OUT_COLLECTION, environmentExamplePath: OUT_ENV_EXAMPLE, total: countItems(collection) };
}

function countItems(collection) {
  return collection.item.reduce((sum, group) => sum + group.item.length, 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeCollection();
  console.log(`Collection: ${result.collectionPath}`);
  console.log(`Environment example: ${result.environmentExamplePath}`);
  console.log(`Tổng số test case: ${result.total}`);
}
