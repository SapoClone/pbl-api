import { StockLine } from '@pbl/contracts';

/** One line per SKU (quantities added), sorted by SKU: the order in which stock rows are locked */
export function mergeLines(lines: StockLine[]): StockLine[] {
  const bySku = new Map<string, number>();
  for (const { sku, quantity } of lines) {
    bySku.set(sku, (bySku.get(sku) ?? 0) + quantity);
  }
  return [...bySku.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sku, quantity]) => ({ sku, quantity }));
}
