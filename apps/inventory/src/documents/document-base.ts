import { qualifiedTable } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';
import { conflict, notFound } from '../common/sql';
import { MovementTables } from '../stock/stock-movement';
import { InventoryErrorCode } from '../stock/stock.service';

/** Pieces shared by the three stock documents */
export abstract class DocumentBase {
  protected constructor(protected readonly dataSource: DataSource) {}

  protected t(name: string): string {
    return qualifiedTable(this.dataSource, name);
  }

  protected get movement(): MovementTables {
    return { item: this.t('stock_item'), ledger: this.t('inventory_ledger') };
  }

  /** Locks the header row of the caller's tenant; 404 for another tenant's or out of scope (`visible` throws); 409 on a stale version */
  protected async lockHeader(
    em: EntityManager,
    table: string,
    tenantId: string,
    id: string,
    what: string,
    version?: number,
    visible?: (row: Record<string, any>) => void,
  ): Promise<Record<string, any>> {
    const [row] = await em.query(
      `SELECT * FROM ${this.t(table)} WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`,
      [tenantId, id],
    );
    if (!row) throw notFound(what);
    visible?.(row); // 404 when the document's branch is outside the caller's scope
    if (version !== undefined && version !== row.version) {
      throw conflict(
        InventoryErrorCode.VERSION_CONFLICT,
        `The ${what.toLowerCase()} was changed by someone else`,
      );
    }
    return row;
  }

  protected bump(
    em: EntityManager,
    table: string,
    tenantId: string,
    id: string,
    set: string,
    ...params: unknown[]
  ) {
    return em.query(
      `UPDATE ${this.t(table)} SET ${set}${set ? ', ' : ''}"version" = "version" + 1, "updated_at" = now()
       WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, id, ...params],
    );
  }
}

/** One line per SKU (quantities added, first variantId kept), in input order */
export function mergeDocumentLines<
  T extends { sku: string; quantity: number; variantId?: string },
>(lines: T[]): { sku: string; quantity: number; variantId?: string }[] {
  const bySku = new Map<
    string,
    { sku: string; quantity: number; variantId?: string }
  >();
  for (const line of lines) {
    const found = bySku.get(line.sku);
    if (found) found.quantity += line.quantity;
    else bySku.set(line.sku, { ...line });
  }
  return [...bySku.values()];
}
