#!/usr/bin/env node
// Generates a new service app from templates/service and registers it everywhere
// a service must be registered. Plain Node, no dependencies.
//   node scripts/new-service.mjs <name> [--port <host port>] [--dry-run]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => {
  console.error(`new-service: ${msg}`);
  process.exit(1);
};

// ---- args
const args = process.argv.slice(2);
let name;
let port;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--port') port = args[++i];
  else if (args[i].startsWith('--')) die(`unknown option ${args[i]}`);
  else if (name === undefined) name = args[i];
  else die(`unexpected argument ${args[i]}`);
}
if (!name) die('usage: node scripts/new-service.mjs <name> [--port <host port>] [--dry-run]');
if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) die(`invalid name "${name}" (must match ^[a-z][a-z0-9-]{1,30}$)`);
if (port !== undefined && !(/^\d+$/.test(port) && +port >= 1 && +port <= 65535)) die(`invalid --port "${port}"`);
if (existsSync(join(root, 'apps', name))) die(`apps/${name} already exists`);

const Name = name
  .split('-')
  .map((p) => p[0].toUpperCase() + p.slice(1))
  .join('');
const fill = (s) => s.replaceAll('__name__', name).replaceAll('__Name__', Name);

// ---- file helpers: edit on LF text, restore the file's own line endings
const edits = new Map(); // path -> { eol, text }
function load(rel) {
  if (!edits.has(rel)) {
    const raw = readFileSync(join(root, rel), 'utf8');
    edits.set(rel, { eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') });
  }
  return edits.get(rel);
}
function anchored(rel, what, fn) {
  const f = load(rel);
  const next = fn(f.text);
  if (next === null || next === f.text) die(`${rel}: anchor not found for ${what}`);
  f.text = next;
  console.log(`  edit ${rel}: ${what}`);
}
function editJson(rel, what, fn) {
  const f = load(rel);
  const data = JSON.parse(f.text);
  fn(data);
  f.text = JSON.stringify(data, null, 2) + '\n';
  console.log(`  edit ${rel}: ${what}`);
}
// rebuild an object inserting entries after the last key satisfying `after`
function insertAfter(obj, after, entries) {
  const keys = Object.keys(obj);
  let idx = -1;
  keys.forEach((k, i) => after(k, obj[k]) && (idx = i));
  if (idx < 0) die('insertion anchor not found in JSON object');
  const out = {};
  keys.forEach((k, i) => {
    out[k] = obj[k];
    if (i === idx) Object.assign(out, entries);
  });
  return out;
}

// ---- plan: new files
const tplDir = join(root, 'templates', 'service');
const newFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else newFiles.push({ rel: relative(tplDir, p).replace(/\\/g, '/'), src: p });
  }
})(tplDir);
console.log(`Creating apps/${name}${dryRun ? ' (dry run)' : ''}:`);
const toWrite = newFiles.map((f) => ({
  path: join('apps', name, f.rel.replace(/\.tpl$/, '')),
  content: fill(readFileSync(f.src, 'utf8').replace(/\r\n/g, '\n')),
}));
toWrite.forEach((f) => console.log(`  create ${f.path.replace(/\\/g, '/')}`));

// ---- plan: registrations
console.log('Registering:');
editJson('nest-cli.json', 'projects entry', (d) => {
  if (d.projects[name]) die(`nest-cli.json already has project ${name}`);
  d.projects = insertAfter(d.projects, (k, v) => v.type === 'application', {
    [name]: {
      type: 'application',
      root: `apps/${name}`,
      entryFile: `apps/${name}/src/main`,
      sourceRoot: `apps/${name}/src`,
      compilerOptions: { tsConfigPath: `apps/${name}/tsconfig.app.json` },
    },
  });
});

editJson('package.json', 'start:dev/build/test scripts', (d) => {
  if (d.scripts[`start:dev:${name}`]) die(`package.json already has scripts for ${name}`);
  d.scripts = insertAfter(d.scripts, (k, v) => /^test:[a-z0-9-]+$/.test(k) && /^jest apps\//.test(v), {
    [`start:dev:${name}`]: `nest start ${name} --watch`,
    [`build:${name}`]: `nest build ${name}`,
    [`test:${name}`]: `jest apps/${name}/src`,
  });
});

anchored('docker-compose.yml', 'service block', (t) => {
  const m = t.match(/^ {2}catalog:\n(?: {4}.*\n|\n(?= {4}))*/m);
  if (!m || !t.includes('\n  postgres:\n')) return null;
  let block = m[0].replaceAll('catalog', name);
  if (port) block = block.replace(/\n( {4}networks:)/, `\n    ports:\n      - "${port}:3000"\n$1`);
  return t.replace('\n  postgres:\n', `\n${block}\n  postgres:\n`);
});
anchored('docker-compose.yml', 'krakend depends_on', (t) => {
  const m = t.match(/( {2}krakend:\n[\s\S]*? {4}depends_on:\n(?: {6}- .*\n)+)/);
  return m ? t.replace(m[1], `${m[1]}      - ${name}\n`) : null;
});

editJson('krakend/krakend.json', '/health route + circuit breaker', (d) => {
  const tpl = d.endpoints.find((e) => e.endpoint === '/catalog/health');
  if (!tpl) die('krakend/krakend.json: /catalog/health route not found');
  if (d.endpoints.some((e) => e.endpoint === `/${name}/health`)) die(`krakend route /${name}/health exists`);
  const clone = JSON.parse(JSON.stringify(tpl).replaceAll('catalog', name));
  let idx = -1;
  d.endpoints.forEach((e, i) => /^\/[a-z0-9-]+\/health$/.test(e.endpoint) && (idx = i));
  d.endpoints.splice(idx + 1, 0, clone);
});

anchored('.github/workflows/ci.yml', 'service matrix', (t) =>
  /service: \[[^\]]*, libs\]/.test(t) ? t.replace(/(service: \[[^\]]*), libs\]/, `$1, ${name}, libs]`) : null,
);

anchored('docker/postgres-init-schemas.sql', 'schema', (t) => {
  const lines = t.split('\n');
  let last = -1;
  lines.forEach((l, i) => /^CREATE SCHEMA IF NOT EXISTS \w+;$/.test(l) && (last = i));
  if (last < 0) return null;
  lines.splice(last + 1, 0, `CREATE SCHEMA IF NOT EXISTS ${name.replace(/-/g, '_')};`);
  return lines.join('\n');
});

anchored('scripts/verify-local-stack.sh', 'services list', (t) =>
  /^services=\(([^)]*)\)$/m.test(t) ? t.replace(/^services=\(([^)]*)\)$/m, `services=($1 ${name})`) : null,
);

if (dryRun) {
  console.log('\nDry run: nothing written.');
  process.exit(0);
}

// ---- write
for (const f of toWrite) {
  const abs = join(root, f.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, f.content);
}
for (const [rel, f] of edits) {
  writeFileSync(join(root, rel), f.eol === '\r\n' ? f.text.replace(/\n/g, '\r\n') : f.text);
}

console.log(`
Service "${name}" created. Next steps:
  1. pnpm exec tsc -p apps/${name}/tsconfig.app.json --noEmit
  2. pnpm test:${name} -- --maxWorkers=2
  3. docker compose up -d --build ${name} krakend
  4. curl http://localhost:8080/${name}/health    (expect {"status":"ok","service":"${name}"})
Then add your modules to apps/${name}/src/app.module.ts. See docs/guides/new-service.md.
Not automated: docs/diagram mentions, per-service migrations, README/CLAUDE.md layout text.`);
