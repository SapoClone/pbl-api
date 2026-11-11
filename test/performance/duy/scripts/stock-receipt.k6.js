import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

const runStartedAt = new Date().toISOString();
const profile = __ENV.PROFILE || 'smoke';
const baseUrl = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const token = __ENV.ACCESS_TOKEN;
const tenantId = __ENV.PERF_TENANT_ID;
const runId = __ENV.PERF_RUN_ID || '';
const fixtureLabel = __ENV.PERF_FIXTURE_LABEL || 'not-set';
const actorAccountId = __ENV.PERF_ACTOR_ACCOUNT_ID || '';
const warehouseId = __ENV.PERF_WAREHOUSE_ID || '';
const unitCost = Number(__ENV.PERF_UNIT_COST || '100000');
const quantity = __ENV.PERF_QTY || '1.000';
const lineCount = Number(__ENV.PERF_ITEM_COUNT || '1');
const skuOffset = Number(__ENV.PERF_SKU_OFFSET || '0');
const skuIdFile = __ENV.PERF_SKU_IDS_FILE || '../fixtures/perf-sku-ids.json';
const skuIds = loadSkuIds();
const responseCodes = new Counter('stock_receipt_response_codes');
const businessRequests = new Counter('stock_receipt_business_requests');
const requestJournal = new Counter('stock_receipt_request_journal');
const requestAttemptJournal = new Counter('stock_receipt_request_attempt');
const requestCapSkipped = new Counter('stock_receipt_request_cap_skipped');
const receiptLatencyMs = new Trend('stock_receipt_latency_ms');
const receiptLatencyByRequest = new Counter('stock_receipt_latency_by_request');
const non2xxResponses = new Rate('stock_receipt_non_2xx');
const postedResponseChecks = new Rate('stock_receipt_posted_response');
const maxRequestsByProfile = { smoke: 1, seed: 5, load: 240, lines: 1, concurrency: 25 };

function parseSkuIds(value) {
  const parsed = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (parsed.some((id) => typeof id !== 'string')) throw new Error('PERF_SKU_IDS must be comma-separated SKU UUID strings');
  return parsed;
}

function loadSkuIds() {
  if (__ENV.PERF_SKU_IDS) return parseSkuIds(__ENV.PERF_SKU_IDS);
  let parsed;
  try {
    parsed = JSON.parse(open(skuIdFile));
  } catch (_) {
    throw new Error('Unable to read PERF_SKU_IDS_FILE as JSON');
  }
  const ids = Array.isArray(parsed) ? parsed : parsed?.sku_ids;
  if (!Array.isArray(ids)) throw new Error('SKU fixture file must contain an array or { sku_ids: [] }');
  return ids;
}

const profiles = {
  smoke: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30s', gracefulStop: '5s' },
  seed: { executor: 'shared-iterations', vus: 1, iterations: 5, maxDuration: '180s', gracefulStop: '10s' },
  load: {
    executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '2m',
    preAllocatedVUs: 5, maxVUs: 5, gracefulStop: '10s',
  },
  concurrency: { executor: 'per-vu-iterations', vus: 5, iterations: 5, maxDuration: '2m', gracefulStop: '5s' },
  lines: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30s', gracefulStop: '5s' },
};

if (!profiles[profile]) throw new Error('Unknown PROFILE: ' + profile);
if (!/^http:\/\/(localhost|127\.0\.0\.1):8080$/.test(baseUrl)) {
  throw new Error('Safety guard: BASE_URL must point to local Gateway localhost:8080');
}
if (__ENV.PERF_ACK !== 'ISOLATED_LOCAL_TENANT') throw new Error('Set PERF_ACK=ISOLATED_LOCAL_TENANT');
if (__ENV.PERF_ENABLE_WRITE !== 'APPROVED_TEST_ONLY' || !__ENV.PERF_WRITE_APPROVAL_ID) {
  throw new Error('A user-approved PERF_WRITE_APPROVAL_ID and PERF_ENABLE_WRITE=APPROVED_TEST_ONLY are required');
}
if (!/^duy-perf-[a-z0-9-]+$/i.test(runId)) throw new Error('PERF_RUN_ID must begin with duy-perf- and be unique per run');
if (tenantId === 'a084d7f0-e029-4ce7-bf4e-ddff8e889aba') throw new Error('M10 tenant is excluded');
if (runId.length > 48) throw new Error('RunId length would compromise unique document codes');
if (!token || !tenantId || !warehouseId || !actorAccountId) throw new Error('ACCESS_TOKEN, PERF_TENANT_ID, PERF_WAREHOUSE_ID, and PERF_ACTOR_ACCOUNT_ID are required in process env');
if (!Number.isInteger(unitCost) || unitCost < 0) throw new Error('PERF_UNIT_COST must be a non-negative integer VND');
if (!/^\d+(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) throw new Error('PERF_QTY must be a positive numeric quantity with at most 3 decimals');
if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 200) throw new Error('PERF_ITEM_COUNT must be between 1 and the API DTO maximum of 200');
if (!Number.isInteger(skuOffset) || skuOffset < 0) throw new Error('PERF_SKU_OFFSET must be a non-negative integer');
if (profile === 'seed' && (lineCount !== 200 || skuOffset !== 1 || skuIds.length !== 1000)) {
  throw new Error('The stock seed profile is fixed to five receipts over SKU offsets 1..999 after the one-line smoke');
}
if (profile !== 'seed' && lineCount > 50) throw new Error('Performance workloads are limited to 50 receipt lines; 200 lines is reserved for fixture seed');
if (profile !== 'seed' && skuIds.length < skuOffset + lineCount) {
  throw new Error('PERF_SKU_IDS does not contain the requested offset and line count');
}
if (skuIds.some((id) => !/^[-0-9a-f]{36}$/i.test(id))) {
  throw new Error('PERF_SKU_IDS must contain UUID strings');
}
if (new Set(skuIds).size !== skuIds.length) {
  throw new Error('PERF_SKU_IDS must contain only distinct SKU IDs');
}
if (profile !== 'seed' && new Set(skuIds.slice(skuOffset, skuOffset + lineCount)).size !== lineCount) {
  throw new Error('Each receipt line needs a distinct SKU; duplicate SKUs are merged by the service');
}

export const options = {
  scenarios: { write_receipts: { ...profiles[profile], exec: 'writeReceipt' } },
  thresholds: {
    'http_req_duration{endpoint:stock-receipts}': ['p(95)<800'],
    'http_req_failed{endpoint:stock-receipts}': ['rate<0.01'],
    'stock_receipt_non_2xx{endpoint:stock-receipts}': ['rate<0.01'],
    'checks{endpoint:stock-receipts}': ['rate>0.99'],
    'stock_receipt_posted_response{endpoint:stock-receipts}': ['rate>0.99'],
    'stock_receipt_latency_ms{endpoint:stock-receipts}': ['p(95)<800'],
    ...(profile === 'load' ? { dropped_iterations: ['count==0'] } : {}),
  },
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

function readReceiptResponse(res) {
  try {
    const body = res.json();
    const receipt = body?.receipt || body?.data || body;
    return {
      hasId: typeof receipt?.id === 'string' && receipt.id.length > 0,
      id: typeof receipt?.id === 'string' ? receipt.id : 'missing',
      posted: receipt?.status === 'POSTED',
    };
  } catch (_) {
    return { hasId: false, id: 'missing', posted: false };
  }
}

export function writeReceipt() {
  const sequence = exec.scenario.iterationInTest;
  // The constant-arrival-rate executor can schedule one iteration exactly at
  // its duration boundary. Never let that boundary iteration exceed approval.
  if (sequence >= maxRequestsByProfile[profile]) {
    requestCapSkipped.add(1, { endpoint: 'stock-receipts', profile });
    return;
  }
  const uniqueRef = runId + '-req' + String(sequence).padStart(3, '0');
  const requestStartedAt = new Date().toISOString();
  const startIndex = profile === 'seed' ? skuOffset + (__ITER * lineCount) : skuOffset;
  const actualLineCount = profile === 'seed'
    ? Math.min(lineCount, skuIds.length - startIndex)
    : lineCount;
  const items = skuIds.slice(startIndex, startIndex + actualLineCount).map((skuId) => ({
    skuId,
    qty: quantity,
    unitCost,
    unitName: 'PCS',
    conversionFactor: '1.0000',
  }));
  const body = {
    warehouseId,
    code: uniqueRef.slice(0, 64),
    sourceType: 'MANUAL',
    autoPost: true,
    note: 'Duy performance run ' + runId + ' reference ' + uniqueRef,
    items,
  };
  const idempotencyKey = uniqueRef;
  requestAttemptJournal.add(1, { endpoint: 'stock-receipts', request_id: uniqueRef, idempotency_key: idempotencyKey, line_count: String(actualLineCount), started_at_utc: requestStartedAt });
  businessRequests.add(1, { endpoint: 'stock-receipts' });
  const res = http.post(baseUrl + '/inventory/api/v1/stock-receipts', JSON.stringify(body), {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Request-Id': uniqueRef,
      'Idempotency-Key': idempotencyKey,
    },
    tags: { endpoint: 'stock-receipts', name: 'POST stock-receipts', profile, lines: String(actualLineCount) },
    timeout: '30s',
    redirects: 0,
  });
  const parsed = readReceiptResponse(res);
  receiptLatencyMs.add(res.timings.duration, { endpoint: 'stock-receipts', profile, lines: String(actualLineCount) });
  receiptLatencyByRequest.add(res.timings.duration, { endpoint: 'stock-receipts', profile, request_id: uniqueRef });
  responseCodes.add(1, { endpoint: 'stock-receipts', status: String(res.status) });
  requestJournal.add(1, {
    endpoint: 'stock-receipts',
    request_id: uniqueRef,
    receipt_id: parsed.id,
    status: String(res.status),
    line_count: String(actualLineCount),
    actor_id: actorAccountId,
    request_started_utc: requestStartedAt,
  });
  non2xxResponses.add(res.status < 200 || res.status >= 300, { endpoint: 'stock-receipts' });
  postedResponseChecks.add(res.status === 201 && parsed.hasId && parsed.posted, { endpoint: 'stock-receipts' });
  check(res, {
    'receipt HTTP 201': (r) => r.status === 201,
    'receipt response has ID and POSTED status': () => res.status === 201 && parsed.hasId && parsed.posted,
  }, { endpoint: 'stock-receipts' });
  if (res.status !== 201 || !parsed.hasId || !parsed.posted) exec.test.abort('Receipt outcome failed or ambiguous; stop, reconcile committed in-flight requests, never retry');
}

export function handleSummary(data) {
  const safeRunId = runId.replace(/[^a-z0-9-]/gi, '_');
  const outDir = (__ENV.RESULTS_DIR || './results').replace(/[\\/]+$/, '');
  const filename = outDir + '/write-' + safeRunId + '-' + profile + '-lines' + lineCount + '.json';
  const maxRequests = maxRequestsByProfile[profile];
  const report = {
    ...data,
    run_metadata: {
      run_id: runId,
      user_approval_id: __ENV.PERF_WRITE_APPROVAL_ID,
      profile,
      fixture_label: fixtureLabel,
      tenant_id: tenantId,
      warehouse_id: warehouseId,
      actor_account_id: actorAccountId,
      expected_http_status: 201,
      expected_receipt_status: 'POSTED',
      line_count: lineCount,
      sku_offset: skuOffset,
      seed_item_counts: profile === 'seed' ? [200, 200, 200, 200, 199] : undefined,
      max_requests: maxRequests,
      request_cap_skipped_count: data.metrics?.stock_receipt_request_cap_skipped?.values?.count || 0,
      quantity_per_line: quantity,
      unit_cost_vnd: unitCost,
      started_at_utc: runStartedAt,
      finished_at_utc: new Date().toISOString(),
      endpoint: 'POST /inventory/api/v1/stock-receipts',
      gateway: baseUrl,
      automatic_retries: false,
      access_token_recorded: false,
      maximum_vus: profile === 'load' || profile === 'concurrency' ? 5 : 1,
    },
  };
  const duration = data.metrics?.['http_req_duration{endpoint:stock-receipts}']?.values || {};
  const reqs = data.metrics?.['stock_receipt_business_requests{endpoint:stock-receipts}']?.values || {};
  const errors = data.metrics?.['stock_receipt_non_2xx{endpoint:stock-receipts}']?.values || {};
  const stdout = [
    'k6 write summary: ' + runId + ' / ' + profile,
    'requests=' + (reqs.count ?? 'n/a') + ' req/s=' + (reqs.rate ?? 'n/a') + ' max_requests=' + maxRequests,
    'p50=' + (duration.med ?? 'n/a') + 'ms p90=' + (duration['p(90)'] ?? 'n/a') + 'ms p95=' + (duration['p(95)'] ?? 'n/a') + 'ms p99=' + (duration['p(99)'] ?? 'n/a') + 'ms max=' + (duration.max ?? 'n/a') + 'ms',
    'non_2xx_rate=' + (errors.rate ?? 'n/a'),
    'json=' + filename,
  ].join('\n') + '\n';
  return {
    [filename]: JSON.stringify(report, null, 2),
    stdout,
  };
}
