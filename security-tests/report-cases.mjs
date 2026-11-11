import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const newman = JSON.parse(fs.readFileSync(path.join(RESULTS, 'newman.json'), 'utf8')).run;

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

function expectedOf(execution) {
  const statusAssertion = (execution.assertions ?? []).find((a) => /^HTTP \d{3}$/.test(a.assertion));
  if (statusAssertion) return statusAssertion.assertion.replace('HTTP ', '');
  const arrow = execution.item.name.match(/→\s*(\d{3})/);
  return arrow ? arrow[1] : '-';
}

function pathOf(url) {
  if (!url) return '';
  if (typeof url === 'string') {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? '';
  const path = Array.isArray(url.path) ? url.path.join('/') : url.path ?? '';
  const query = Array.isArray(url.query) && url.query.length
    ? `?${url.query.map((q) => `${q.key}=${q.value}`).join('&')}`
    : '';
  return `/${path}${query}`;
}

function bodyOf(execution) {
  const raw = execution.request?.body?.raw;
  if (!raw) return '—';
  try {
    const parsed = JSON.parse(raw);
    if (parsed.password) parsed.password = '••••••';
    const text = JSON.stringify(parsed);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  } catch {
    return raw.slice(0, 90);
  }
}

const groups = new Map();
for (const execution of newman.executions) {
  const group = groupOf(execution.item.name);
  if (!groups.has(group)) groups.set(group, []);
  const failures = (execution.assertions ?? []).filter((a) => a.error);
  groups.get(group).push({
    id: idOf(execution.item.name),
    name: execution.item.name.replace(/^TC-SEC-[A-Z]+-\d+ — /, ''),
    method: execution.request?.method ?? '',
    path: pathOf(execution.request?.url ?? ''),
    body: bodyOf(execution),
    expected: expectedOf(execution),
    actual: execution.response?.code ?? '-',
    status: failures.length === 0 ? 'Passed' : 'Failed',
    failures: failures.map((f) => f.assertion),
  });
}

const out = [];
out.push('### Bảng chi tiết test case (sinh từ newman.json — không chứa token)');
out.push('');
for (const [group, rows] of groups) {
  out.push(`#### ${group}`);
  out.push('');
  out.push('| ID | Mô tả | Thao tác | Dữ liệu chính | Mong đợi | Thực tế | Kết quả |');
  out.push('| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const row of rows) {
    out.push(
      `| ${row.id} | ${row.name.replace(/\|/g, '\\|')} | ${row.method} ${row.path} | ${row.body.replace(/\|/g, '\\|')} | ${row.expected} | ${row.actual} | ${row.status} |`,
    );
  }
  out.push('');
}
fs.writeFileSync(path.join(RESULTS, 'cases-table.md'), out.join('\n'));
console.log(`rows=${newman.executions.length} -> ${path.join(RESULTS, 'cases-table.md')}`);
