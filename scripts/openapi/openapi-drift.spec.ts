/**
 * Drift guard for the API reference (docs/guides/openapi.md). Runs the real generator
 * (`scripts/generate-openapi.ts`, in a child process: it needs ts-node with the Nest
 * Swagger plugin, and the apps' `@/` imports, which this jest config does not map; no
 * database, no queue) and checks the merged document against krakend/krakend.json and
 * the auth metadata:
 *
 *  - every client-facing krakend route exists in the OpenAPI, and the reverse
 *  - every operation has a summary and a tag
 *  - every protected operation lists the bearer scheme, every public one does not
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RouteAccess } from './create-documents';
import { loadKrakendRoutes } from './krakend';
import {
  BEARER_SCHEME,
  normalizePath,
  routeKey,
  type UnexposedRoute,
} from './merge';

type OpenAPIObject = { paths: Record<string, any>; components: any };

/**
 * Controller routes that no gateway entry exposes and that are not `/api` aliases.
 * Each needs a reason; the test fails when an entry is no longer needed, so the
 * list cannot go stale.
 */
const KNOWN_UNEXPOSED: Record<string, string> = {
  'finance post /v1/finance/settlements/webhooks/provider-callback':
    'Provider callback that needs a user bearer token and has no signature check, so no PSP can call it; there is no gateway route for it yet (docs/specs/2026-10-31-reconciliation/finance-integration.md)',
  'finance post /api/v1/finance/settlements/webhooks/provider-callback':
    'Same route under /api: not exposed by the gateway, see above',
};

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
];

function operations(doc: { paths: Record<string, any> }) {
  const out: { method: string; path: string; op: any }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op = (item as any)[method];
      if (op) out.push({ method, path, op });
    }
  }
  return out;
}

describe('OpenAPI drift guard', () => {
  let doc: OpenAPIObject;
  let meta: {
    access: Record<string, Record<string, RouteAccess>>;
    unexposed: UnexposedRoute[];
  };
  let merged: ReturnType<typeof operations>;

  beforeAll(() => {
    const repo = path.resolve(__dirname, '../..');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-'));
    try {
      execFileSync(
        process.execPath,
        [
          require.resolve('ts-node/dist/bin.js'),
          '-r',
          'tsconfig-paths/register',
          '--transpile-only',
          path.join(repo, 'scripts/generate-openapi.ts'),
          '--out',
          out,
          '--meta',
          path.join(out, 'meta.json'),
        ],
        { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      const e = error as { stderr?: Buffer; message: string };
      throw new Error(
        `generate-openapi failed: ${e.stderr?.toString() ?? e.message}`,
      );
    }
    doc = JSON.parse(fs.readFileSync(path.join(out, 'openapi.json'), 'utf8'));
    meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
    fs.rmSync(out, { recursive: true, force: true });
    merged = operations(doc);
  }, 180_000);

  it('documents every client-facing krakend route', () => {
    const documented = new Set(merged.map((o) => routeKey(o.method, o.path)));
    const missing = loadKrakendRoutes()
      .filter((r) => !documented.has(routeKey(r.method, r.path)))
      .map(
        (r) =>
          `${r.method.toUpperCase()} ${r.path} is in krakend.json but no controller serves it`,
      );
    expect(missing).toEqual([]);
  });

  it('has no documented route that krakend does not expose', () => {
    const exposed = new Set(
      loadKrakendRoutes().map((r) => routeKey(r.method, r.path)),
    );
    const extra = merged
      .filter((o) => !exposed.has(routeKey(o.method, o.path)))
      .map((o) => `${o.method.toUpperCase()} ${o.path} is not in krakend.json`);
    expect(extra).toEqual([]);
  });

  it('has no controller route that krakend leaves out, apart from the known ones', () => {
    const stray = meta.unexposed
      .filter((u) => !u.alias)
      .map((u) => `${u.service} ${u.method} ${u.path}`);
    const unknown = stray.filter((key) => !(key in KNOWN_UNEXPOSED));
    expect(
      unknown.map(
        (key) =>
          `${key}: served by a controller but missing in krakend/krakend.json (add the gateway route, or make it internal)`,
      ),
    ).toEqual([]);
    const stale = Object.keys(KNOWN_UNEXPOSED).filter(
      (key) => !stray.includes(key),
    );
    expect(
      stale.map(
        (key) => `${key} is in KNOWN_UNEXPOSED but no longer unexposed`,
      ),
    ).toEqual([]);
  });

  it('gives every operation a summary and at least one tag', () => {
    const problems = merged.flatMap(({ method, path, op }) => [
      ...(op.summary?.trim()
        ? []
        : [`${method.toUpperCase()} ${path} has no summary (@ApiOperation)`]),
      ...(op.tags?.length
        ? []
        : [`${method.toUpperCase()} ${path} has no tag (@ApiTags)`]),
    ]);
    expect(problems).toEqual([]);
  });

  it('lists the bearer scheme on protected operations and on no public one', () => {
    const problems: string[] = [];
    for (const { method, path, op } of merged) {
      const service = path.split('/')[1];
      const key = String(op.operationId)
        .slice(service.length + 1)
        .replace(/\[\d+\]$/, '')
        .replace(/_v\d+$/, '');
      const access = meta.access[service]?.[key];
      const listsBearer = (op.security ?? []).some(
        (req: Record<string, unknown>) => BEARER_SCHEME in req,
      );
      const label = `${method.toUpperCase()} ${path}`;
      if (!access) problems.push(`${label}: no controller metadata for ${key}`);
      else if (access === 'protected' && !listsBearer)
        problems.push(
          `${label} needs a token but does not list ${BEARER_SCHEME} (@ApiBearerAuth)`,
        );
      else if (access === 'public' && listsBearer)
        problems.push(`${label} is @Public() but lists ${BEARER_SCHEME}`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps one bearer scheme and unique operation ids', () => {
    expect(Object.keys(doc.components.securitySchemes)).toEqual([
      BEARER_SCHEME,
    ]);
    const ids = merged.map((o) => o.op.operationId);
    expect(ids.length).toBe(new Set(ids).size);
    expect(normalizePath('/a/{x}/b/')).toBe('/a/{}/b');
  });
});
