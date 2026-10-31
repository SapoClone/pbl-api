import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

export type SalesCodePrefix = 'HD' | 'TH' | 'CA' | 'VD';

export function getSchemaPrefix(dsOrEm: DataSource | EntityManager): string {
  const ds = 'connection' in dsOrEm ? dsOrEm.connection : dsOrEm;
  const schema = (ds.options as { schema?: string }).schema;
  return schema ? `"${schema}".` : '';
}

/**
 * Generates a concurrency-safe, tenant-scoped sequential document code
 * (e.g. `HD-20261030-000001`) using an atomic PostgreSQL upsert counter.
 * Never uses `COUNT(*) + 1` or in-memory counters.
 */
export async function nextTenantDocumentCode(
  em: EntityManager,
  tenantId: string,
  docPrefix: SalesCodePrefix,
  now = new Date(),
): Promise<string> {
  const prefix = getSchemaPrefix(em);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;
  const seqKey = `${docPrefix}:${datePart}`;

  const rows = await em.query(
    `
    INSERT INTO ${prefix}"sales_code_sequence" (id, tenant_id, seq_key, last_value, updated_at)
    VALUES ($1, $2, $3, 1, now())
    ON CONFLICT (tenant_id, seq_key)
    DO UPDATE SET
      last_value = ${prefix}"sales_code_sequence".last_value + 1,
      updated_at = now()
    RETURNING last_value AS "lastValue"
    `,
    [randomUUID(), tenantId, seqKey],
  );
  const unwrapped = Array.isArray(rows[0]) ? rows[0] : rows;
  const seqNum = Number(unwrapped[0]?.lastValue ?? 1);
  return `${docPrefix}-${datePart}-${String(seqNum).padStart(6, '0')}`;
}
