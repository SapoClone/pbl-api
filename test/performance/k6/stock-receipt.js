// Stock receipt posting (write API, weighted-average cost). NFR-PF-02 thresholds: p95 < 800 ms, errors < 1%.
// Run: k6 run -e PROFILE=load -e VUS=5 test/performance/k6/stock-receipt.js
// Afterwards: node test/performance/k6/verify-receipts.js  (on hand must equal the successful receipts: no lost update)
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, headers, seedTenant, scenario, think } from './common.js';

const receiptsOk = new Counter('receipts_ok');

export const options = {
  setupTimeout: '300s',
  scenarios: { stock_receipt: scenario() },
  thresholds: {
    'http_req_duration{name:stock-receipt}': ['p(95)<800'],
    'http_req_failed{name:stock-receipt}': ['rate<0.01'],
    checks: ['rate>0.99'],
    iterations: ['count>0'], // avoid a false pass when the seed fails and nothing is measured
  },
};

export function setup() {
  // A single SKU so that every VU contends for the same stock row
  return seedTenant({ skus: 1, qty: 10 });
}

export default function (d) {
  const res = http.post(`${BASE}/inventory/api/v1/stock-receipts`,
    JSON.stringify({ warehouseId: d.warehouseId, autoPost: true, items: [{ skuId: d.skuIds[0], qty: '1', unitCost: d.cost }] }),
    { headers: headers(d.token), tags: { name: 'stock-receipt' } });
  const ok = check(res, {
    'HTTP 201': (r) => r.status === 201,
    'receipt is POSTED': (r) => { try { return r.json('status') === 'POSTED'; } catch (e) { return false; } },
  });
  if (ok) receiptsOk.add(1);
  think();
}

// Save what verify-receipts.js needs to compare the real stock after the run
export function handleSummary(data) {
  const out = {
    receiptsOk: data.metrics.receipts_ok ? data.metrics.receipts_ok.values.count : 0,
    setup: data.setup_data || null,
  };
  return { 'test/performance/k6/results/perf-receipts.json': JSON.stringify(out, null, 2), stdout: textSummary(data) };
}

function textSummary(data) {
  const m = data.metrics;
  const d = m['http_req_duration{name:stock-receipt}'];
  const p95 = d ? d.values['p(95)'].toFixed(0) : 'n/a';
  return `\nSuccessful receipts: ${m.receipts_ok ? m.receipts_ok.values.count : 0} | write p95: ${p95} ms\n`;
}
