import { EntityManager } from 'typeorm';
import { AccountTenantEntity } from './entities/account-tenant.entity';

export const MEMBER_CODE_PREFIX = 'NV';

export const formatMemberCode = (n: number): string =>
  `${MEMBER_CODE_PREFIX}${String(n).padStart(3, '0')}`;

/**
 * Next NV-code of a store (NV001, NV002, ...). Call it inside the transaction
 * that inserts the member: a per-store advisory lock makes two concurrent
 * additions queue up instead of both reading the same maximum. Codes of
 * removed members are not reused only because the maximum keeps counting up.
 */
export async function nextMemberCode(
  em: EntityManager,
  tenantId: string,
): Promise<string> {
  await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `member-code:${tenantId}`,
  ]);
  // tablePath carries the connection's schema ("platform.account_tenant"): the
  // service sets a schema in the TypeORM options, not a search_path, so a bare
  // table name in raw SQL would not be found.
  const table = em
    .getRepository(AccountTenantEntity)
    .metadata.tablePath.split('.')
    .map((part) => `"${part}"`)
    .join('.');
  const [row] = (await em.query(
    `SELECT COALESCE(MAX(substring("code" from '[0-9]+$')::int), 0) + 1 AS next
     FROM ${table} WHERE "tenant_id" = $1`,
    [tenantId],
  )) as { next: number }[];
  return formatMemberCode(Number(row.next));
}
