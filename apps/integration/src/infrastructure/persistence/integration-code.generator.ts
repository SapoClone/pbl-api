import { qualifiedTable } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';

export function getIntegrationSchemaPrefix(
  source: DataSource | EntityManager,
): string {
  const conn = 'connection' in source ? source.connection : source;
  const schema = (conn.options as { schema?: string }).schema;
  return schema ? `"${schema}".` : '';
}

export async function nextIntegrationCode(
  em: EntityManager,
  tenantId: string,
  prefix: string,
): Promise<string> {
  const table = qualifiedTable(em.connection, 'integration_code_sequence');
  const rows = await em.query(
    `
    INSERT INTO ${table} ("tenant_id", "seq_key", "last_value", "updated_at")
    VALUES ($1, $2, 1, now())
    ON CONFLICT ("tenant_id", "seq_key")
    DO UPDATE SET
      "last_value" = ${table}."last_value" + 1,
      "updated_at" = now()
    RETURNING "last_value"
    `,
    [tenantId, prefix],
  );
  const val = Number(rows[0]?.last_value ?? 1);
  return `${prefix}${String(val).padStart(6, '0')}`;
}
