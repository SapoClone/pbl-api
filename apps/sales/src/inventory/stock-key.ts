/**
 * The key inventory knows a line by. Inventory's `sku_id` is the catalog variant id (a UUID),
 * never the SKU code; the code is only a fallback for a first-generation line without a variant.
 */
export function inventoryStockKey(
  variantId: string | null | undefined,
  skuCode: string,
): string {
  return variantId ?? skuCode;
}
