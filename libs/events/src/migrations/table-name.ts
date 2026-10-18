import { DataSource, QueryRunner } from 'typeorm';

/** The quoted `schema.table` name, or just the table name when the connection has no schema */
export function qualifiedTable(
  source: QueryRunner | DataSource,
  table: string,
): string {
  const connection = 'connection' in source ? source.connection : source;
  const schema = (connection.options as { schema?: string }).schema;
  return schema ? `"${schema}"."${table}"` : `"${table}"`;
}
