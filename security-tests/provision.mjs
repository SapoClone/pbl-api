import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PASSWORD,
  UUID_ZERO,
  assert,
  basesFor,
  ensureQuotas,
  expiredToken,
  http,
  jwtPayload,
  login,
  readPrivateKey,
  register,
  tamper,
  waitForHealth,
} from './lib/api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const RESULTS_DIR = path.join(HERE, 'results');

function runId() {
  return `sec${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

async function registerAndLogin(platform, email, name, tenantId) {
  const reg = await register(platform, email, name);
  assert(reg.status === 200 || reg.status === 201, `Đăng ký ${email} thất bại: ${reg.status} ${reg.text.slice(0, 200)}`);
  const session = await login(platform, email, tenantId);
  assert(session.status === 200, `Đăng nhập ${email} thất bại: ${session.status}`);
  assert(session.json.accessToken, `Đăng nhập ${email} không trả accessToken`);
  return session.json;
}

async function addMember(platform, ownerToken, email, roleId, branchIds) {
  const body = { email, roleId };
  if (branchIds) body.branchIds = branchIds;
  const result = await http('POST', `${platform}/tenants/current/members`, {
    token: ownerToken,
    body,
  });
  assert(
    result.status === 201,
    `Thêm thành viên ${email} thất bại: ${result.status} ${result.text.slice(0, 300)}`,
  );
  return result.json;
}

export async function provision({ gateway = null, quiet = false } = {}) {
  const bases = basesFor(gateway);
  const id = runId();
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  log(`[provision] mode=${bases.mode} run=${id}`);
  await waitForHealth(bases);

  const quota = await ensureQuotas({
    host: process.env.PBL_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.PBL_DB_PORT ?? 25432),
    user: process.env.PBL_DB_USER ?? 'postgres',
    password: process.env.PBL_DB_PASSWORD ?? 'postgres',
    database: process.env.PBL_DB_NAME ?? 'pbl',
  });
  log(`[provision] quota free plan: ${quota.updated ? 'đã nâng lên 10 chi nhánh / 50 người dùng' : `bỏ qua (${quota.reason})`}`);

  const platform = bases.platform;
  const account = (tag) => `sec.${tag}.${id}@example.test`;
  const ownerAEmail = account('ownera');
  const ownerBEmail = account('ownerb');
  const managerEmail = account('manager');
  const salesEmail = account('sales');
  const warehouseEmail = account('warehouse');
  const accountantEmail = account('accountant');
  const customEmail = account('custom');
  const branchAdminEmail = account('branchadmin');
  const scopeeEmail = account('scopee');
  const revokeeEmail = account('revokee');
  const lockeeEmail = account('lockee');

  const ownerA = await registerAndLogin(platform, ownerAEmail, 'Security Owner A');
  const ownerB = await registerAndLogin(platform, ownerBEmail, 'Security Owner B');
  const manager = await registerAndLogin(platform, managerEmail, 'Security Manager');
  const sales = await registerAndLogin(platform, salesEmail, 'Security Sales');
  const warehouse = await registerAndLogin(platform, warehouseEmail, 'Security Warehouse');
  const accountant = await registerAndLogin(platform, accountantEmail, 'Security Accountant');
  const custom = await registerAndLogin(platform, customEmail, 'Security Custom');
  const branchAdmin = await registerAndLogin(platform, branchAdminEmail, 'Security Branch Admin');
  const scopee = await registerAndLogin(platform, scopeeEmail, 'Security Scopee');
  const revokee = await registerAndLogin(platform, revokeeEmail, 'Security Revokee');
  const lockee = await registerAndLogin(platform, lockeeEmail, 'Security Lockee');

  const tenantAResult = await http('POST', `${platform}/tenants`, {
    token: ownerA.accessToken,
    body: {
      name: `Security Store A ${id}`,
      subdomain: `sec-a-${id}`,
      defaultBranchName: 'Chi nhánh A1',
    },
  });
  assert(
    tenantAResult.status === 201,
    `Tạo tenant A thất bại: ${tenantAResult.status} ${tenantAResult.text.slice(0, 300)}`,
  );
  const tenantA = tenantAResult.json.tenant.id;
  const ownerAToken = tenantAResult.json.auth.accessToken;

  const tenantBResult = await http('POST', `${platform}/tenants`, {
    token: ownerB.accessToken,
    body: {
      name: `Security Store B ${id}`,
      subdomain: `sec-b-${id}`,
      defaultBranchName: 'Chi nhánh B1',
    },
  });
  assert(
    tenantBResult.status === 201,
    `Tạo tenant B thất bại: ${tenantBResult.status} ${tenantBResult.text.slice(0, 300)}`,
  );
  const tenantB = tenantBResult.json.tenant.id;
  const ownerBToken = tenantBResult.json.auth.accessToken;

  const branchesA = await http('GET', `${platform}/branches`, { token: ownerAToken });
  assert(branchesA.status === 200, 'Không đọc được chi nhánh của tenant A');
  const branchA1 = branchesA.json.data[0];
  assert(branchA1, 'Tenant A không có chi nhánh mặc định');

  const branchA2Result = await http('POST', `${platform}/branches`, {
    token: ownerAToken,
    body: { name: 'Chi nhánh A2', code: 'A2' },
  });
  assert(
    branchA2Result.status === 201,
    `Tạo chi nhánh A2 thất bại: ${branchA2Result.status} ${branchA2Result.text.slice(0, 300)}`,
  );
  const branchA2 = branchA2Result.json;

  const branchesB = await http('GET', `${platform}/branches`, { token: ownerBToken });
  assert(branchesB.status === 200 && branchesB.json.data[0], 'Tenant B không có chi nhánh mặc định');
  const branchB1 = branchesB.json.data[0];

  const rolesResult = await http('GET', `${platform}/roles`, { token: ownerAToken });
  assert(rolesResult.status === 200, `Không đọc được vai trò: ${rolesResult.status}`);
  const roles = Object.fromEntries(rolesResult.json.data.map((role) => [role.code, role]));
  for (const code of ['owner', 'branch_manager', 'sales_staff', 'warehouse_staff', 'accountant']) {
    assert(roles[code], `Thiếu vai trò mặc định ${code}`);
  }

  const customRoleResult = await http('POST', `${platform}/roles`, {
    token: ownerAToken,
    body: {
      name: `Custom Viewer ${id}`,
      description: 'Chỉ được xem sản phẩm, kho, đơn, khách và nhân viên',
      permissions: [
        'products.view',
        'inventory.view',
        'orders.view',
        'customers.view',
        'staff.view',
        'settings.view',
      ],
    },
  });
  assert(
    customRoleResult.status === 201,
    `Tạo vai trò tùy chỉnh thất bại: ${customRoleResult.status} ${customRoleResult.text.slice(0, 300)}`,
  );
  const customRole = customRoleResult.json;

  const branchAdminRoleResult = await http('POST', `${platform}/roles`, {
    token: ownerAToken,
    body: {
      name: `Branch Admin ${id}`,
      permissions: ['settings.view', 'settings.update'],
    },
  });
  assert(
    branchAdminRoleResult.status === 201,
    `Tạo vai trò Branch Admin thất bại: ${branchAdminRoleResult.status} ${branchAdminRoleResult.text.slice(0, 300)}`,
  );
  const branchAdminRole = branchAdminRoleResult.json;

  const revokeRoleResult = await http('POST', `${platform}/roles`, {
    token: ownerAToken,
    body: {
      name: `Revoke Demo ${id}`,
      permissions: ['staff.view', 'staff.create'],
    },
  });
  assert(
    revokeRoleResult.status === 201,
    `Tạo vai trò Revoke thất bại: ${revokeRoleResult.status} ${revokeRoleResult.text.slice(0, 300)}`,
  );
  const revokeRole = revokeRoleResult.json;

  const unusedRoleResult = await http('POST', `${platform}/roles`, {
    token: ownerAToken,
    body: {
      name: `Unused ${id}`,
      permissions: ['products.view'],
    },
  });
  assert(
    unusedRoleResult.status === 201,
    `Tạo vai trò Unused thất bại: ${unusedRoleResult.status} ${unusedRoleResult.text.slice(0, 300)}`,
  );
  const unusedRole = unusedRoleResult.json;

  await addMember(platform, ownerAToken, managerEmail, roles.branch_manager.id, [branchA2.id]);
  await addMember(platform, ownerAToken, salesEmail, roles.sales_staff.id);
  await addMember(platform, ownerAToken, warehouseEmail, roles.warehouse_staff.id);
  await addMember(platform, ownerAToken, accountantEmail, roles.accountant.id);
  await addMember(platform, ownerAToken, customEmail, customRole.id);
  await addMember(platform, ownerAToken, branchAdminEmail, branchAdminRole.id, [branchA2.id]);
  await addMember(platform, ownerAToken, scopeeEmail, branchAdminRole.id, [branchA2.id]);
  await addMember(platform, ownerAToken, revokeeEmail, revokeRole.id);
  await addMember(platform, ownerAToken, lockeeEmail, roles.sales_staff.id);
  log('[provision] đã tạo tenant, 2 chi nhánh, 4 vai trò tùy chỉnh và 9 thành viên');

  const memberSessions = {};
  for (const [key, email] of Object.entries({
    manager: managerEmail,
    sales: salesEmail,
    warehouse: warehouseEmail,
    accountant: accountantEmail,
    custom: customEmail,
    branchAdmin: branchAdminEmail,
    scopee: scopeeEmail,
    revokee: revokeeEmail,
    lockee: lockeeEmail,
  })) {
    const session = await login(platform, email);
    assert(session.status === 200, `Đăng nhập ${key} thất bại: ${session.status}`);
    assert(
      session.json.tenantId === tenantA,
      `${key} đăng nhập vào tenant ${session.json.tenantId}, mong đợi ${tenantA}`,
    );
    memberSessions[key] = session.json;
  }

  const product = await http('POST', `${bases.catalog}/products`, {
    token: ownerAToken,
    body: { name: `Security Product ${id}` },
  });
  assert(
    product.status === 201,
    `Tạo sản phẩm tenant A thất bại: ${product.status} ${product.text.slice(0, 300)}`,
  );

  const customer = await http('POST', `${bases.customer}/customers`, {
    token: ownerAToken,
    body: { name: `Security Customer ${id}`, phone: '0912345678' },
  });
  assert(
    customer.status === 201,
    `Tạo khách hàng tenant A thất bại: ${customer.status} ${customer.text.slice(0, 300)}`,
  );

  const logoutSession = await login(platform, ownerAEmail, tenantA);
  assert(logoutSession.status === 200, `Không tạo được session logout: ${logoutSession.status}`);

  const privateKey = readPrivateKey(REPO_ROOT);
  const expired = expiredToken(privateKey, {
    sub: ownerA.userId,
    tid: tenantA,
    roles: ['owner'],
    perms: ['*'],
    branches: ['*'],
  });

  const managerClaims = jwtPayload(memberSessions.manager.accessToken);
  const customClaims = jwtPayload(memberSessions.custom.accessToken);
  const salesClaims = jwtPayload(memberSessions.sales.accessToken);

  const values = {
    platformBase: platform,
    catalogBase: bases.catalog,
    inventoryBase: bases.inventory,
    salesBase: bases.sales,
    customerBase: bases.customer,
    runId: id,
    tenantA,
    tenantB,
    tenantASubdomain: `sec-a-${id}`,
    branchA1: branchA1.id,
    branchA2: branchA2.id,
    branchB1: branchB1.id,
    ownerAccountId: ownerA.userId,
    ownerBAccountId: ownerB.userId,
    ownerAEmail,
    ownerBEmail,
    managerEmail,
    salesEmail,
    revokeeEmail,
    scopeeEmail,
    managerAccountId: memberSessions.manager.userId,
    salesAccountId: memberSessions.sales.userId,
    warehouseAccountId: memberSessions.warehouse.userId,
    accountantAccountId: memberSessions.accountant.userId,
    customAccountId: memberSessions.custom.userId,
    branchAdminAccountId: memberSessions.branchAdmin.userId,
    scopeeAccountId: memberSessions.scopee.userId,
    revokeeAccountId: memberSessions.revokee.userId,
    lockeeAccountId: memberSessions.lockee.userId,
    ownerToken: ownerAToken,
    ownerBToken,
    managerToken: memberSessions.manager.accessToken,
    salesToken: memberSessions.sales.accessToken,
    warehouseToken: memberSessions.warehouse.accessToken,
    accountantToken: memberSessions.accountant.accessToken,
    customToken: memberSessions.custom.accessToken,
    branchAdminToken: memberSessions.branchAdmin.accessToken,
    scopeeToken: memberSessions.scopee.accessToken,
    revokeeToken: memberSessions.revokee.accessToken,
    lockeeToken: memberSessions.lockee.accessToken,
    logoutSessionToken: logoutSession.json.accessToken,
    expiredToken: expired,
    tamperedToken: tamper(ownerAToken),
    ownerRoleId: roles.owner.id,
    managerRoleId: roles.branch_manager.id,
    salesRoleId: roles.sales_staff.id,
    warehouseRoleId: roles.warehouse_staff.id,
    accountantRoleId: roles.accountant.id,
    customRoleId: customRole.id,
    branchAdminRoleId: branchAdminRole.id,
    revokeRoleId: revokeRole.id,
    unusedRoleId: unusedRole.id,
    productAId: product.json.id,
    productAName: product.json.name,
    customerAId: customer.json.id,
    customerAName: customer.json.name,
    randomProductId: crypto.randomUUID(),
    randomReceiptId: crypto.randomUUID(),
    randomRoleId: crypto.randomUUID(),
    randomWarehouseId: crypto.randomUUID(),
    unusedBranchCode: `TX${id.slice(-6).toUpperCase()}`,
    testPassword: PASSWORD,
    managerPermsCount: String(managerClaims.perms.length),
    customPermsCount: String(customClaims.perms.length),
    salesPermsCount: String(salesClaims.perms.length),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const environment = {
    id: crypto.randomUUID(),
    name: `PBL Security — ${id}`,
    values: Object.entries(values).map(([key, value]) => ({
      key,
      value: String(value),
      type: /token/i.test(key) ? 'secret' : 'default',
      enabled: true,
    })),
    _postman_variable_scope: 'environment',
  };
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'security-environment.json'),
    JSON.stringify(environment, null, 2),
  );

  const meta = {
    runId: id,
    generatedAt: new Date().toISOString(),
    mode: bases.mode,
    gateway: gateway ?? null,
    bases,
    quota,
    tenantA,
    tenantB,
    branches: { A1: branchA1, A2: branchA2, B1: branchB1 },
    roles: {
      seeded: Object.fromEntries(Object.entries(roles).map(([code, role]) => [code, role.id])),
      custom: customRole,
      branchAdmin: branchAdminRole,
      revoke: revokeRole,
      unused: unusedRole,
    },
    accounts: {
      ownerA: { email: ownerAEmail, id: ownerA.userId },
      ownerB: { email: ownerBEmail, id: ownerB.userId },
      manager: { email: managerEmail, id: memberSessions.manager.userId },
      sales: { email: salesEmail, id: memberSessions.sales.userId },
      warehouse: { email: warehouseEmail, id: memberSessions.warehouse.userId },
      accountant: { email: accountantEmail, id: memberSessions.accountant.userId },
      custom: { email: customEmail, id: memberSessions.custom.userId },
      branchAdmin: { email: branchAdminEmail, id: memberSessions.branchAdmin.userId },
      scopee: { email: scopeeEmail, id: memberSessions.scopee.userId },
      revokee: { email: revokeeEmail, id: memberSessions.revokee.userId },
      lockee: { email: lockeeEmail, id: memberSessions.lockee.userId },
    },
    productA: product.json,
    customerA: customer.json,
    claims: {
      manager: {
        tid: managerClaims.tid,
        roles: managerClaims.roles,
        branches: managerClaims.branches,
        permsCount: managerClaims.perms.length,
      },
      custom: {
        tid: customClaims.tid,
        roles: customClaims.roles,
        branches: customClaims.branches,
        perms: customClaims.perms,
      },
      sales: {
        tid: salesClaims.tid,
        roles: salesClaims.roles,
        branches: salesClaims.branches,
        permsCount: salesClaims.perms.length,
      },
    },
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'provisioning.json'), JSON.stringify(meta, null, 2));

  log(`[provision] tenant A=${tenantA} B=${tenantB}`);
  log(`[provision] environment -> ${path.join(RESULTS_DIR, 'security-environment.json')}`);
  return { values, meta, environment };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gatewayArg = process.argv.indexOf('--gateway');
  const gateway = gatewayArg >= 0 ? process.argv[gatewayArg + 1] : process.env.PBL_GATEWAY ?? null;
  provision({ gateway }).catch((error) => {
    console.error('[provision] FAILED:', error.message);
    process.exit(1);
  });
}
