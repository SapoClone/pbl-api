import {
  INVENTORY_STOCK_BELOW_MIN,
  StockBelowMinPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { formatMilliToQty } from '../domain/inventory-domain';

/**
 * D21: `inventory.stock.below_min` once per crossing. Called by every path
 * that lowers AVAILABLE stock (on hand minus holds): a hold for a sale, a
 * stock issue, a transfer dispatch. It emits when available goes from at or
 * above the warehouse's minimum for the SKU to below it, so a movement that
 * happens while already below the minimum stays quiet, and the alert is
 * re-armed by the stock rising back to the minimum (a later drop crosses
 * again). No state is stored: the crossing is read off before/after.
 * A threshold edit has its own emit in `StockViewsService`.
 *
 * Must run in the transaction of the movement, after the balance row was
 * locked, so the outbox row commits with it.
 */
export async function emitBelowMinOnCrossing(
  em: EntityManager,
  outbox: EventOutbox | undefined,
  prefix: string,
  tenantId: string,
  warehouseId: string,
  skuId: string,
  availableBeforeMilli: bigint,
  availableAfterMilli: bigint,
  occurredAt: string = new Date().toISOString(),
): Promise<boolean> {
  if (!outbox || availableAfterMilli >= availableBeforeMilli) return false;
  const [threshold] = await em.query(
    `SELECT min_qty::text AS "minQty" FROM ${prefix}"stock_threshold"
     WHERE tenant_id = $1 AND warehouse_id = $2 AND sku_id = $3`,
    [tenantId, warehouseId, skuId],
  );
  if (!threshold) return false;
  const minMilli = BigInt(Math.round(Number(threshold.minQty) * 1000));
  if (minMilli <= 0n) return false;
  if (!(availableBeforeMilli >= minMilli && availableAfterMilli < minMilli)) {
    return false;
  }
  const [wh] = await em.query(
    `SELECT branch_id AS "branchId" FROM ${prefix}"warehouse"
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, warehouseId],
  );
  const [sku] = await em.query(
    `SELECT sku_code, name FROM ${prefix}"catalog_sku_projection"
     WHERE tenant_id = $1 AND sku_id = $2`,
    [tenantId, skuId],
  );
  await outbox.add(em, INVENTORY_STOCK_BELOW_MIN, {
    branchId: wh?.branchId ?? null,
    warehouseId,
    variantId: skuId,
    sku: sku?.sku_code ?? null,
    name: sku?.name ?? null,
    available: Number(formatMilliToQty(availableAfterMilli)),
    minQuantity: Number(formatMilliToQty(minMilli)),
    occurredAt,
  } satisfies StockBelowMinPayload);
  return true;
}
