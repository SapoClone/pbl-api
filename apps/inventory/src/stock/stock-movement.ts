import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { conflict } from '../common/sql';
import { compareSku } from './stock-lines';
import { InventoryErrorCode } from './stock.service';

export interface MovementLine {
  sku: string;
  quantity: number;
}

/** Table names of the movement helpers, already schema-qualified */
export interface MovementTables {
  item: string;
  ledger: string;
}

async function writeLedger(
  em: EntityManager,
  t: MovementTables,
  tenantId: string,
  branchId: string,
  sku: string,
  change: number,
  balanceAfter: number,
  refType: string,
  refId: string,
): Promise<void> {
  await em.query(
    `INSERT INTO ${t.ledger} ("id", "tenant_id", "branch_id", "sku", "change_qty", "balance_after", "ref_type", "ref_id")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      tenantId,
      branchId,
      sku,
      change,
      balanceAfter,
      refType,
      refId,
    ],
  );
}

/**
 * Takes goods out of a branch, respecting holds (only `on_hand - reserved` can leave).
 * Rows are locked in byte order of the SKU like every other writer. A shortage throws
 * 409 I002 with the shortages; the caller's transaction rolls back.
 */
export async function deductStock(
  em: EntityManager,
  t: MovementTables,
  tenantId: string,
  branchId: string,
  lines: MovementLine[],
  refType: string,
  refId: string,
): Promise<void> {
  const shortages: { sku: string; requested: number; available: number }[] = [];
  for (const line of [...lines].sort((a, b) => compareSku(a.sku, b.sku))) {
    // an UPDATE ... RETURNING answers [rows, affectedCount] (unlike INSERT ... RETURNING)
    const [rows] = await em.query(
      `UPDATE ${t.item} SET "quantity_on_hand" = "quantity_on_hand" - $4, "updated_at" = now()
       WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3
         AND "quantity_on_hand" - "quantity_reserved" >= $4
       RETURNING "quantity_on_hand"`,
      [tenantId, branchId, line.sku, line.quantity],
    );
    if (!rows.length) {
      const [have] = await em.query(
        `SELECT "quantity_on_hand" - "quantity_reserved" AS available FROM ${t.item}
         WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3`,
        [tenantId, branchId, line.sku],
      );
      shortages.push({
        sku: line.sku,
        requested: line.quantity,
        available: have ? Number(have.available) : 0,
      });
      continue;
    }
    await writeLedger(
      em,
      t,
      tenantId,
      branchId,
      line.sku,
      -line.quantity,
      rows[0].quantity_on_hand,
      refType,
      refId,
    );
  }
  if (shortages.length) {
    throw conflict(
      InventoryErrorCode.OUT_OF_STOCK,
      'Not enough stock',
      shortages,
    );
  }
}

/** Adds goods to a branch (creating the stock row on first sight) with a ledger row */
export async function addStock(
  em: EntityManager,
  t: MovementTables,
  tenantId: string,
  branchId: string,
  lines: MovementLine[],
  refType: string,
  refId: string,
): Promise<void> {
  for (const line of [...lines].sort((a, b) => compareSku(a.sku, b.sku))) {
    const rows = await em.query(
      `INSERT INTO ${t.item} ("id", "tenant_id", "branch_id", "sku", "quantity_on_hand")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("tenant_id", "branch_id", "sku") DO UPDATE SET
         "quantity_on_hand" = ${t.item}."quantity_on_hand" + EXCLUDED."quantity_on_hand",
         "updated_at" = now()
       RETURNING "quantity_on_hand"`,
      [randomUUID(), tenantId, branchId, line.sku, line.quantity],
    );
    await writeLedger(
      em,
      t,
      tenantId,
      branchId,
      line.sku,
      line.quantity,
      rows[0].quantity_on_hand,
      refType,
      refId,
    );
  }
}

/**
 * Sets on hand to a counted quantity (stock take). Returns the change; writes a ledger
 * row only when there is one. Counting below what is held would break the CHECK
 * constraint, so it is refused with 409 I015 instead of a 500.
 */
export async function setStock(
  em: EntityManager,
  t: MovementTables,
  tenantId: string,
  branchId: string,
  sku: string,
  counted: number,
  refType: string,
  refId: string,
): Promise<number> {
  const [row] = await em.query(
    `SELECT "quantity_on_hand", "quantity_reserved" FROM ${t.item}
     WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3 FOR UPDATE`,
    [tenantId, branchId, sku],
  );
  const current = row ? Number(row.quantity_on_hand) : 0;
  const reserved = row ? Number(row.quantity_reserved) : 0;
  if (counted < reserved) {
    throw conflict(
      InventoryErrorCode.COUNT_BELOW_HELD,
      `Counted quantity of ${sku} is below the ${reserved} held for orders`,
    );
  }
  const change = counted - current;
  if (change === 0) return 0;
  if (row) {
    await em.query(
      `UPDATE ${t.item} SET "quantity_on_hand" = $4, "updated_at" = now()
       WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3`,
      [tenantId, branchId, sku, counted],
    );
  } else {
    await em.query(
      `INSERT INTO ${t.item} ("id", "tenant_id", "branch_id", "sku", "quantity_on_hand") VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), tenantId, branchId, sku, counted],
    );
  }
  await writeLedger(
    em,
    t,
    tenantId,
    branchId,
    sku,
    change,
    counted,
    refType,
    refId,
  );
  return change;
}
