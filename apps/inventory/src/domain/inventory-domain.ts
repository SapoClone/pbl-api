import { createHash } from 'crypto';

export const InventoryDomainErrorCode = {
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  WAREHOUSE_INACTIVE: 'WAREHOUSE_INACTIVE',
  WAREHOUSE_CODE_CONFLICT: 'WAREHOUSE_CODE_CONFLICT',
  WAREHOUSE_HAS_PENDING_OPERATIONS: 'WAREHOUSE_HAS_PENDING_OPERATIONS',
  SKU_NOT_FOUND: 'SKU_NOT_FOUND',
  SKU_NOT_SELLABLE: 'SKU_NOT_SELLABLE',
  STOCK_BALANCE_NOT_FOUND: 'STOCK_BALANCE_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  RESERVATION_ALREADY_COMMITTED: 'RESERVATION_ALREADY_COMMITTED',
  RESERVATION_STATE_CONFLICT: 'RESERVATION_STATE_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_MONEY_AMOUNT: 'INVALID_MONEY_AMOUNT',
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  STOCK_RECEIPT_NOT_FOUND: 'STOCK_RECEIPT_NOT_FOUND',
  STOCK_RECEIPT_ALREADY_POSTED: 'STOCK_RECEIPT_ALREADY_POSTED',
  STOCK_RECEIPT_INVALID_STATE: 'STOCK_RECEIPT_INVALID_STATE',
  STOCK_ISSUE_NOT_FOUND: 'STOCK_ISSUE_NOT_FOUND',
  STOCK_ISSUE_ALREADY_POSTED: 'STOCK_ISSUE_ALREADY_POSTED',
  STOCK_ISSUE_INVALID_STATE: 'STOCK_ISSUE_INVALID_STATE',
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  TRANSFER_SAME_WAREHOUSE: 'TRANSFER_SAME_WAREHOUSE',
  TRANSFER_INVALID_STATE: 'TRANSFER_INVALID_STATE',
  TRANSFER_QUANTITY_MISMATCH: 'TRANSFER_QUANTITY_MISMATCH',
  STOCKTAKE_NOT_FOUND: 'STOCKTAKE_NOT_FOUND',
  STOCKTAKE_INVALID_STATE: 'STOCKTAKE_INVALID_STATE',
  STOCKTAKE_STALE_SNAPSHOT: 'STOCKTAKE_STALE_SNAPSHOT',
  STOCKTAKE_BELOW_RESERVED: 'STOCKTAKE_BELOW_RESERVED',
  SUPPLIER_NOT_FOUND: 'SUPPLIER_NOT_FOUND',
  SUPPLIER_CODE_CONFLICT: 'SUPPLIER_CODE_CONFLICT',
  SUPPLIER_INACTIVE: 'SUPPLIER_INACTIVE',
  PURCHASE_ORDER_NOT_FOUND: 'PURCHASE_ORDER_NOT_FOUND',
  PURCHASE_ORDER_CODE_CONFLICT: 'PURCHASE_ORDER_CODE_CONFLICT',
  PURCHASE_ORDER_INVALID_STATE: 'PURCHASE_ORDER_INVALID_STATE',
  OVER_RECEIPT_NOT_ALLOWED: 'OVER_RECEIPT_NOT_ALLOWED',
  CROSS_TENANT_ACCESS_DENIED: 'CROSS_TENANT_ACCESS_DENIED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type InventoryDomainErrorCodeType =
  (typeof InventoryDomainErrorCode)[keyof typeof InventoryDomainErrorCode];

export class InventoryDomainError extends Error {
  readonly code: InventoryDomainErrorCodeType;
  readonly errorCode: InventoryDomainErrorCodeType;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(
    code: InventoryDomainErrorCodeType,
    message: string,
    httpStatus = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = 'InventoryDomainError';
    this.code = code;
    this.errorCode = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const QTY_SCALE = 1000n;
const MONEY_SCALE = 100n;
const FACTOR_SCALE = 10000n;

export function normalizeInventoryCode(
  input: string,
  fieldName = 'code',
): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '-');
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(cleaned)) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_QUANTITY,
      `Invalid ${fieldName} "${input}"`,
      400,
    );
  }
  return cleaned;
}

export function parseQtyToMilli(
  value: string | number,
  allowZero = false,
  allowNegative = false,
): bigint {
  const str = String(value).trim();
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,3}))?$/.exec(str);
  if (!match) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_QUANTITY,
      `Invalid decimal quantity "${value}" (expected NUMERIC(18,3))`,
      400,
    );
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const frac = BigInt((match[3] ?? '').padEnd(3, '0'));
  const milli = sign * (whole * QTY_SCALE + frac);

  if (!allowNegative && milli < 0n) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_QUANTITY,
      `Quantity "${value}" cannot be negative`,
      400,
    );
  }
  if (!allowZero && milli === 0n) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_QUANTITY,
      `Quantity "${value}" must be strictly greater than zero`,
      400,
    );
  }
  return milli;
}

export function formatMilliToQty(milli: bigint): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const whole = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export function parseMoneyToCents(
  value: string | number | undefined | null,
): bigint {
  if (value === undefined || value === null || value === '') {
    return 0n;
  }
  const str = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(str);
  if (!match) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_MONEY_AMOUNT,
      `Invalid money amount "${value}" (expected non-negative NUMERIC(18,2))`,
      400,
    );
  }
  const whole = BigInt(match[1]);
  const frac = BigInt((match[2] ?? '').padEnd(2, '0'));
  return whole * MONEY_SCALE + frac;
}

export function formatCentsToMoney(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / MONEY_SCALE;
  const frac = (abs % MONEY_SCALE).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export function parseConversionFactorToTenThousandths(
  value: string | number | undefined | null,
): bigint {
  if (value === undefined || value === null || value === '') {
    return FACTOR_SCALE;
  }
  const str = String(value).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/.exec(str);
  if (!match) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_UNIT_CONVERSION,
      `Invalid unit conversion factor "${value}" (expected positive NUMERIC(18,4))`,
      400,
    );
  }
  const whole = BigInt(match[1]);
  const frac = BigInt((match[2] ?? '').padEnd(4, '0'));
  const factor = whole * FACTOR_SCALE + frac;
  if (factor <= 0n) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_UNIT_CONVERSION,
      `Unit conversion factor "${value}" must be greater than zero`,
      400,
    );
  }
  return factor;
}

export function formatFactorFromTenThousandths(factor: bigint): string {
  const whole = factor / FACTOR_SCALE;
  const frac = (factor % FACTOR_SCALE).toString().padStart(4, '0');
  return `${whole.toString()}.${frac}`;
}

export function convertToBaseQtyMilli(
  qtyInput: string | number,
  conversionFactor?: string | number | null,
): bigint {
  const rawMilli = parseQtyToMilli(qtyInput, false, false);
  const factor = parseConversionFactorToTenThousandths(conversionFactor);
  const converted = (rawMilli * factor + FACTOR_SCALE / 2n) / FACTOR_SCALE;
  if (converted <= 0n) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_UNIT_CONVERSION,
      'Converted base quantity must be strictly positive',
      400,
    );
  }
  return converted;
}

export interface WeightedAverageCostResult {
  newOnHandMilli: bigint;
  newAvgCostCents: bigint;
  newValuationCents: bigint;
  newOnHandQty: string;
  newAvgUnitCost: string;
  newValuationAmount: string;
}

/**
 * Computes the updated weighted-average unit cost and total valuation using
 * exact scaled BigInt arithmetic:
 * new_avg_cost = round((old_qty * old_avg_cost + added_qty * unit_cost) / (old_qty + added_qty), 2)
 */
export function computeWeightedAverageCostOnReceipt(params: {
  currentOnHandQty: string | number;
  currentAvgUnitCost: string | number;
  receivedBaseQty: string | number;
  receivedUnitCost: string | number;
}): WeightedAverageCostResult {
  const oldQtyMilli = parseQtyToMilli(params.currentOnHandQty, true, false);
  const oldAvgCents = parseMoneyToCents(params.currentAvgUnitCost);
  const addQtyMilli = parseQtyToMilli(params.receivedBaseQty, false, false);
  const addCostCents = parseMoneyToCents(params.receivedUnitCost);

  const newOnHandMilli = oldQtyMilli + addQtyMilli;
  // Each product is in (milli * cents) = 10^-5 units
  const totalWeighted = oldQtyMilli * oldAvgCents + addQtyMilli * addCostCents;
  const newAvgCostCents =
    (totalWeighted + newOnHandMilli / 2n) / newOnHandMilli;
  const newValuationCents =
    (newOnHandMilli * newAvgCostCents + QTY_SCALE / 2n) / QTY_SCALE;

  return {
    newOnHandMilli,
    newAvgCostCents,
    newValuationCents,
    newOnHandQty: formatMilliToQty(newOnHandMilli),
    newAvgUnitCost: formatCentsToMoney(newAvgCostCents),
    newValuationAmount: formatCentsToMoney(newValuationCents),
  };
}

/**
 * Computes valuation after an outbound stock deduction (sale commit, manual issue, transfer dispatch).
 * Weighted-average unit cost remains unchanged on outbound movements; when on_hand reaches 0,
 * valuation_amount is 0.00.
 */
export function computeValuationAfterDeduction(params: {
  currentOnHandQty: string | number;
  currentAvgUnitCost: string | number;
  deductedBaseQty: string | number;
}): WeightedAverageCostResult {
  const oldQtyMilli = parseQtyToMilli(params.currentOnHandQty, true, false);
  const avgCents = parseMoneyToCents(params.currentAvgUnitCost);
  const deductMilli = parseQtyToMilli(params.deductedBaseQty, false, false);
  if (deductMilli > oldQtyMilli) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INSUFFICIENT_STOCK,
      `Cannot deduct ${formatMilliToQty(deductMilli)} from on-hand ${formatMilliToQty(oldQtyMilli)}`,
      409,
    );
  }
  const newOnHandMilli = oldQtyMilli - deductMilli;
  const newValuationCents =
    newOnHandMilli === 0n
      ? 0n
      : (newOnHandMilli * avgCents + QTY_SCALE / 2n) / QTY_SCALE;

  return {
    newOnHandMilli,
    newAvgCostCents: avgCents,
    newValuationCents,
    newOnHandQty: formatMilliToQty(newOnHandMilli),
    newAvgUnitCost: formatCentsToMoney(avgCents),
    newValuationAmount: formatCentsToMoney(newValuationCents),
  };
}

export interface NormalizedSkuQtyLine {
  warehouseId: string;
  skuId: string;
  qtyMilli: bigint;
  qty: string;
}

/**
 * Combines duplicate (warehouseId, skuId) lines and sorts deterministically by
 * (warehouseId ASC, skuId ASC) to prevent PostgreSQL deadlocks under concurrent multi-SKU locking.
 */
export function normalizeAndSortWarehouseLines(
  lines: { warehouseId: string; skuId: string; qty: string | number }[],
): NormalizedSkuQtyLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new InventoryDomainError(
      InventoryDomainErrorCode.INVALID_QUANTITY,
      'At least one stock line is required',
      400,
    );
  }
  const map = new Map<
    string,
    { warehouseId: string; skuId: string; qtyMilli: bigint }
  >();
  for (const line of lines) {
    const qtyMilli = parseQtyToMilli(line.qty, false, false);
    const key = `${line.warehouseId}:${line.skuId}`;
    const existing = map.get(key);
    if (existing) {
      existing.qtyMilli += qtyMilli;
    } else {
      map.set(key, {
        warehouseId: line.warehouseId,
        skuId: line.skuId,
        qtyMilli,
      });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => {
      const w = a.warehouseId.localeCompare(b.warehouseId);
      return w !== 0 ? w : a.skuId.localeCompare(b.skuId);
    })
    .map((item) => ({
      warehouseId: item.warehouseId,
      skuId: item.skuId,
      qtyMilli: item.qtyMilli,
      qty: formatMilliToQty(item.qtyMilli),
    }));
}

export function computeCanonicalHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
