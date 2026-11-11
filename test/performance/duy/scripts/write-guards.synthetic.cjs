// Exercise the real writeReceipt function using a VM and mocked HTTP; no network.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const script = path.join(__dirname, 'stock-receipt.k6.js');
const original = fs.readFileSync(script, 'utf8');
const source = original.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
assert.equal((original.match(/http\.post\(/g) || []).length, 1);
const uuid = i => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const cases = [];
for (const spec of [{ profile: 'lines', lines: 10, cap: 1 }, { profile: 'lines', lines: 50, cap: 1 }, { profile: 'concurrency', lines: 1, cap: 25 }, { profile: 'load', lines: 1, cap: 240 }]) {
  const calls = [], metrics = [], execution = { scenario: { iterationInTest: 0 } };
  class Metric { constructor(name) { this.name = name; } add(value, tags) { metrics.push({ name: this.name, value, tags }); } }
  const env = { PROFILE: spec.profile, BASE_URL: 'http://localhost:8080', PERF_ACK: 'ISOLATED_LOCAL_TENANT',
    ACCESS_TOKEN: 'SYNTHETIC_ONLY', PERF_TENANT_ID: uuid(1), PERF_WAREHOUSE_ID: uuid(2), PERF_ACTOR_ACCOUNT_ID: uuid(3),
    PERF_RUN_ID: `duy-perf-synthetic-${spec.profile}-${spec.lines}`, PERF_ENABLE_WRITE: 'APPROVED_TEST_ONLY', PERF_WRITE_APPROVAL_ID: 'SYNTHETIC_ONLY',
    PERF_QTY: '0.001', PERF_UNIT_COST: '100000', PERF_ITEM_COUNT: String(spec.lines), PERF_SKU_IDS: Array.from({ length: 100 }, (_, i) => uuid(i + 10)).join(',') };
  const context = vm.createContext({ __ENV: env, exec: execution, Counter: Metric, Rate: Metric, Trend: Metric, check: () => true, fail: x => { throw Error(x); },
    http: { post(url, body, opts) { calls.push({ url, body: JSON.parse(body), opts }); return { status: 201, timings: { duration: 1 }, json: () => ({ id: uuid(calls.length + 200), status: 'POSTED' }) }; } } });
  vm.runInContext(source + '\nglobalThis.invoke = writeReceipt;', context);
  for (let i = 0; i <= spec.cap + 1; i++) { execution.scenario.iterationInTest = i; context.invoke(); }
  assert.equal(calls.length, spec.cap);
  assert(calls.every(c => c.body.items.length === spec.lines && c.body.autoPost === true));
  assert.equal(new Set(calls.map(c => c.opts.headers['X-Request-Id'])).size, spec.cap);
  assert(calls.every(c => c.opts.headers['X-Request-Id'] === c.opts.headers['Idempotency-Key']));
  assert.equal(metrics.filter(m => m.name === 'stock_receipt_request_cap_skipped').length, 2);
  let timeoutAttempts = 0;
  context.http.post = () => { timeoutAttempts++; throw Error('SYNTHETIC_TIMEOUT'); };
  execution.scenario.iterationInTest = 0;
  assert.throws(() => context.invoke(), /SYNTHETIC_TIMEOUT/);
  assert.equal(timeoutAttempts, 1);
  let failedAttempts = 0;
  context.exec.test = { abort: msg => { throw Error(msg); } };
  context.http.post = () => { failedAttempts++; return { status: 500, timings: { duration: 1 }, json: () => ({}) }; };
  assert.throws(() => context.invoke(), /Receipt outcome failed/);
  assert.equal(failedAttempts, 1);
  cases.push({ ...spec, mocked_posts: calls.length, boundary_iterations_skipped: 2, distinct_request_ids: spec.cap, timeout_attempts: timeoutAttempts, failed_response_attempts: failedAttempts, retry: false });
}
// A timeout is propagated after one mocked attempt; the function has no retry loop.
assert(!/http\.post[\s\S]*http\.post/.test(original));
console.log(JSON.stringify({ status: 'PASS', network_requests: 0, cases, tested_source: script }, null, 2));
