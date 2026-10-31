import { TenantContext } from '@pbl/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Runs `fn` in a transaction whose RLS tenant is the request's tenant (the
 * `app.tenant_id` setting every M3 module sets before touching a table).
 * Queries inside still carry `tenant_id` explicitly.
 */
export async function inTenantTx<T>(
  dataSource: DataSource,
  fn: (em: EntityManager, tenantId: string) => Promise<T>,
): Promise<T> {
  const tenantId = TenantContext.require();
  return dataSource.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return fn(em, tenantId);
  });
}

/** The first row of a raw `em.query` result (some drivers wrap `UPDATE ... RETURNING` in a pair) */
export function firstRow<T = Record<string, unknown>>(
  result: unknown,
): T | undefined {
  const rows =
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return (rows as T[])[0];
}
