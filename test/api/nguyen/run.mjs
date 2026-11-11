import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const reports = join(here, 'reports');
mkdirSync(reports, { recursive: true });
const base = process.env.GATEWAY_URL || 'http://localhost:8080';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = [];
function command(name, args, cwd = repo) {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' && name === 'npm' });
  log.push(`$ ${name} ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}\nexit=${result.status ?? 'spawn error'}\n`);
  if (result.status !== 0) throw new Error(`${name} exited ${result.status}: ${result.error?.message || result.stderr?.slice(-1000)}`);
  return result;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let token;
async function api(method, path, body, auth = token) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  log.push(`${method} ${path} -> ${response.status} ${response.ok ? '' : JSON.stringify(data).slice(0, 600)}\n`);
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data).slice(0, 600)}`);
  return data;
}
async function until(label, fn, attempts = 45) {
  for (let i = 0; i < attempts; i++) {
    try { if (await fn()) return; } catch { /* eventual projection */ }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function seed() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'Passw0rd!';
  const owner = `nguyen-owner-${unique}@example.com`;
  const staff = `nguyen-staff-${unique}@example.com`;
  const accountant = `nguyen-accountant-${unique}@example.com`;
  const p = '/platform/api/v1', c = '/catalog/api/v1', i = '/inventory/api/v1';
  for (const email of [owner, staff, accountant]) await api('POST', `${p}/auth/email/register`, { email, password, name: email.split('@')[0] }, null);
  token = (await api('POST', `${p}/auth/email/login`, { email: owner, password }, null)).accessToken;
  const tenant = await api('POST', `${p}/tenants`, { name: `Nguyen API ${unique}`, subdomain: `nguyen-${unique}`, defaultBranchName: 'Nguyen test branch' });
  token = tenant.auth.accessToken;
  // Tenant creation already provisions one branch. The Free plan allows only one.
  const branches = await api('GET', `${p}/branches`);
  const branch = branches.data?.[0];
  if (!branch?.id) throw new Error('Tenant was created without a readable default branch');
  let warehouse;
  await until('inventory branch projection', async () => {
    try { warehouse = await api('POST', `${i}/warehouses`, { code: 'NG-WH', name: 'Nguyen test warehouse', branchId: branch.id, isDefault: true }); return true; }
    catch (e) { if (!/branch|not found/i.test(String(e))) throw e; return false; }
  });
  const product = await api('POST', `${c}/products`, { name: 'Test product', baseUnit: 'cai', createDefaultVariant: true, defaultSkuCode: `NG-${unique}`.slice(0, 30), defaultBasePrice: 120000 });
  const variantId = product.variants[0].id;
  await until('sales and inventory catalog/branch projections', async () => {
    const [stock, sales] = await Promise.all([
      api('GET', `${i}/stock-levels?branchId=${branch.id}`),
      api('GET', `/sales/api/v1/orders?branchId=${branch.id}&limit=1`),
    ]);
    return Array.isArray(stock.data) && sales.data !== undefined;
  });
  // Retry the receipt while catalog's asynchronous SKU projection catches up.
  let receipt;
  await until('inventory SKU projection', async () => {
    try { receipt = await api('POST', `${i}/stock-receipts`, { warehouseId: warehouse.id, items: [{ skuId: variantId, qty: '12', unitCost: 70000 }] }); return true; }
    catch (e) { if (!/SKU|variant|not found/i.test(String(e))) throw e; return false; }
  });
  await api('POST', `${i}/stock-receipts/${receipt.id}/submit`, {});
  await api('POST', `${i}/stock-receipts/${receipt.id}/approve`, {});
  await until('12 units in stock', async () => {
    const s = await api('GET', `${i}/stock-levels?branchId=${branch.id}`);
    return s.data.some(x => x.variantId === variantId && Number(x.onHand) === 12);
  });
  await api('POST', `${p}/tenants/current/members`, { email: staff, role: 'sales_staff' });
  await api('POST', `${p}/tenants/current/members`, { email: accountant, role: 'accountant' });
  const staffToken = (await api('POST', `${p}/auth/email/login`, { email: staff, password, tenantId: tenant.tenant.id }, null)).accessToken;
  const accountantToken = (await api('POST', `${p}/auth/email/login`, { email: accountant, password, tenantId: tenant.tenant.id }, null)).accessToken;
  if (![token, staffToken, accountantToken, variantId].every(Boolean)) throw new Error('Seed lacks a token or variant');
  // BR-05: a second store starts its own HD sequence. Use a separate owner so
  // this remains independent of the first account's store quota.
  const ownerB = `nguyen-b-${unique}@example.com`;
  await api('POST', `${p}/auth/email/register`, { email: ownerB, password, name: 'Nguyen tenant B' }, null);
  const accountBToken = (await api('POST', `${p}/auth/email/login`, { email: ownerB, password }, null)).accessToken;
  const tenantB = await api('POST', `${p}/tenants`, { name: `Nguyen B ${unique}`, subdomain: `nguyen-b-${unique}` }, accountBToken);
  const tenantBToken = tenantB.auth.accessToken;
  const branchB = (await api('GET', `${p}/branches`, undefined, tenantBToken)).data?.[0];
  if (!branchB?.id) throw new Error('Tenant B lacks a default branch');
  const productB = await api('POST', `${c}/products`, { name: 'Tenant B product', baseUnit: 'cai', createDefaultVariant: true,
    defaultSkuCode: `NGB-${unique}`.slice(0, 30), defaultBasePrice: 120000 }, tenantBToken);
  let firstB;
  await until('tenant B sales projections', async () => {
    try {
      firstB = await api('POST', '/sales/api/v1/orders/omnichannel', { branchId: branchB.id, channelType: 'ONLINE',
        lines: [{ variantId: productB.variants[0].id, qty: 1 }], autoConfirm: false }, tenantBToken);
      return true;
    } catch (e) {
      if (!/branch|sku|variant|catalog|not found|price/i.test(String(e))) throw e;
      return false;
    }
  });
  if (!firstB?.id || !/^HD-\d{8}-000001$/.test(firstB.code)) throw new Error('Tenant B did not receive its first order code');
  return { base, token, staffToken, accountantToken, branchId: branch.id, warehouseId: warehouse.id, variantId,
    tenantId: tenant.tenant.id, tenantBToken, tenantBOrderId: firstB.id, tenantBCode: firstB.code, tenantBId: tenantB.tenant.id };
}
function htmlFrom(report) {
  const rows = (report.run?.executions || []).map(e => {
    const failures = (e.assertions || []).filter(a => a.error).map(a => a.assertion).join('; ');
    const errors = (e.requestError ? [String(e.requestError)] : []).concat(failures ? [failures] : []);
    const passed = !!e.response && !errors.length && (e.assertions || []).length > 0;
    return `<tr><td>${escape(e.item?.name)}</td><td>${e.response?.code ?? '-'}</td><td>${passed ? 'Passed' : 'FAILED'}</td><td>${escape(errors.join('; ') || 'No response/assertion')}</td></tr>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Nguyen API Newman ${stamp}</title><h1>Nguyen API testing</h1><p>${escape(stamp)} · ${report.run?.stats?.assertions?.failed ?? '?'} failed assertions</p><table border="1" cellpadding="6"><tr><th>Request</th><th>HTTP</th><th>Result</th><th>Failure</th></tr>${rows}</table>`;
}
function escape(s) { return String(s ?? '').replace(/[&<>"']/g, x => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[x]); }
let exit = 1;
let newmanRan = false;
try {
  if (!process.argv.includes('--existing-stack')) command('docker', ['compose', 'up', '-d', '--build']);
  await until('API Gateway health', async () => (await fetch(`${base}/platform/health`)).ok, 90);
  const env = await seed();
  const newman = join(here, 'node_modules', 'newman', 'bin', 'newman.js');
  if (!existsSync(newman)) command('npm', ['install', '--no-audit', '--no-fund'], here);
  const jsonPath = join(reports, `${stamp}.json`);
  newmanRan = true;
  const cmd = spawnSync(process.execPath, [newman, 'run', join(here, 'nguyen.postman_collection.json'), '--env-var', `base=${base}`,
    ...Object.entries(env).filter(([k]) => k !== 'base').flatMap(([k, v]) => ['--env-var', `${k}=${v}`]),
    '--delay-request', '1000', '--reporters', 'cli,json', '--reporter-json-export', jsonPath], { cwd: repo, encoding: 'utf8' });
  log.push(cmd.stdout || '', cmd.stderr || '', `Newman exit=${cmd.status}\n`);
  if (existsSync(jsonPath)) {
    const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
    writeFileSync(jsonPath.replace(/\.json$/, '.html'), htmlFrom(report));
    const summary = spawnSync(process.execPath, [join(here, 'summarize_newman.mjs'), jsonPath,
      jsonPath.replace(/\.json$/, '.summary.json')], { cwd: repo, encoding: 'utf8' });
    log.push(summary.stdout || '', summary.stderr || '');
    if (summary.status !== 0) throw new Error(`Could not summarize Newman report: ${summary.stderr}`);
    // Newman exports request Authorization headers. Keep raw evidence local only.
  }
  exit = cmd.status ?? 1;
  if (exit !== 0) throw new Error(`Newman failed: ${cmd.error?.message || exit}`);
} catch (error) {
  log.push(`BLOCKED/FAILED: ${error.stack}\n`);
  process.stderr.write(`${error.message}\n`);
  const summary = { kind: 'preflight-or-execution-failure', timestamp: stamp, result: newmanRan ? 'FAILED' : 'BLOCKED',
    reason: String(error.message), newmanExecuted: newmanRan, passedCases: newmanRan ? null : 0 };
  if (!newmanRan) {
    writeFileSync(join(reports, `${stamp}.blocked.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(reports, `${stamp}.blocked.html`), `<!doctype html><meta charset="utf-8"><title>Blocked API run</title><h1>Blocked before Newman</h1><p>${escape(summary.timestamp)}</p><pre>${escape(summary.reason)}</pre><p>Passed cases: 0</p>`);
  }
} finally {
  writeFileSync(join(reports, `${stamp}.log`), log.join('\n').replace(/Bearer\s+[^\s"']+/g, 'Bearer [REDACTED]'));
  process.stdout.write(`Evidence: ${reports} (${stamp})\n`);
}
process.exitCode = exit;
