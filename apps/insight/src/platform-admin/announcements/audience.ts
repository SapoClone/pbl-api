/** Who an announcement goes to; `plan`, `integration_provider` and `tenants` carry their list */
export type Audience =
  | { type: 'all' }
  | { type: 'plan'; planCodes: string[] }
  | { type: 'integration_provider'; providers: string[] }
  | { type: 'tenants'; tenantIds: string[] };

export const AUDIENCE_TYPES = [
  'all',
  'plan',
  'integration_provider',
  'tenants',
] as const;
export const PROVIDERS = ['shopee', 'lazada'] as const;
const MAX_LIST = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isList = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0 && value.length <= MAX_LIST;

/** The reason a value is not an audience, or null when it is one */
export function audienceProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'audience must be an object';
  }
  const a = value as Record<string, unknown>;
  switch (a.type) {
    case 'all':
      return null;
    case 'plan':
      return isList(a.planCodes) &&
        a.planCodes.every(
          (c) => typeof c === 'string' && c.trim() !== '' && c.length <= 50,
        )
        ? null
        : `planCodes must be 1 to ${MAX_LIST} plan codes`;
    case 'integration_provider':
      return isList(a.providers) &&
        a.providers.every((p) => (PROVIDERS as readonly unknown[]).includes(p))
        ? null
        : `providers must be a non-empty list of ${PROVIDERS.join(', ')}`;
    case 'tenants':
      return isList(a.tenantIds) &&
        a.tenantIds.every((id) => typeof id === 'string' && UUID.test(id))
        ? null
        : `tenantIds must be 1 to ${MAX_LIST} store ids`;
    default:
      return `audience.type must be one of ${AUDIENCE_TYPES.join(', ')}`;
  }
}

/** A valid audience reduced to its own fields, without duplicates */
export function normalizeAudience(value: Audience): Audience {
  const unique = <T>(list: T[]) => [...new Set(list)];
  switch (value.type) {
    case 'plan':
      return {
        type: 'plan',
        planCodes: unique(value.planCodes.map((c) => c.trim())),
      };
    case 'integration_provider':
      return {
        type: 'integration_provider',
        providers: unique(value.providers),
      };
    case 'tenants':
      return {
        type: 'tenants',
        tenantIds: unique(value.tenantIds.map((id) => id.toLowerCase())),
      };
    default:
      return { type: 'all' };
  }
}

/**
 * The WHERE clause (on `tenant_projection` aliased `t`) that selects the stores of an audience, with its parameters
 * numbered from `$1`. Suspended stores never receive anything. Stores on an expired paid plan do.
 */
export function audienceFilter(audience: Audience): {
  where: string;
  params: unknown[];
} {
  const live = `t."status" <> 'suspended'`;
  switch (audience.type) {
    case 'plan':
      return {
        where: `${live} AND t."plan_code" = ANY($1::text[])`,
        params: [audience.planCodes],
      };
    case 'integration_provider':
      return {
        where: `${live} AND EXISTS (SELECT 1 FROM jsonb_each(t."connections") c
                 WHERE (c.value->>'connected')::boolean AND c.value->>'provider' = ANY($1::text[]))`,
        params: [audience.providers],
      };
    case 'tenants':
      return {
        where: `${live} AND t."tenant_id" = ANY($1::uuid[])`,
        params: [audience.tenantIds],
      };
    default:
      return { where: live, params: [] };
  }
}
