import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import newman from 'newman';
import { provision } from './provision.mjs';
import { writeCollection } from './build-collection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, 'results');
const COLLECTION_PATH = path.join(HERE, 'security-rbac.postman_collection.json');
const ENV_PATH = path.join(RESULTS_DIR, 'security-environment.json');
const NEWMAN_JSON = path.join(RESULTS_DIR, 'newman.json');
const NEWMAN_HTML = path.join(RESULTS_DIR, 'report.html');
const SUMMARY_JSON = path.join(RESULTS_DIR, 'summary.json');
const SUMMARY_MD = path.join(RESULTS_DIR, 'summary.md');

const argv = process.argv.slice(2);
const gatewayIndex = argv.indexOf('--gateway');
const gateway = gatewayIndex >= 0 ? argv[gatewayIndex + 1] : process.env.PBL_GATEWAY ?? null;
const skipProvision = argv.includes('--skip-provision');
const strict = argv.includes('--strict');
const noHtml = argv.includes('--no-html');

function groupOf(name) {
  if (name.includes('TC-SEC-SETUP')) return '00 — Preconditions';
  if (name.includes('TC-SEC-AUTH')) return '01 — Authentication';
  if (name.includes('TC-SEC-RBAC')) return '02 — RBAC matrix';
  if (name.includes('TC-SEC-X-')) return '03 — RBAC bổ sung';
  if (name.includes('TC-SEC-ROLE')) return '04 — Vai trò & 400/409';
  if (name.includes('TC-SEC-TEN')) return '05 — Tenant isolation';
  if (name.includes('TC-SEC-BRA')) return '06 — Branch isolation';
  if (name.includes('TC-SEC-REV')) return '07 — Revocation';
  return '99 — Khác';
}

function idOf(name) {
  const match = name.match(/TC-SEC-[A-Z]+-\d+/);
  return match ? match[0] : name;
}

const EXPECTED_DEFECT_CASES = new Set(['TC-SEC-REV-03', 'TC-SEC-REV-08']);

function loadEnvironment() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`Không thấy ${ENV_PATH}. Chạy provision.mjs trước.`);
  }
  return JSON.parse(fs.readFileSync(ENV_PATH, 'utf8'));
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  writeCollection();
  if (!skipProvision) {
    await provision({ gateway });
  }
  const environment = loadEnvironment();
  const envValues = Object.fromEntries(environment.values.map((v) => [v.key, v.value]));

  console.log('\n[newman] Bắt đầu chạy collection...');
  const started = Date.now();
  const summary = await new Promise((resolve, reject) => {
    newman.run(
      {
        collection: COLLECTION_PATH,
        environment: ENV_PATH,
        reporters: noHtml ? ['cli', 'json'] : ['cli', 'json', 'htmlextra'],
        reporter: {
          json: { export: NEWMAN_JSON },
          ...(noHtml
            ? {}
            : {
                htmlextra: {
                  export: NEWMAN_HTML,
                  title: `PBL Luồng 1 — Security & Authorization (${envValues.runId ?? 'run'})`,
                  showEnvironmentData: false,
                  skipSensitiveData: false,
                  browserTitle: 'PBL Security Test Report',
                },
              }),
        },
        timeoutRequest: 15000,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
  const duration = Date.now() - started;

  const run = JSON.parse(fs.readFileSync(NEWMAN_JSON, 'utf8')).run;
  const cases = run.executions.map((execution) => {
    const name = execution.item.name;
    const id = idOf(name);
    const failures = (execution.assertions ?? [])
      .filter((assertion) => assertion.error)
      .map((assertion) => `${assertion.assertion}: ${assertion.error.message ?? assertion.error}`);
    return {
      id,
      group: groupOf(name),
      name,
      httpStatus: execution.response?.code ?? null,
      passed: failures.length === 0,
      expectedDefect: EXPECTED_DEFECT_CASES.has(id) && failures.length > 0,
      failures,
    };
  });

  const totals = {
    cases: cases.length,
    passed: cases.filter((c) => c.passed).length,
    failed: cases.filter((c) => !c.passed).length,
    knownDefects: cases.filter((c) => c.expectedDefect).length,
    unexpectedFailures: cases.filter((c) => !c.passed && !c.expectedDefect).length,
    assertions: run.stats.assertions.total,
    failedAssertions: run.stats.assertions.failed,
    requests: run.stats.requests.total,
    durationMs: duration,
  };

  const groups = {};
  for (const testCase of cases) {
    groups[testCase.group] ??= { cases: 0, passed: 0, failed: 0 };
    groups[testCase.group].cases += 1;
    if (testCase.passed) groups[testCase.group].passed += 1;
    else groups[testCase.group].failed += 1;
  }

  const summaryDoc = {
    runId: envValues.runId ?? null,
    mode: envValues.platformBase?.includes(':8080') ? 'gateway' : 'direct',
    platformBase: envValues.platformBase,
    executedAt: new Date().toISOString(),
    durationMs: duration,
    totals,
    groups,
    cases,
  };
  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summaryDoc, null, 2));

  const md = [];
  md.push(`# Kết quả chạy bộ kiểm thử bảo mật — ${summaryDoc.runId}`);
  md.push('');
  md.push(`- Thời điểm: ${summaryDoc.executedAt}`);
  md.push(`- Chế độ: ${summaryDoc.mode} (${summaryDoc.platformBase})`);
  md.push(`- Tổng test case: **${totals.cases}** — Passed **${totals.passed}**, Failed **${totals.failed}** (known defects: ${totals.knownDefects}), Unexpected: **${totals.unexpectedFailures}**`);
  md.push(`- Assertion: ${totals.assertions} (failed: ${totals.failedAssertions}) — Requests: ${totals.requests} — Thời gian: ${(duration / 1000).toFixed(2)}s`);
  md.push('');
  md.push('| Nhóm | Tổng | Passed | Failed |');
  md.push('| --- | ---: | ---: | ---: |');
  for (const [name, group] of Object.entries(groups)) {
    md.push(`| ${name} | ${group.cases} | ${group.passed} | ${group.failed} |`);
  }
  md.push('');
  md.push('| Test case | HTTP | Kết quả | Ghi chú |');
  md.push('| --- | ---: | --- | --- |');
  for (const testCase of cases) {
    const status = testCase.passed ? 'Passed' : testCase.expectedDefect ? 'Failed (known defect)' : 'Failed';
    const note = testCase.failures.length ? testCase.failures.join('<br>').replace(/\|/g, '\\|') : '';
    md.push(`| ${testCase.id} | ${testCase.httpStatus ?? '-'} | ${status} | ${note} |`);
  }
  fs.writeFileSync(SUMMARY_MD, md.join('\n'));

  const historyDir = path.join(RESULTS_DIR, 'history', summaryDoc.runId ?? 'unknown');
  fs.mkdirSync(historyDir, { recursive: true });
  for (const file of [NEWMAN_JSON, NEWMAN_HTML, SUMMARY_JSON, SUMMARY_MD]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(historyDir, path.basename(file)));
  }

  console.log('\n================ KẾT QUẢ ================');
  console.log(`Test case : ${totals.cases}`);
  console.log(`Passed    : ${totals.passed}`);
  console.log(`Failed    : ${totals.failed} (known defects: ${totals.knownDefects}, unexpected: ${totals.unexpectedFailures})`);
  console.log(`Assertion : ${totals.assertions} (failed: ${totals.failedAssertions})`);
  console.log(`Thời gian : ${(duration / 1000).toFixed(2)}s`);
  console.log('-----------------------------------------');
  for (const [name, group] of Object.entries(groups)) {
    console.log(`${name.padEnd(28)} ${String(group.cases).padStart(3)} case  pass ${String(group.passed).padStart(3)}  fail ${group.failed}`);
  }
  console.log('-----------------------------------------');
  const failed = cases.filter((c) => !c.passed);
  if (failed.length) {
    console.log('Các case không đạt:');
    for (const testCase of failed) {
      console.log(`- ${testCase.id} (${testCase.expectedDefect ? 'known defect' : 'UNEXPECTED'}) HTTP ${testCase.httpStatus}`);
      for (const failure of testCase.failures) console.log(`    ${failure}`);
    }
  }
  console.log(`\nJSON : ${SUMMARY_JSON}`);
  console.log(`MD   : ${SUMMARY_MD}`);
  if (!noHtml) console.log(`HTML : ${NEWMAN_HTML}`);

  if (strict && totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[run] FAILED:', error.message);
  console.error(error.stack);
  process.exitCode = 2;
});
