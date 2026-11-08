import type { OpenAPIObject } from '@nestjs/swagger';

/** Gateway-facing base URL of the merged document (krakend `port`). */
export const GATEWAY_URL = 'http://localhost:8080';
export const BEARER_SCHEME = 'bearerAuth';

type Json = Record<string, any>;
const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

/** Health probes are served by every service and listed in krakend; they are not part of the API reference. */
export function isHealthPath(path: string): boolean {
  return ['/health', '/health/live', '/health/ready'].includes(path);
}

/** Service-to-service routes behind no gateway entry. */
export function isInternalPath(path: string): boolean {
  return path === '/internal' || path.includes('/internal/');
}

/** `/a/{x}/b` and `/a/{y}/b` are the same route. */
export function normalizePath(path: string): string {
  const withoutTrailing = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return withoutTrailing.replace(/\{[^}]+\}/g, '{}');
}

export function gatewayPath(service: string, servicePath: string): string {
  return `/${service}${servicePath === '/' ? '' : servicePath}`;
}

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function refsOf(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => refsOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = /^#\/components\/schemas\/(.+)$/.exec(v);
        if (m) out.add(m[1]);
      } else refsOf(v, out);
    }
  }
  return out;
}

function rewriteRefs(value: any, rename: (name: string) => string): any {
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, rename));
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') {
        out[k] = v.replace(
          /^#\/components\/schemas\/(.+)$/,
          (_m, name: string) => `#/components/schemas/${rename(name)}`,
        );
      } else out[k] = rewriteRefs(v, rename);
    }
    return out;
  }
  return value;
}

/**
 * Names that can be shared across services: defined identically (after the
 * same rule is applied to what they reference) everywhere they appear.
 */
function sharedSchemaNames(docs: Record<string, OpenAPIObject>): Set<string> {
  const defs = new Map<string, Map<string, Json>>();
  for (const [svc, doc] of Object.entries(docs)) {
    for (const [name, schema] of Object.entries(
      doc.components?.schemas ?? {},
    )) {
      if (!defs.has(name)) defs.set(name, new Map());
      defs.get(name)!.set(svc, schema as Json);
    }
  }
  const shared = new Set<string>();
  for (const [name, bySvc] of defs) {
    const variants = new Set([...bySvc.values()].map((s) => JSON.stringify(s)));
    if (bySvc.size > 1 && variants.size === 1) shared.add(name);
  }
  // a shared schema may only reference shared schemas: a referenced schema that
  // differs per service is renamed per service, so the referrer would be wrong
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...shared]) {
      const sample = [...defs.get(name)!.values()][0];
      for (const ref of refsOf(sample)) {
        if (!shared.has(ref)) {
          shared.delete(name);
          changed = true;
          break;
        }
      }
    }
  }
  return shared;
}

/** `get /sales/api/v1/orders/{}`: the key a gateway route is compared by. */
export function routeKey(method: string, gatewayPathValue: string): string {
  return `${method.toLowerCase()} ${normalizePath(gatewayPathValue)}`;
}

export interface UnexposedRoute {
  service: string;
  method: string;
  path: string;
  /** true when the same route is exposed under `/api` + path (a deliberate alias) */
  alias: boolean;
}

export interface MergeInput {
  /** service name -> its own document, in display order */
  documents: Record<string, OpenAPIObject>;
  /** `routeKey`s the gateway exposes (from krakend.json); other routes stay out of the merged document */
  exposed: Set<string>;
  info?: { title?: string; description?: string; version?: string };
}

/**
 * Merges the per-service documents into one whose paths are the gateway's
 * (`/<service>` + service path), tags prefixed per service, one `bearerAuth`
 * scheme, schema names unique (service-prefixed on a clash), gateway server.
 * Internal and health routes are dropped.
 */
export function mergeDocuments(input: MergeInput): {
  document: OpenAPIObject;
  unexposed: UnexposedRoute[];
} {
  const { documents } = input;
  const shared = sharedSchemaNames(documents);
  const paths: Json = {};
  const schemas: Json = {};
  const tags: { name: string; description?: string }[] = [];
  const otherSchemes: Json = {};
  const seenTags = new Set<string>();
  const unexposed: UnexposedRoute[] = [];

  for (const [service, doc] of Object.entries(documents)) {
    const own = new Set(Object.keys(doc.components?.schemas ?? {}));
    const counts = (name: string) =>
      Object.values(documents).filter(
        (d) => name in (d.components?.schemas ?? {}),
      ).length;
    const rename = (name: string) =>
      !own.has(name) || shared.has(name) || counts(name) === 1
        ? name
        : `${pascal(service)}${name}`;

    for (const [name, schema] of Object.entries(
      doc.components?.schemas ?? {},
    )) {
      schemas[rename(name)] = rewriteRefs(schema, rename);
    }
    for (const [name, scheme] of Object.entries(
      doc.components?.securitySchemes ?? {},
    )) {
      if (name !== 'bearer') otherSchemes[name] = scheme;
    }

    const tagPrefix = (t: string) => `${service} / ${t}`;
    for (const tag of doc.tags ?? []) {
      const name = tagPrefix(tag.name);
      if (!seenTags.has(name)) {
        seenTags.add(name);
        tags.push({ ...tag, name });
      }
    }

    for (const [servicePath, item] of Object.entries(doc.paths)) {
      if (isHealthPath(servicePath) || isInternalPath(servicePath)) continue;
      const target = gatewayPath(service, servicePath);
      for (const method of HTTP_METHODS) {
        const op = (item as Json)[method];
        if (!op) continue;
        if (!input.exposed.has(routeKey(method, target))) {
          unexposed.push({
            service,
            method,
            path: servicePath,
            alias: input.exposed.has(
              routeKey(method, gatewayPath(service, `/api${servicePath}`)),
            ),
          });
          continue;
        }
        const out: Json = (paths[target] ??= {});
        const merged = rewriteRefs(op, rename) as Json;
        merged.tags = (merged.tags ?? []).map(tagPrefix);
        for (const t of merged.tags as string[]) {
          if (!seenTags.has(t)) {
            seenTags.add(t);
            tags.push({ name: t });
          }
        }
        if (merged.operationId)
          merged.operationId = `${service}_${merged.operationId}`;
        if (merged.security) {
          merged.security = (merged.security as Json[]).map((req) =>
            Object.fromEntries(
              Object.entries(req).map(([k, v]) => [
                k === 'bearer' ? BEARER_SCHEME : k,
                v,
              ]),
            ),
          );
        }
        out[method] = merged;
      }
    }
  }

  const document = {
    openapi: '3.0.0',
    info: {
      title: input.info?.title ?? 'SapoClone API (gateway)',
      description:
        input.info?.description ??
        'Every client-facing route, as served by the KrakenD gateway: /<service> + the service path. Generated from the controllers; see docs/guides/openapi.md.',
      version: input.info?.version ?? '1.0',
    },
    servers: [{ url: GATEWAY_URL, description: 'KrakenD API gateway' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        [BEARER_SCHEME]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        ...otherSchemes,
      },
      schemas,
    },
  } as OpenAPIObject;
  return { document, unexposed };
}
