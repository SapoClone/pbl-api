// node:test suite for check-lib-version.mjs and build-libs.mjs (fixtures in a temp dir).
//   node --test "scripts/*.test.mjs"
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { rewriteAliases } from './build-libs.mjs';
import { changelogHasVersion, checkPrLib, checkTag, exportNames, parseTag } from './check-lib-version.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'libver-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
function lib({ version = '1.0.0', index = '', files = {}, changelog }) {
  const dir = join(tmp, `lib${n++}`);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  writeFileSync(join(dir, 'src', 'index.ts'), index);
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, 'src', f), c);
  if (changelog !== undefined) writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

describe('parseTag', () => {
  it('accepts both libs', () => {
    assert.deepEqual(parseTag('pbl-auth-v1.2.3'), { pkg: 'pbl-auth', lib: 'auth', version: '1.2.3' });
    assert.equal(parseTag('pbl-common-v2.0.0-rc.1').version, '2.0.0-rc.1');
  });
  it('rejects others', () => {
    for (const t of ['v1.0.0', 'pbl-auth-1.0.0', 'pbl-other-v1.0.0', 'pbl-auth-v1.0', '', undefined])
      assert.equal(parseTag(t), null, String(t));
  });
});

describe('changelogHasVersion', () => {
  it('finds bracketed and bare headings, not substrings', () => {
    assert.ok(changelogHasVersion('# Changelog\n\n## [1.0.0] - 2026-10-11\n', '1.0.0'));
    assert.ok(changelogHasVersion('## 1.2.0\n', '1.2.0'));
    assert.ok(!changelogHasVersion('## [1.2.0]\n', '1.0.0'));
    assert.ok(!changelogHasVersion('## [11.0.0]\n', '1.0.0'));
    assert.ok(!changelogHasVersion('mentions 1.0.0 in prose\n', '1.0.0'));
  });
});

describe('checkTag', () => {
  it('passes when tag, manifest and changelog agree', () => {
    assert.deepEqual(checkTag('pbl-auth-v1.0.0', lib({ changelog: '## [1.0.0]\n' })), []);
  });
  it('fails on version mismatch', () => {
    const p = checkTag('pbl-auth-v1.1.0', lib({ changelog: '## [1.1.0]\n' }));
    assert.equal(p.length, 1);
    assert.match(p[0], /!= package\.json version/);
  });
  it('fails on missing changelog section or file', () => {
    assert.match(checkTag('pbl-auth-v1.0.0', lib({ changelog: '## [0.9.0]\n' }))[0], /no "## 1\.0\.0"/);
    assert.match(checkTag('pbl-auth-v1.0.0', lib({}))[0], /missing/);
  });
  it('fails on a malformed tag', () => {
    assert.match(checkTag('latest', lib({ changelog: '## 1.0.0' }))[0], /does not match/);
  });
});

describe('exportNames', () => {
  it('follows export * and named re-exports, types and values', () => {
    const dir = lib({
      index: "export * from './a';\nexport { b } from './b';\n",
      files: {
        'a.ts': 'export const A = 1;\nexport interface IA {}\n',
        'b.ts': 'export function b() {}\nexport const hidden = 1;\n',
      },
    });
    assert.deepEqual(exportNames(dir), ['A', 'IA', 'b']);
  });
});

describe('checkPrLib (major rule)', () => {
  const base = () =>
    lib({ version: '1.2.0', index: "export * from './a';", files: { 'a.ts': 'export const A = 1;\nexport const B = 2;\n' } });
  const head = (version, a) => lib({ version, index: "export * from './a';", files: { 'a.ts': a } });

  it('new library: no check', () => assert.deepEqual(checkPrLib('x', head('1.0.0', ''), null), []));
  it('additions need no major', () =>
    assert.deepEqual(checkPrLib('x', head('1.2.0', 'export const A = 1;\nexport const B = 2;\nexport const C = 3;\n'), base()), []));
  it('removal without a major bump fails', () => {
    const p = checkPrLib('x', head('1.3.0', 'export const A = 1;\n'), base());
    assert.equal(p.length, 1);
    assert.match(p[0], /\[B\]/);
  });
  it('rename without a major bump fails', () => {
    const p = checkPrLib('x', head('1.2.1', 'export const A = 1;\nexport const B2 = 2;\n'), base());
    assert.match(p[0], /\[B\]/);
  });
  it('removal with a major bump passes', () =>
    assert.deepEqual(checkPrLib('x', head('2.0.0', 'export const A = 1;\n'), base()), []));
  it('a lower major also fails', () =>
    assert.equal(checkPrLib('x', head('0.9.0', 'export const A = 1;\n'), base()).length, 1));
});

describe('rewriteAliases (build step)', () => {
  it('rewrites require and import specifiers, leaves others', () => {
    const out = rewriteAliases(
      'const c = require("@pbl/common");\nimport { X } from \'@pbl/common\';\nrequire("@pbl/common-extra");\nrequire("@nestjs/common");',
    );
    assert.match(out, /require\("@sapoclone\/pbl-common"\)/);
    assert.match(out, /from '@sapoclone\/pbl-common'/);
    assert.match(out, /require\("@pbl\/common-extra"\)/);
    assert.match(out, /require\("@nestjs\/common"\)/);
  });
});
