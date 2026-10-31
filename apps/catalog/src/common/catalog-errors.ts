import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/** Error codes of this service (a domain letter plus 3 digits, api-conventions §6) */
export const CatalogErrorCode = {
  DUPLICATE_SKU: 'C001',
  DUPLICATE_BARCODE: 'C002',
  UNKNOWN_REFERENCE: 'C003',
  TOO_MANY_VARIANTS: 'C004',
  DUPLICATE_COMBINATION: 'C007',
  DUPLICATE_CATEGORY_NAME: 'C008',
  CATEGORY_NOT_EMPTY: 'C009',
  EXPORT_TOO_LARGE: 'C010',
  DUPLICATE_BRAND_NAME: 'C011',
  DUPLICATE_ATTRIBUTE: 'C012',
  INVALID_PRODUCT: 'C013',
  CATEGORY_CYCLE: 'C014',
  BRAND_IN_USE: 'C015',
} as const;

export const conflict = (errorCode: string, message: string) =>
  new ConflictException({ errorCode, message });
export const badRequest = (errorCode: string, message: string) =>
  new BadRequestException({ errorCode, message });
export const notFound = (what: string) =>
  new NotFoundException(`${what} not found`);

/** Unique index name -> the conflict it means */
const UNIQUE_VIOLATIONS: Record<string, [string, string]> = {
  UQ_product_variant_tenant_sku: [
    CatalogErrorCode.DUPLICATE_SKU,
    'This SKU is already used by another variant',
  ],
  UQ_product_variant_tenant_barcode: [
    CatalogErrorCode.DUPLICATE_BARCODE,
    'This barcode is already used by another variant',
  ],
  UQ_category_tenant_parent_name: [
    CatalogErrorCode.DUPLICATE_CATEGORY_NAME,
    'A category with this name already exists here',
  ],
  UQ_brand_tenant_name: [
    CatalogErrorCode.DUPLICATE_BRAND_NAME,
    'A brand with this name already exists',
  ],
  UQ_attribute_tenant_name: [
    CatalogErrorCode.DUPLICATE_ATTRIBUTE,
    'An attribute with this name already exists',
  ],
  UQ_attribute_value_attribute_value: [
    CatalogErrorCode.DUPLICATE_ATTRIBUTE,
    'This attribute already has this value',
  ],
};

/**
 * Runs a write and turns a unique-index violation into the 409 with its errorCode.
 * The database is the one judge of uniqueness, so concurrent writers cannot both win.
 */
export async function translateUnique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as {
        code?: string;
        constraint?: string;
      };
      const known = driver?.constraint
        ? UNIQUE_VIOLATIONS[driver.constraint]
        : undefined;
      if (driver?.code === '23505' && known) {
        throw conflict(known[0], known[1]);
      }
    }
    throw error;
  }
}
