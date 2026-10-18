import { StockLine } from '@pbl/contracts';

/**
 * SKUs compare by their bytes, exactly as Postgres does under `COLLATE "C"`: every
 * code path that locks `stock_item` rows must use this one order (a database
 * collation such as en_US sorts 'ao-01' before 'AO-01', and two orders locking the
 * same rows in opposite order can deadlock).
 */
export const compareSku = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/** One line per SKU (quantities added), in the order in which stock rows are locked */
export function mergeLines(lines: StockLine[]): StockLine[] {
  const bySku = new Map<string, number>();
  for (const { sku, quantity } of lines) {
    bySku.set(sku, (bySku.get(sku) ?? 0) + quantity);
  }
  return [...bySku.entries()]
    .sort(([a], [b]) => compareSku(a, b))
    .map(([sku, quantity]) => ({ sku, quantity }));
}

/** Whether two sets of lines ask for the same quantities of the same SKUs */
export function sameLines(a: StockLine[], b: StockLine[]): boolean {
  const left = mergeLines(a);
  const right = mergeLines(b);
  return (
    left.length === right.length &&
    left.every(
      (line, i) =>
        line.sku === right[i].sku && line.quantity === right[i].quantity,
    )
  );
}
