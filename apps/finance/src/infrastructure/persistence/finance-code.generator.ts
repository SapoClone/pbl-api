import { DataSource, EntityManager } from 'typeorm';

export type FinanceDocumentPrefix =
  | 'JNL'
  | 'PT'
  | 'PC'
  | 'AR'
  | 'AP'
  | 'CRD'
  | 'STL'
  | 'RFD'
  | 'COD'
  | 'BAT'
  | 'ADJ'
  | 'REC';

export function getSchemaPrefix(dataSource: DataSource): string {
  const schema = (dataSource.options as { schema?: string }).schema;
  return schema ? `"${schema}".` : '';
}

export async function nextFinanceDocumentCode(
  em: EntityManager,
  tenantId: string,
  prefix: FinanceDocumentPrefix,
): Promise<string> {
  const schemaPrefix = getSchemaPrefix(em.connection);
  const rows: Array<{ last_value: string | number }> = await em.query(
    `INSERT INTO ${schemaPrefix}"finance_code_sequence" ("tenant_id", "seq_key", "last_value", "updated_at")
     VALUES ($1, $2, 1, now())
     ON CONFLICT ("tenant_id", "seq_key")
     DO UPDATE SET "last_value" = ${schemaPrefix}"finance_code_sequence"."last_value" + 1,
                   "updated_at" = now()
     RETURNING "last_value"`,
    [tenantId, prefix],
  );
  const seq = Number(rows[0]?.last_value ?? 1);
  return `${prefix}${String(seq).padStart(6, '0')}`;
}
