import { EntityManager } from 'typeorm';

/**
 * Serialises writers of one (tenant, warehouse, SKU) balance for the rest of
 * the transaction. A `SELECT ... FOR UPDATE` on a balance that does not exist
 * yet locks nothing, so two first receipts of a new SKU used to read
 * "no row", both compute from zero, and the second `ON CONFLICT` overwrote
 * the first one's quantity. Take this lock BEFORE reading the balance; the
 * read that follows then sees the row the other transaction committed.
 *
 * Callers that lock several SKUs must do so in a deterministic order (the
 * services already sort lines by SKU id) to stay deadlock free.
 */
export async function lockStockBalance(
  em: EntityManager,
  tenantId: string,
  warehouseId: string,
  skuId: string,
): Promise<void> {
  await em.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `stock_balance:${tenantId}:${warehouseId}:${skuId}`,
  ]);
}
