import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { tableOf } from './sql';

/**
 * The next `<prefix><number>` code of a table (TN0001, SUB-0001, PAY-00001). Issued by the application, not a sequence,
 * so the entity-synchronised local stack gets codes too. Call it inside the transaction that inserts the row: the
 * advisory lock is released at its end, so two concurrent inserts never read the same maximum.
 */
export async function issueCode(
  em: EntityManager,
  entity: EntityTarget<ObjectLiteral>,
  prefix: string,
  digits: number,
): Promise<string> {
  const table = tableOf(em, entity);
  await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `code:${table}`,
  ]);
  const [row] = await em.query(
    `SELECT COALESCE(MAX(substring("code" FROM ${prefix.length + 1})::int), 0) + 1 AS next FROM ${table}`,
  );
  return `${prefix}${String(row.next).padStart(digits, '0')}`;
}
