import { EntityManager } from 'typeorm';
import { TenantEntity } from './entities/tenant.entity';

export const TENANT_CODE_PREFIX = 'TN';

export const formatTenantCode = (n: number): string =>
  `${TENANT_CODE_PREFIX}${String(n).padStart(4, '0')}`;

/**
 * Next platform-wide store code (TN0001, TN0002, ...). Call it inside the transaction that inserts the store: an
 * advisory lock makes two concurrent creations queue up instead of both reading the same maximum. The maximum
 * counts deleted stores too, so a code is never reused.
 */
export async function nextTenantCode(em: EntityManager): Promise<string> {
  await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tenant-code']);
  // tablePath carries the connection's schema: the service sets a schema in the TypeORM options, not a
  // search_path, so a bare table name in raw SQL would not be found (see member-code.ts).
  const table = em
    .getRepository(TenantEntity)
    .metadata.tablePath.split('.')
    .map((part) => `"${part}"`)
    .join('.');
  const [row] = (await em.query(
    `SELECT COALESCE(MAX(substring("code" from '[0-9]+$')::int), 0) + 1 AS next FROM ${table}`,
  )) as { next: number }[];
  return formatTenantCode(Number(row.next));
}
