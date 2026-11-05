import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';

/**
 * The schema-qualified, quoted table of an entity for raw SQL. The service sets a schema in the TypeORM options, not a
 * search_path, so a bare table name in `query(...)` would not be found (see tenant/member-code.ts).
 */
export function tableOf(
  source: DataSource | EntityManager,
  entity: EntityTarget<ObjectLiteral>,
): string {
  const connection = source instanceof DataSource ? source : source.connection;
  return connection
    .getMetadata(entity)
    .tablePath.split('.')
    .map((part) => `"${part}"`)
    .join('.');
}
