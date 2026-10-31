export type CategoryStatus = 'ACTIVE' | 'INACTIVE';
export type BrandStatus = 'ACTIVE' | 'INACTIVE';
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type VariantStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type PriceListStatus = 'ACTIVE' | 'INACTIVE';

export const CatalogErrorCode = {
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  VARIANT_NOT_FOUND: 'VARIANT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  BRAND_NOT_FOUND: 'BRAND_NOT_FOUND',
  ATTRIBUTE_NOT_FOUND: 'ATTRIBUTE_NOT_FOUND',
  ATTRIBUTE_VALUE_NOT_FOUND: 'ATTRIBUTE_VALUE_NOT_FOUND',
  PRICE_LIST_NOT_FOUND: 'PRICE_LIST_NOT_FOUND',
  CATEGORY_DEPTH_EXCEEDED: 'CATEGORY_DEPTH_EXCEEDED',
  CATEGORY_CYCLE_DETECTED: 'CATEGORY_CYCLE_DETECTED',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  CATEGORY_SLUG_EXISTS: 'CATEGORY_SLUG_EXISTS',
  CATEGORY_NAME_EXISTS: 'CATEGORY_NAME_EXISTS',
  BRAND_NAME_EXISTS: 'BRAND_NAME_EXISTS',
  BRAND_IN_USE: 'BRAND_IN_USE',
  ATTRIBUTE_NAME_EXISTS: 'ATTRIBUTE_NAME_EXISTS',
  ATTRIBUTE_VALUE_EXISTS: 'ATTRIBUTE_VALUE_EXISTS',
  SKU_ALREADY_EXISTS: 'SKU_ALREADY_EXISTS',
  BARCODE_ALREADY_EXISTS: 'BARCODE_ALREADY_EXISTS',
  INVALID_SKU: 'INVALID_SKU',
  INVALID_BARCODE: 'INVALID_BARCODE',
  INVALID_VARIANT_COMBINATION: 'INVALID_VARIANT_COMBINATION',
  VARIANT_COMBINATION_EXISTS: 'VARIANT_COMBINATION_EXISTS',
  VARIANT_GENERATION_LIMIT_EXCEEDED: 'VARIANT_GENERATION_LIMIT_EXCEEDED',
  INVALID_PRODUCT_LIFECYCLE: 'INVALID_PRODUCT_LIFECYCLE',
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  INVALID_PRICE: 'INVALID_PRICE',
  PRICE_LIST_CONFLICT: 'PRICE_LIST_CONFLICT',
  PRICE_NOT_CONFIGURED: 'PRICE_NOT_CONFIGURED',
  RESOURCE_VERSION_CONFLICT: 'RESOURCE_VERSION_CONFLICT',
  TENANT_ACCESS_DENIED: 'TENANT_ACCESS_DENIED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type CatalogErrorCodeType =
  (typeof CatalogErrorCode)[keyof typeof CatalogErrorCode];

export type CatalogErrorKind =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE';

export class CatalogDomainError extends Error {
  public readonly code: CatalogErrorCodeType;

  constructor(
    public readonly errorCode: CatalogErrorCodeType,
    message: string,
    public readonly kind: CatalogErrorKind = 'BAD_REQUEST',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CatalogDomainError';
    this.code = errorCode;
  }
}

export const MAX_CATEGORY_DEPTH = 3;
export const DEFAULT_MAX_VARIANT_COMBINATIONS = 100;
export const MAX_PRODUCT_IMAGES = 10;

const SKU_REGEX = /^[A-Z0-9][A-Z0-9._/-]{1,63}$/;
const CODE128_BARCODE_REGEX = /^[A-Z0-9][A-Z0-9._-]{3,63}$/i;
const ALL_DIGITS_REGEX = /^\d+$/;

/**
 * Normalizes a human-readable name for case-insensitive tenant-scoped uniqueness.
 */
export function normalizeName(raw: string): string {
  const cleaned = (raw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      'Name must not be empty',
      'BAD_REQUEST',
    );
  }
  return cleaned.toLowerCase();
}

/**
 * Converts a name or raw slug into a normalized URL/category slug, transliterating
 * Vietnamese diacritics deterministically.
 */
export function normalizeSlug(raw: string): string {
  const ascii = (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!ascii || ascii.length > 140) {
    throw new CatalogDomainError(
      CatalogErrorCode.CATEGORY_SLUG_EXISTS,
      'Category slug must contain at least one alphanumeric character and be at most 140 characters',
      'BAD_REQUEST',
    );
  }
  return ascii;
}

/**
 * Deterministically normalizes and validates a SKU code (trimmed, uppercase, 2..64 chars).
 */
export function normalizeSku(raw: string): string {
  const normalized = (raw ?? '').trim().toUpperCase();
  if (!SKU_REGEX.test(normalized)) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_SKU,
      'SKU must be 2-64 characters using uppercase letters, digits, hyphens, underscores, or dots',
      'BAD_REQUEST',
    );
  }
  return normalized;
}

/**
 * Computes and verifies standard GS1 (EAN-13 / EAN-8 / UPC-A) modulo-10 check digit.
 */
export function verifyGs1Checksum(digits: string): boolean {
  if (!ALL_DIGITS_REGEX.test(digits) || digits.length < 8) {
    return false;
  }
  const len = digits.length;
  const expectedCheck = Number(digits[len - 1]);
  let sum = 0;
  // From right to left (excluding check digit), weights alternate 3, 1, 3, 1...
  for (let i = len - 2, posFromRight = 1; i >= 0; i--, posFromRight++) {
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  const calculatedCheck = (10 - (sum % 10)) % 10;
  return calculatedCheck === expectedCheck;
}

/**
 * Validates EAN-13 checksum specifically.
 */
export function isValidEan13(barcode: string): boolean {
  return /^\d{13}$/.test(barcode) && verifyGs1Checksum(barcode);
}

/**
 * Validates and normalizes barcode formats:
 * - Numeric 13-digit barcodes MUST pass EAN-13 checksum validation.
 * - Numeric 8-digit (EAN-8) and 12-digit (UPC-A) barcodes MUST pass GS1 checksum validation.
 * - Other all-digit lengths are rejected as malformed numeric barcodes.
 * - Alphanumeric Code-128 barcodes (4..64 chars containing letters) are normalized to uppercase.
 */
export function validateAndNormalizeBarcode(
  raw?: string | null,
): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  if (ALL_DIGITS_REGEX.test(trimmed)) {
    if (
      trimmed.length !== 8 &&
      trimmed.length !== 12 &&
      trimmed.length !== 13
    ) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_BARCODE,
        `Numeric barcode must be EAN-8 (8 digits), UPC-A (12 digits), or EAN-13 (13 digits); got ${trimmed.length} digits`,
        'BAD_REQUEST',
      );
    }
    if (!verifyGs1Checksum(trimmed)) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_BARCODE,
        `Invalid GS1/EAN checksum for barcode ${trimmed}`,
        'BAD_REQUEST',
      );
    }
    return trimmed;
  }

  const upper = trimmed.toUpperCase();
  if (!CODE128_BARCODE_REGEX.test(upper)) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_BARCODE,
      'Alphanumeric barcode must be 4-64 characters (A-Z, 0-9, ., _, -)',
      'BAD_REQUEST',
    );
  }
  return upper;
}

export interface VariantAttributePair {
  attributeId: string;
  attributeValueId: string;
}

/**
 * Enforces that a variant has at most one value per attribute and produces a
 * canonical sorted signature for database-level duplicate prevention.
 */
export function buildCombinationSignature(
  pairs: VariantAttributePair[],
): string {
  if (!pairs || pairs.length === 0) {
    return 'DEFAULT';
  }
  const seenAttributes = new Set<string>();
  for (const pair of pairs) {
    if (!pair.attributeId || !pair.attributeValueId) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_VARIANT_COMBINATION,
        'Each variant attribute pair must include attributeId and attributeValueId',
        'BAD_REQUEST',
      );
    }
    if (seenAttributes.has(pair.attributeId)) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_VARIANT_COMBINATION,
        `A variant cannot contain multiple values for the same attribute (${pair.attributeId})`,
        'BAD_REQUEST',
      );
    }
    seenAttributes.add(pair.attributeId);
  }

  return [...pairs]
    .sort((a, b) => a.attributeId.localeCompare(b.attributeId))
    .map((p) => `${p.attributeId}:${p.attributeValueId}`)
    .join('|');
}

export interface VariantGenerationAxis {
  attributeId: string;
  attributeName: string;
  values: {
    id: string;
    value: string;
    skuToken?: string;
  }[];
}

export interface GeneratedVariantSpec {
  skuCode: string;
  name: string;
  combinationSignature: string;
  attributes: VariantAttributePair[];
}

function toSkuToken(value: string): string {
  const token = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8);
  return token || 'VAL';
}

/**
 * Generates the Cartesian product of attribute axes with strict upper bound
 * validation and canonical combination signatures.
 */
export function generateCartesianVariantSpecs(
  skuPrefix: string,
  productName: string,
  axes: VariantGenerationAxis[],
  maxCombinations = DEFAULT_MAX_VARIANT_COMBINATIONS,
): GeneratedVariantSpec[] {
  const normalizedPrefix = normalizeSku(skuPrefix);
  if (!axes || axes.length === 0) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_VARIANT_COMBINATION,
      'At least one attribute axis is required to generate variants',
      'BAD_REQUEST',
    );
  }

  const seenAxes = new Set<string>();
  let totalCombinations = 1;

  for (const axis of axes) {
    if (seenAxes.has(axis.attributeId)) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_VARIANT_COMBINATION,
        `Duplicate attribute axis ${axis.attributeId} in variant generation request`,
        'BAD_REQUEST',
      );
    }
    seenAxes.add(axis.attributeId);

    if (!axis.values || axis.values.length === 0) {
      throw new CatalogDomainError(
        CatalogErrorCode.INVALID_VARIANT_COMBINATION,
        `Attribute axis ${axis.attributeName || axis.attributeId} must have at least one value`,
        'BAD_REQUEST',
      );
    }

    const seenValueIds = new Set<string>();
    for (const val of axis.values) {
      if (seenValueIds.has(val.id)) {
        throw new CatalogDomainError(
          CatalogErrorCode.INVALID_VARIANT_COMBINATION,
          `Duplicate attribute value ${val.id} in axis ${axis.attributeId}`,
          'BAD_REQUEST',
        );
      }
      seenValueIds.add(val.id);
    }

    totalCombinations *= axis.values.length;
    if (totalCombinations > maxCombinations) {
      throw new CatalogDomainError(
        CatalogErrorCode.VARIANT_GENERATION_LIMIT_EXCEEDED,
        `Cartesian product of ${totalCombinations} variants exceeds maximum allowed (${maxCombinations})`,
        'BAD_REQUEST',
        { requestedCombinations: totalCombinations, maxCombinations },
      );
    }
  }

  type AccItem = {
    pairs: VariantAttributePair[];
    tokens: string[];
    labels: string[];
  };

  let acc: AccItem[] = [{ pairs: [], tokens: [], labels: [] }];
  for (const axis of axes) {
    const next: AccItem[] = [];
    for (const current of acc) {
      for (const val of axis.values) {
        next.push({
          pairs: [
            ...current.pairs,
            { attributeId: axis.attributeId, attributeValueId: val.id },
          ],
          tokens: [
            ...current.tokens,
            val.skuToken ? val.skuToken.toUpperCase() : toSkuToken(val.value),
          ],
          labels: [...current.labels, val.value.trim()],
        });
      }
    }
    acc = next;
  }

  return acc.map((item) => {
    const skuCandidate = `${normalizedPrefix}-${item.tokens.join('-')}`.slice(
      0,
      64,
    );
    return {
      skuCode: normalizeSku(skuCandidate),
      name: `${productName.trim()} (${item.labels.join(' / ')})`.slice(0, 240),
      combinationSignature: buildCombinationSignature(item.pairs),
      attributes: item.pairs,
    };
  });
}

/**
 * Validates category reparenting invariants (no self-parent, no cycle in subtree,
 * and resulting depth of entire descendant subtree <= MAX_CATEGORY_DEPTH).
 */
export function validateCategoryReparent(params: {
  categoryId: string;
  newParentId: string | null;
  newParentDepth: number; // 0 when newParentId is null
  descendantRelativeDepths: { id: string; relativeDepth: number }[]; // includes root at relativeDepth 0
  maxDepth?: number;
}): { newCategoryDepth: number; maxResultingDepth: number } {
  const maxAllowed = params.maxDepth ?? MAX_CATEGORY_DEPTH;

  if (params.newParentId === params.categoryId) {
    throw new CatalogDomainError(
      CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
      'A category cannot be its own parent',
      'CONFLICT',
    );
  }

  if (params.newParentId) {
    const isDescendant = params.descendantRelativeDepths.some(
      (node) => node.id === params.newParentId,
    );
    if (isDescendant) {
      throw new CatalogDomainError(
        CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
        'Cannot move a category under one of its own descendants',
        'CONFLICT',
      );
    }
  }

  const maxRelativeDepth = params.descendantRelativeDepths.reduce(
    (max, node) => Math.max(max, node.relativeDepth),
    0,
  );
  const newCategoryDepth =
    params.newParentId === null ? 1 : params.newParentDepth + 1;
  const maxResultingDepth = newCategoryDepth + maxRelativeDepth;

  if (maxResultingDepth > maxAllowed) {
    throw new CatalogDomainError(
      CatalogErrorCode.CATEGORY_DEPTH_EXCEEDED,
      `Reparenting would result in category tree depth ${maxResultingDepth}, exceeding maximum depth of ${maxAllowed}`,
      'CONFLICT',
      { newCategoryDepth, maxResultingDepth, maxAllowed },
    );
  }

  return { newCategoryDepth, maxResultingDepth };
}

/**
 * Validates a money value: a non-negative whole number of VND that is a safe
 * integer (bigint column, JSON number). Fractions and strings are rejected.
 */
export function parseAndFormatMoney(raw: number | string): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw.trim())
        ? Number(raw)
        : NaN;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRICE,
      'Price must be a non-negative whole number of VND',
      'BAD_REQUEST',
    );
  }
  return n;
}

/**
 * Validates positive decimal conversion factor (`NUMERIC(18,4) > 0`).
 */
export function parseAndFormatConversionFactor(
  raw: string | number,
  isBase = false,
): string {
  const str = typeof raw === 'number' ? String(raw) : (raw ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(str)) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_UNIT_CONVERSION,
      'Conversion factor must be a positive decimal with up to 4 decimal places',
      'BAD_REQUEST',
    );
  }
  const [wholeRaw, fracRaw = ''] = str.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracRaw.padEnd(4, '0');
  if (BigInt(whole) === 0n && BigInt(frac) === 0n) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_UNIT_CONVERSION,
      'Conversion factor must be strictly greater than zero',
      'BAD_REQUEST',
    );
  }
  if (isBase && (BigInt(whole) !== 1n || BigInt(frac) !== 0n)) {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_UNIT_CONVERSION,
      'Base unit conversion factor must be exactly 1.0000',
      'BAD_REQUEST',
    );
  }
  return `${whole}.${frac}`;
}

/**
 * Enforces valid product lifecycle state transitions.
 */
export function validateProductLifecycleTransition(
  current: ProductStatus,
  next: ProductStatus,
): void {
  if (current === next) return;
  if (current === 'ARCHIVED') {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      'An ARCHIVED product cannot transition back to another status',
      'CONFLICT',
    );
  }
  if (current !== 'DRAFT' && next === 'DRAFT') {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      `A ${current} product cannot transition back to DRAFT`,
      'CONFLICT',
    );
  }
}

export function validateVariantWithProductLifecycle(
  productStatus: ProductStatus,
  variantStatus: VariantStatus,
): void {
  if (productStatus === 'ARCHIVED' && variantStatus === 'ACTIVE') {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      'Cannot activate a variant belonging to an ARCHIVED product',
      'CONFLICT',
    );
  }
}

export interface PriceListCandidate {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  status: PriceListStatus;
  startDate: string | null;
  endDate: string | null;
  itemPrice: number | null;
}

export interface ResolvedVariantPrice {
  variantId: string;
  skuCode: string;
  currency: string;
  amount: number;
  source: 'PRICE_LIST' | 'DEFAULT_PRICE_LIST' | 'VARIANT_BASE_PRICE';
  priceListId: string | null;
  priceListName: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export function isPriceListEffectiveOn(
  list: Pick<PriceListCandidate, 'status' | 'startDate' | 'endDate'>,
  asOfDate: string,
): boolean {
  if (list.status !== 'ACTIVE') return false;
  if (list.startDate && asOfDate < list.startDate) return false;
  if (list.endDate && asOfDate > list.endDate) return false;
  return true;
}

/**
 * Deterministically resolves the price for a sellable variant given:
 * 1. An explicitly requested `selectedList` (must be ACTIVE and within effective dates)
 * 2. The tenant's `defaultList` (if ACTIVE, within effective dates, and has an item price)
 * 3. Fallback to the variant's `basePrice` if `> 0`, otherwise throws `PRICE_NOT_CONFIGURED`.
 */
export function resolveVariantPrice(params: {
  variantId: string;
  skuCode: string;
  variantStatus: VariantStatus;
  basePrice: number;
  asOfDate: string;
  selectedList?: PriceListCandidate | null;
  defaultList?: PriceListCandidate | null;
}): ResolvedVariantPrice {
  if (params.variantStatus !== 'ACTIVE') {
    throw new CatalogDomainError(
      CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
      `Cannot resolve sellable price for ${params.variantStatus} variant`,
      'CONFLICT',
    );
  }

  if (params.selectedList) {
    if (!isPriceListEffectiveOn(params.selectedList, params.asOfDate)) {
      throw new CatalogDomainError(
        CatalogErrorCode.PRICE_NOT_CONFIGURED,
        `Selected price list ${params.selectedList.id} is inactive or outside its effective date window (${params.asOfDate})`,
        'NOT_FOUND',
      );
    }
    if (params.selectedList.itemPrice === null) {
      throw new CatalogDomainError(
        CatalogErrorCode.PRICE_NOT_CONFIGURED,
        `Variant ${params.skuCode} has no price configured in price list ${params.selectedList.id}`,
        'NOT_FOUND',
      );
    }
    return {
      variantId: params.variantId,
      skuCode: params.skuCode,
      currency: params.selectedList.currency,
      amount: parseAndFormatMoney(params.selectedList.itemPrice),
      source: 'PRICE_LIST',
      priceListId: params.selectedList.id,
      priceListName: params.selectedList.name,
      effectiveFrom: params.selectedList.startDate,
      effectiveTo: params.selectedList.endDate,
    };
  }

  if (
    params.defaultList &&
    isPriceListEffectiveOn(params.defaultList, params.asOfDate) &&
    params.defaultList.itemPrice !== null
  ) {
    return {
      variantId: params.variantId,
      skuCode: params.skuCode,
      currency: params.defaultList.currency,
      amount: parseAndFormatMoney(params.defaultList.itemPrice),
      source: 'DEFAULT_PRICE_LIST',
      priceListId: params.defaultList.id,
      priceListName: params.defaultList.name,
      effectiveFrom: params.defaultList.startDate,
      effectiveTo: params.defaultList.endDate,
    };
  }

  const formattedBase = parseAndFormatMoney(params.basePrice ?? 0);
  if (formattedBase > 0) {
    return {
      variantId: params.variantId,
      skuCode: params.skuCode,
      currency: 'VND',
      amount: formattedBase,
      source: 'VARIANT_BASE_PRICE',
      priceListId: null,
      priceListName: null,
      effectiveFrom: null,
      effectiveTo: null,
    };
  }

  throw new CatalogDomainError(
    CatalogErrorCode.PRICE_NOT_CONFIGURED,
    `No active price configured for variant ${params.skuCode}`,
    'NOT_FOUND',
  );
}
