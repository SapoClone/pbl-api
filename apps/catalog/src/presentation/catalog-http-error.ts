import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  CatalogErrorCodeType,
} from '../domain/catalog-domain';

interface PgErrorShape {
  code?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_TO_ERROR: Record<
  string,
  { code: CatalogErrorCodeType; message: string }
> = {
  UQ_categories_root_slug: {
    code: CatalogErrorCode.CATEGORY_SLUG_EXISTS,
    message: 'Category slug already exists at root level for this tenant',
  },
  UQ_categories_child_slug: {
    code: CatalogErrorCode.CATEGORY_SLUG_EXISTS,
    message: 'Category slug already exists under this parent category',
  },
  UQ_categories_root_name: {
    code: CatalogErrorCode.CATEGORY_NAME_EXISTS,
    message: 'Category name already exists at root level for this tenant',
  },
  UQ_categories_child_name: {
    code: CatalogErrorCode.CATEGORY_NAME_EXISTS,
    message: 'Category name already exists under this parent category',
  },
  UQ_brands_tenant_norm_name: {
    code: CatalogErrorCode.BRAND_NAME_EXISTS,
    message: 'Brand name already exists for this tenant',
  },
  UQ_attributes_tenant_norm_name: {
    code: CatalogErrorCode.ATTRIBUTE_NAME_EXISTS,
    message: 'Attribute name already exists for this tenant',
  },
  UQ_attribute_values_tenant_attr_norm_val: {
    code: CatalogErrorCode.ATTRIBUTE_VALUE_EXISTS,
    message: 'Attribute value already exists for this attribute',
  },
  UQ_product_variants_tenant_sku: {
    code: CatalogErrorCode.SKU_ALREADY_EXISTS,
    message: 'SKU code already exists for this tenant',
  },
  UQ_product_variants_tenant_barcode: {
    code: CatalogErrorCode.BARCODE_ALREADY_EXISTS,
    message: 'Barcode already exists for this tenant',
  },
  UQ_product_variants_product_combo_sig: {
    code: CatalogErrorCode.VARIANT_COMBINATION_EXISTS,
    message:
      'A variant with this exact attribute combination already exists for the product',
  },
  UQ_variant_attribute_values_single_per_attr: {
    code: CatalogErrorCode.INVALID_VARIANT_COMBINATION,
    message: 'A variant cannot contain multiple values for the same attribute',
  },
  UQ_unit_conversions_product_unit: {
    code: CatalogErrorCode.INVALID_UNIT_CONVERSION,
    message: 'Unit name already exists for this product',
  },
  UQ_unit_conversions_single_base: {
    code: CatalogErrorCode.INVALID_UNIT_CONVERSION,
    message: 'Product can have at most one canonical base unit',
  },
  UQ_price_lists_tenant_norm_name: {
    code: CatalogErrorCode.PRICE_LIST_CONFLICT,
    message: 'Price list name already exists for this tenant',
  },
  UQ_price_lists_active_default: {
    code: CatalogErrorCode.PRICE_LIST_CONFLICT,
    message: 'Another active default price list already exists for this tenant',
  },
  UQ_price_list_items_unique: {
    code: CatalogErrorCode.PRICE_LIST_CONFLICT,
    message: 'Price list item already exists for this variant',
  },
};

export function toCatalogHttpException(error: unknown): never {
  if (error instanceof HttpException) {
    throw error;
  }

  if (error instanceof CatalogDomainError) {
    const body = {
      errorCode: error.errorCode,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    switch (error.kind) {
      case 'NOT_FOUND':
        throw new NotFoundException(body);
      case 'CONFLICT':
        throw new ConflictException(body);
      case 'FORBIDDEN':
        throw new ForbiddenException(body);
      case 'UNPROCESSABLE':
        throw new UnprocessableEntityException(body);
      case 'BAD_REQUEST':
      default:
        throw new BadRequestException(body);
    }
  }

  if (error instanceof QueryFailedError) {
    const driverErr = (error.driverError ?? error) as PgErrorShape;
    const constraint = driverErr.constraint ?? '';
    if (driverErr.code === '23505') {
      const mapped = CONSTRAINT_TO_ERROR[constraint];
      if (mapped) {
        throw new ConflictException({
          errorCode: mapped.code,
          message: mapped.message,
        });
      }
      throw new ConflictException({
        errorCode: CatalogErrorCode.RESOURCE_VERSION_CONFLICT,
        message: 'Unique constraint conflict',
      });
    }
    if (driverErr.code === '23503') {
      if (constraint.includes('categories')) {
        throw new ConflictException({
          errorCode: CatalogErrorCode.CATEGORY_IN_USE,
          message:
            'Category is referenced by child categories or products and cannot be removed',
        });
      }
      if (constraint.includes('brands')) {
        throw new ConflictException({
          errorCode: CatalogErrorCode.BRAND_IN_USE,
          message: 'Brand is referenced by products and cannot be removed',
        });
      }
      throw new BadRequestException({
        errorCode: CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
        message: 'Referenced catalog resource does not exist in this tenant',
      });
    }
    if (driverErr.code === '23514') {
      if (constraint.includes('depth')) {
        throw new ConflictException({
          errorCode: CatalogErrorCode.CATEGORY_DEPTH_EXCEEDED,
          message: 'Category depth cannot exceed 3 levels',
        });
      }
      if (constraint.includes('price')) {
        throw new BadRequestException({
          errorCode: CatalogErrorCode.INVALID_PRICE,
          message: 'Price constraint violation',
        });
      }
    }
  }

  throw error;
}
