import { qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';

/** Names of the per-tenant counters in `code_sequence` */
export const SEQUENCE = {
  CUSTOMER: { name: 'customer', prefix: 'KH' },
  MEMBER: { name: 'member', prefix: 'TV' },
} as const;

/**
 * The next readable code of a tenant (`KH000218`), from a counter row that the
 * statement locks until the caller's transaction ends; a rollback gives the number back.
 */
export async function nextCode(
  em: EntityManager,
  tenantId: string,
  sequence: { name: string; prefix: string },
): Promise<string> {
  const table = qualifiedTable(em.connection, 'code_sequence');
  const rows: { value: string }[] = await em.query(
    `INSERT INTO ${table} ("tenant_id", "key", "value") VALUES ($1, $2, 1)
     ON CONFLICT ("tenant_id", "key") DO UPDATE SET "value" = ${table}."value" + 1
     RETURNING "value"`,
    [tenantId, sequence.name],
  );
  return `${sequence.prefix}${String(rows[0].value).padStart(6, '0')}`;
}
