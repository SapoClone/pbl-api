#!/usr/bin/env node
// Release guard for the shared libraries (libs/auth, libs/common). Plain Node ESM.
//
//   node scripts/check-lib-version.mjs --tag <pbl-auth-v1.2.3>   publish check (tag == package.json, CHANGELOG has the version)
//   node scripts/check-lib-version.mjs --pr [--base origin/main]  PR check (removed/renamed export => major bump)
//
// --tag defaults to $GITHUB_REF_NAME. --pr compares each lib's src/index.ts export
// names (TypeScript compiler API) with the base ref; a lib absent on the base is new.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIBS = { 'pbl-auth': 'auth', 'pbl-common': 'common' };
const BAD_TAG = (tag) => `tag "${tag}" does not match pbl-auth-vX.Y.Z or pbl-common-vX.Y.Z`;

export function parseTag(tag) {
  const m = /^(pbl-auth|pbl-common)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? '');
  return m ? { pkg: m[1], lib: LIBS[m[1]], version: m[2] } : null;
}

export function changelogHasVersion(text, version) {
  const esc = version.replace(/[.+]/g, '\\$&');
  return new RegExp(`^##\\s+\\[?v?${esc}\\]?(\\s|$)`, 'm').test(text);
}

/** Problems with publishing `tag` from the lib folder at `libDir` ([] when fine). */
export function checkTag(tag, libDir) {
  const parsed = parseTag(tag);
  if (!parsed) return [BAD_TAG(tag)];
  const problems = [];
  const manifest = JSON.parse(readFileSync(join(libDir, 'package.json'), 'utf8'));
  if (manifest.version !== parsed.version)
    problems.push(`tag version ${parsed.version} != package.json version ${manifest.version} in ${libDir}`);
  const clPath = join(libDir, 'CHANGELOG.md');
  if (!existsSync(clPath)) problems.push(`${clPath} is missing`);
  else if (!changelogHasVersion(readFileSync(clPath, 'utf8'), parsed.version))
    problems.push(`CHANGELOG.md has no "## ${parsed.version}" section`);
  return problems;
}

/** Sorted names exported by <libDir>/src/index.ts (follows `export *`). */
export function exportNames(libDir) {
  const entry = join(libDir, 'src', 'index.ts');
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    experimentalDecorators: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  if (!sf) throw new Error(`cannot read ${entry}`);
  const sym = checker.getSymbolAtLocation(sf);
  return (sym ? checker.getExportsOfModule(sym) : []).map((s) => s.getName()).sort();
}

const major = (v) => Number(String(v).split('.')[0]);

/**
 * Problems for one lib given its base (main) folder; baseDir is null only when
 * the lib's src/index.ts does not exist on base (new library). A base without a
 * package.json counts as version 0.0.0, so the export comparison always runs.
 */
export function checkPrLib(name, headDir, baseDir) {
  if (!baseDir) return [];
  const head = JSON.parse(readFileSync(join(headDir, 'package.json'), 'utf8'));
  const basePkg = join(baseDir, 'package.json');
  const baseVersion = existsSync(basePkg) ? JSON.parse(readFileSync(basePkg, 'utf8')).version : '0.0.0';
  const headNames = new Set(exportNames(headDir));
  const removed = exportNames(baseDir).filter((n) => !headNames.has(n));
  if (removed.length && major(head.version) <= major(baseVersion))
    return [
      `${name}: removed or renamed export(s) [${removed.join(', ')}] is a breaking change; ` +
        `major must be greater than ${baseVersion} (package.json has ${head.version})`,
    ];
  return [];
}

const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** Fails (throws) unless `ref` resolves to a commit: a typo'd --base must not pass silently. */
export function verifyRef(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new Error(`base ref "${ref}" does not resolve to a commit (shallow clone? run git fetch origin main)`);
  }
}

/** Extracts libs/<lib> of `ref` into `into`; null when libs/<lib>/src/index.ts is absent on ref. Other errors throw. */
function materializeBase(ref, lib, into) {
  const present = git(['ls-tree', '--name-only', ref, `libs/${lib}/src/index.ts`]).toString().trim();
  if (!present) return null;
  const tar = git(['-c', 'core.autocrlf=false', 'archive', ref, `libs/${lib}`]);
  execFileSync('tar', ['-x', '-C', into], { input: tar });
  return join(into, 'libs', lib);
}

function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const problems = [];
  if (argv.includes('--pr')) {
    const base = opt('--base') ?? 'origin/main';
    verifyRef(base);
    const tmp = mkdtempSync(join(tmpdir(), 'libver-'));
    try {
      for (const lib of Object.values(LIBS)) {
        const baseDir = materializeBase(base, lib, tmp);
        if (!baseDir) console.log(`${lib}: libs/${lib}/src/index.ts not on ${base} (new library, no major check)`);
        problems.push(...checkPrLib(lib, join(root, 'libs', lib), baseDir));
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    const tag = opt('--tag') ?? process.env.GITHUB_REF_NAME;
    const parsed = parseTag(tag);
    problems.push(...(parsed ? checkTag(tag, join(root, 'libs', parsed.lib)) : [BAD_TAG(tag)]));
  }
  if (problems.length) {
    for (const p of problems) console.error(`check-lib-version: ${p}`);
    process.exit(1);
  }
  console.log('check-lib-version: ok');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
