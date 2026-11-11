// Produce shareable evidence without copying Newman environment variables or tokens.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node summarize_newman.mjs <newman.json> <summary.json>');
const report = JSON.parse(readFileSync(input, 'utf8'));
const failures = report.run?.failures || [];
const executions = report.run?.executions || [];
const cases = Array.from({ length: 26 }, (_, index) => {
  const id = `TC-NG-${String(index + 1).padStart(2, '0')}`;
  const executed = executions.filter(e => e.item?.name?.includes(id));
  const failed = failures.filter(f => f.source?.name?.includes(id));
  return { id, result: !executed.length ? 'BLOCKED' : failed.length ? 'FAILED' : 'PASSED',
    executedRequests: executed.length, failedAssertions: failed.length };
});
const detail = failures.map(f => {
  const execution = executions.find(e => e.item?.name === f.source?.name);
  let response;
  try {
    const raw = execution?.response?.stream?.data;
    const parsed = JSON.parse(Buffer.from(raw || []).toString('utf8'));
    response = Object.fromEntries(['id','orderStatus','fulfillmentStatus','errorCode','message','shortageDetected','exceptionCode']
      .filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]));
  } catch { response = null; }
  return { request: f.source?.name, assertion: f.error?.test, reason: f.error?.message,
    httpStatus: execution?.response?.code, response };
});
const summary = {
  source: 'Newman JSON, response fields allowlisted; bearer tokens and environment excluded',
  timestamp: report.run?.timings?.started,
  requests: report.run?.stats?.requests?.total,
  assertions: report.run?.stats?.assertions?.total,
  failedAssertions: report.run?.stats?.assertions?.failed,
  caseTotals: { passed: cases.filter(c => c.result === 'PASSED').length,
    failed: cases.filter(c => c.result === 'FAILED').length,
    blocked: cases.filter(c => c.result === 'BLOCKED').length },
  cases, failures: detail,
};
writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(`${summary.caseTotals.passed} passed, ${summary.caseTotals.failed} failed, ${summary.caseTotals.blocked} blocked`);
