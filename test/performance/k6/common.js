// Shared by the k6 scripts: data seeding (tenant, branch, warehouse, products, stock) and the load profiles.
import http from 'k6/http';
import { sleep, fail } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const PW = 'Passw0rd!';

export const headers = (token) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

function call(method, path, token, body, name) {
  return http.request(method, `${BASE}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: headers(token),
    tags: { name: name || 'setup' },
  });
}

// Seed: 1 tenant, 1 warehouse, `skus` products, each with `qty` on hand.
// Runs in setup(), so it is not measured (the seed requests carry the tag name=setup).
export function seedTenant({ skus = 200, qty = 10, cost = 60000 } = {}) {
  const run = Date.now();
  const email = `perf-${run}@example.com`;
  call('POST', '/platform/api/v1/auth/email/register', null, { email, password: PW, name: 'Perf Owner' });
  const first = call('POST', '/platform/api/v1/auth/email/login', null, { email, password: PW });
  if (first.status !== 200) fail(`login failed: ${first.status} ${first.body}`);
  const tenant = call('POST', '/platform/api/v1/tenants', first.json('accessToken'), { name: `Perf ${run}`, subdomain: `perf${run}` });
  if (tenant.status !== 201) fail(`create tenant failed: ${tenant.status} ${tenant.body}`);
  const token = tenant.json('auth.accessToken');
  const branches = call('GET', '/platform/api/v1/branches', token);
  const branchId = branches.json('data.0.id');

  // The branch reaches inventory through an async event, so retry until it arrives
  let warehouseId = null;
  for (let i = 0; i < 30 && !warehouseId; i++) {
    const w = call('POST', '/inventory/api/v1/warehouses', token, { code: 'WP1', name: 'Perf WH', branchId, isDefault: true });
    if (w.status === 201) warehouseId = w.json('id');
    else sleep(2);
  }
  if (!warehouseId) fail('cannot create warehouse (branch event not delivered?)');

  // Create products in batches of 20 parallel requests
  const skuIds = [];
  for (let start = 0; start < skus; start += 20) {
    const batch = [];
    for (let i = start; i < Math.min(start + 20, skus); i++) {
      batch.push(['POST', `${BASE}/catalog/api/v1/products`, JSON.stringify({
        name: `Perf SKU ${i}`, baseUnit: 'cai', createDefaultVariant: true, defaultSkuCode: `PF${run}-${i}`, defaultBasePrice: 100000,
      }), { headers: headers(token), tags: { name: 'setup' } }]);
    }
    for (const r of http.batch(batch)) {
      if (r.status !== 201) fail(`create product failed: ${r.status} ${r.body}`);
      skuIds.push(r.json('variants.0.id'));
    }
  }
  // Receive stock in batches of 50 lines
  for (let i = 0; i < skuIds.length; i += 50) {
    const items = skuIds.slice(i, i + 50).map((skuId) => ({ skuId, qty: String(qty), unitCost: cost }));
    const r = call('POST', '/inventory/api/v1/stock-receipts', token, { warehouseId, autoPost: true, items });
    if (r.status !== 201) fail(`seed receipt failed: ${r.status} ${r.body}`);
  }
  return { token, branchId, warehouseId, skuIds, run, initialQty: qty, cost };
}

// Load profiles. Pick one with the env var PROFILE; the peak number of VUs comes from VUS.
export function scenario(profile = __ENV.PROFILE || 'smoke') {
  const vus = Number(__ENV.VUS || 10);
  switch (profile) {
    case 'smoke': // 1 VU, a few calls: checks the script and gives a baseline
      return { executor: 'shared-iterations', vus: 1, iterations: Number(__ENV.ITERATIONS || 20), maxDuration: '2m' };
    case 'load': // steady load
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '20s', target: vus }, { duration: __ENV.HOLD || '2m', target: vus }, { duration: '10s', target: 0 }] };
    case 'spike': // sudden surge, then recovery
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '10s', target: vus }, { duration: '10s', target: vus * 5 }, { duration: '30s', target: vus * 5 }, { duration: '10s', target: vus }, { duration: '30s', target: vus }] };
    case 'stress': // ramp up to find the breaking point
      return { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: vus }, { duration: '1m', target: vus * 2 }, { duration: '1m', target: vus * 4 }, { duration: '1m', target: vus * 8 }, { duration: '30s', target: 0 }] };
    default:
      throw new Error(`Invalid PROFILE: ${profile} (smoke | load | spike | stress)`);
  }
}

export const think = () => { const s = Number(__ENV.THINK ?? 0.3); if (s > 0) sleep(Math.random() * s * 2); };
