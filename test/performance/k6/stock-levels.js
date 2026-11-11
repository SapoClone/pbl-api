// Stock lookup (read API). NFR-PF-02 thresholds: p95 < 500 ms, errors < 1%.
// Run: k6 run -e PROFILE=load -e VUS=10 test/performance/k6/stock-levels.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE, headers, seedTenant, scenario, think } from './common.js';

const LIMIT = __ENV.LIMIT || 50;

export const options = {
  setupTimeout: '300s',
  scenarios: { stock_levels: scenario() },
  thresholds: {
    'http_req_duration{name:stock-levels}': ['p(95)<500'],
    'http_req_failed{name:stock-levels}': ['rate<0.01'],
    checks: ['rate>0.99'],
    iterations: ['count>0'], // avoid a false pass when the seed fails and nothing is measured
  },
};

export function setup() {
  return seedTenant({ skus: Number(__ENV.SKUS || 200) });
}

export default function (d) {
  const res = http.get(`${BASE}/inventory/api/v1/stock-levels?branchId=${d.branchId}&limit=${LIMIT}`, {
    headers: headers(d.token),
    tags: { name: 'stock-levels' },
  });
  check(res, {
    'HTTP 200': (r) => r.status === 200,
    'has stock rows': (r) => { try { return r.json('data').length > 0; } catch (e) { return false; } },
  });
  think();
}
