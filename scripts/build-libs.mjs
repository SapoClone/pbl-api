#!/usr/bin/env node
// Emits the publishable shared libraries into libs/<name>/dist.
//   node scripts/build-libs.mjs
// Order matters: auth's tsconfig.lib.json resolves @pbl/common to libs/common/dist
// (declarations), so common is built first. After auth is emitted, every
// `@pbl/common` specifier in dist is rewritten to the published package name.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');

// monorepo alias -> published package name
export const ALIASES = { '@pbl/common': '@sapoclone/pbl-common', '@pbl/auth': '@sapoclone/pbl-auth' };

export function rewriteAliases(code) {
  let out = code;
  for (const [alias, published] of Object.entries(ALIASES)) {
    out = out.replace(new RegExp(`(["'])${alias}\\1`, 'g'), `$1${published}$1`);
  }
  return out;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function build(lib) {
  const dist = join(root, 'libs', lib, 'dist');
  rmSync(dist, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, 'libs', lib, 'tsconfig.lib.json')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`build-libs: tsc failed for libs/${lib}`);
    process.exit(r.status ?? 1);
  }
  let rewritten = 0;
  for (const f of walk(dist)) {
    if (!/\.(js|d\.ts)$/.test(f)) continue;
    const before = readFileSync(f, 'utf8');
    const after = rewriteAliases(before);
    if (after !== before) {
      writeFileSync(f, after);
      rewritten++;
    }
    // nothing monorepo-internal may leak into a published package
    if (/["']@pbl\//.test(after)) {
      console.error(`build-libs: unresolved @pbl/ import left in ${f}`);
      process.exit(1);
    }
  }
  console.log(`build-libs: libs/${lib}/dist emitted (${rewritten} file(s) had aliases rewritten)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const lib of ['common', 'auth']) build(lib);
}
