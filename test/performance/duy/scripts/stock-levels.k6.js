import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

const runStartedAt = new Date().toISOString();
const profile = __ENV.PROFILE || 'smoke';
const baseUrl = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const token = __ENV.ACCESS_TOKEN;
const tenantId = __ENV.PERF_TENANT_ID;
const branchId = __ENV.PERF_BRANCH_ID;
const runId = __ENV.PERF_RUN_ID || '';
const fixtureLabel = __ENV.PERF_FIXTURE_LABEL || 'not-set';
const limit = Number(__ENV.PAGE_LIMIT || '100');
const page = Number(__ENV.PAGE || '1');
const responseCodes = new Counter('stock_levels_response_codes');
const businessRequests = new Counter('stock_levels_business_requests');
const status200 = new Counter('stock_levels_http_200');
const status4xx = new Counter('stock_levels_http_4xx');
const status5xx = new Counter('stock_levels_http_5xx');
const statusOther = new Counter('stock_levels_http_other');
const non200Responses = new Rate('stock_levels_non_200');
const responseShapeChecks = new Rate('stock_levels_response_shape');
const returnedRows = new Trend('stock_levels_returned_rows');

// Closed-model read scenarios have a one-second think time. That bounds the
// theoretical iteration rate to at most one request/VU/second, excluding setup.
const profiles = {
  smoke: { executor: 'shared-iterations', vus: 1, iterations: 3, maxDuration: '30s', gracefulStop: '5s' },
  baseline: { executor: 'constant-vus', vus: 1, duration: '30s', gracefulStop: '5s' },
  load: { executor: 'constant-vus', vus: 10, duration: '2m', gracefulStop: '5s' },
  spike: {
    executor: 'ramping-vus', startVUs: 0,
    stages: [
      { duration: '10s', target: 50 },
      { duration: '30s', target: 50 },
      { duration: '10s', target: 0 },
      { duration: '30s', target: 1 },
    ],
    gracefulRampDown: '10s', gracefulStop: '5s',
  },
  stress: {
    executor: 'ramping-vus', startVUs: 1,
    stages: [
      { duration: '1m', target: 10 },
      { duration: '1m', target: 20 },
      { duration: '1m', target: 35 },
      { duration: '1m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s', gracefulStop: '5s',
  },
};

if (!profiles[profile]) throw new Error('Unknown PROFILE: ' + profile);
if (!/^http:\/\/(localhost|127\.0\.0\.1):8080$/.test(baseUrl)) {
  throw new Error('Safety guard: BASE_URL must point to local Gateway localhost:8080');
}
if (__ENV.PERF_ACK !== 'ISOLATED_LOCAL_TENANT') throw new Error('Set PERF_ACK=ISOLATED_LOCAL_TENANT');
if (!/^duy-perf-[a-z0-9-]+$/i.test(runId)) throw new Error('PERF_RUN_ID must begin with duy-perf-');
if (!token || !tenantId || !branchId) throw new Error('ACCESS_TOKEN, PERF_TENANT_ID, and PERF_BRANCH_ID are required in process env');
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('PAGE_LIMIT must be in [1,100]');
if (!Number.isInteger(page) || page < 1) throw new Error('PAGE must be a positive integer');

const sharedThresholds = {
  'http_req_duration{endpoint:stock-levels}': ['p(95)<500'],
  'http_req_failed{endpoint:stock-levels}': ['rate<0.01'],
  'stock_levels_non_200{endpoint:stock-levels}': ['rate<0.01'],
  'checks{endpoint:stock-levels}': ['rate>0.99'],
};

export const options = {
  scenarios: { read_stock_levels: { ...profiles[profile], exec: 'readStockLevels' } },
  thresholds: sharedThresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
  const res = http.get(baseUrl + '/platform/api/v1/tenants/current', {
    headers: { Authorization: 'Bearer ' + token },
    tags: { endpoint: 'setup-tenant' },
    timeout: '10s',
  });
  if (res.status !== 200) fail('Tenant preflight failed: HTTP ' + res.status);
  let body;
  try { body = res.json(); } catch (_) { fail('Tenant preflight returned non-JSON'); }
  const actualTenantId = body?.id || body?.tenant?.id || body?.data?.id;
  if (actualTenantId !== tenantId) fail('Token tenant does not match PERF_TENANT_ID');
}

export function readStockLevels() {
  let stage = 'steady';
  if (profile === 'spike') {
    const elapsed = exec.scenario.progress * 80;
    stage = elapsed < 10 ? 'ramp_up' : elapsed < 40 ? 'hold_50_vu' : elapsed < 50 ? 'ramp_down' : 'recovery_1_vu';
  } else if (profile === 'stress') {
    const elapsed = exec.scenario.progress * 270;
    stage = elapsed < 60 ? 'ramp_to_10' : elapsed < 120 ? 'ramp_to_20' : elapsed < 180 ? 'ramp_to_35' : elapsed < 240 ? 'ramp_to_50' : 'ramp_down';
  }
  const url = baseUrl + '/inventory/api/v1/stock-levels?branchId=' +
    encodeURIComponent(branchId) + '&page=' + page + '&limit=' + limit;
  const res = http.get(url, {
    headers: { Authorization: 'Bearer ' + token },
    tags: { endpoint: 'stock-levels', name: 'GET stock-levels', profile, stage, limit: String(limit) },
    timeout: '15s',
  });
  let rowCount = -1;
  let shapeValid = false;
  try {
    const payload = res.json();
    shapeValid = Array.isArray(payload?.data) && typeof payload?.pagination?.totalRecords === 'number';
    if (shapeValid) rowCount = payload.data.length;
  } catch (_) {}
  responseCodes.add(1, { endpoint: 'stock-levels', status: String(res.status), stage });
  businessRequests.add(1, { endpoint: 'stock-levels', stage });
  if (res.status === 200) status200.add(1, { endpoint: 'stock-levels', stage });
  else if (res.status >= 400 && res.status < 500) status4xx.add(1, { endpoint: 'stock-levels', stage });
  else if (res.status >= 500) status5xx.add(1, { endpoint: 'stock-levels', stage });
  else statusOther.add(1, { endpoint: 'stock-levels', stage });
  non200Responses.add(res.status !== 200, { endpoint: 'stock-levels', stage });
  responseShapeChecks.add(shapeValid, { endpoint: 'stock-levels', stage });
  returnedRows.add(rowCount, { endpoint: 'stock-levels', stage });
  check(res, {
    'stock-levels HTTP 200': (r) => r.status === 200,
    'stock-levels response has data and pagination': () => shapeValid,
  }, { endpoint: 'stock-levels', stage });
  sleep(1);
}

export function handleSummary(data) {
  const safeRunId = runId.replace(/[^a-z0-9-]/gi, '_');
  const outDir = (__ENV.RESULTS_DIR || './results').replace(/[\\/]+$/, '');
  const filename = outDir + '/read-' + safeRunId + '-' + profile + '-p' + page + '-l' + limit + '.json';
  const report = {
    ...data,
    run_metadata: {
      run_id: runId,
      profile,
      fixture_label: fixtureLabel,
      tenant_id: tenantId,
      branch_id: branchId,
      page,
      limit,
      started_at_utc: runStartedAt,
      finished_at_utc: new Date().toISOString(),
      endpoint: 'GET /inventory/api/v1/stock-levels',
      gateway: baseUrl,
      max_vus: profile === 'smoke' || profile === 'baseline' ? 1 : profile === 'load' ? 10 : 50,
      think_time_seconds: 1,
      stage_tagging: profile === 'spike' || profile === 'stress',
      stage_boundaries_seconds: profile === 'spike'
        ? [{stage:'ramp_up',from:0,to:10},{stage:'hold_50_vu',from:10,to:40},{stage:'ramp_down',from:40,to:50},{stage:'recovery_1_vu',from:50,to:80}]
        : profile === 'stress'
          ? [{stage:'ramp_to_10',from:0,to:60},{stage:'ramp_to_20',from:60,to:120},{stage:'ramp_to_35',from:120,to:180},{stage:'ramp_to_50',from:180,to:240},{stage:'ramp_down',from:240,to:270}]
          : [],
      access_token_recorded: false,
    },
  };
  const duration = data.metrics?.['http_req_duration{endpoint:stock-levels}']?.values || {};
  const reqs = data.metrics?.stock_levels_business_requests?.values || {};
  const errors = data.metrics?.stock_levels_non_200?.values || {};
  const stdout = [
    'k6 read summary: ' + runId + ' / ' + profile,
    'requests=' + (reqs.count ?? 'n/a') + ' req/s=' + (reqs.rate ?? 'n/a'),
    'p50=' + (duration.med ?? 'n/a') + 'ms p90=' + (duration['p(90)'] ?? 'n/a') + 'ms p95=' + (duration['p(95)'] ?? 'n/a') + 'ms p99=' + (duration['p(99)'] ?? 'n/a') + 'ms max=' + (duration.max ?? 'n/a') + 'ms',
    'non_200_rate=' + (errors.rate ?? 'n/a'),
    'response_codes=' + JSON.stringify({
      '200': data.metrics?.stock_levels_http_200?.values?.count || 0,
      '4xx': data.metrics?.stock_levels_http_4xx?.values?.count || 0,
      '5xx': data.metrics?.stock_levels_http_5xx?.values?.count || 0,
      other: data.metrics?.stock_levels_http_other?.values?.count || 0,
    }),
    'json=' + filename,
  ].join('\n') + '\n';
  return {
    [filename]: JSON.stringify(report, null, 2),
    stdout,
  };
}
