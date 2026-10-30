import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  ProductImageMeta,
  ProductStatus,
  VariantStatus,
} from '../../infrastructure/persistence/catalog.entities';

export class ProductImageDto implements ProductImageMeta {
  @ApiProperty({ example: 'tenants/t1/products/tshirt-front.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  key!: string;

  @ApiProperty({ example: 'https://cdn.sapoclone.local/tshirt-front.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional({ example: 'Front view', maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  altText?: string | null;

  @ApiProperty({ example: 0, minimum: 0, maximum: 9 })
  @IsInt()
  @Min(0)
  @Max(9)
  sortOrder!: number;
}

export class VariantAttributeInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeValueId!: string;
}

export class CreateProductReqDto {
  @ApiProperty({ example: 'Áo thun cotton nam', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Basic cotton T-shirt', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ example: 'piece', default: 'piece', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  baseUnit?: string;

  @ApiPropertyOptional({
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
    default: 'ACTIVE',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'])
  status?: ProductStatus;

  @ApiPropertyOptional({ type: [ProductImageDto], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, creates an initial default sellable variant in the same transaction',
  })
  @IsOptional()
  @IsBoolean()
  createDefaultVariant?: boolean;

  @ApiPropertyOptional({
    example: 'TSHIRT-DEFAULT',
    maxLength: 64,
    description: 'Optional SKU code for the initial default variant',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultSkuCode?: string;

  @ApiPropertyOptional({
    example: '8938505974192',
    maxLength: 64,
    description: 'Optional barcode for the initial default variant',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultBarcode?: string;

  @ApiPropertyOptional({
    example: '199000.00',
    description: 'Optional base price (VND) for the initial default variant',
  })
  @IsOptional()
  @IsString()
  defaultBasePrice?: string;
}

export class UpdateProductReqDto {
  @ApiPropertyOptional({
    example: 'Áo thun cotton nam cao cấp',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  baseUnit?: string;

  @ApiPropertyOptional({ type: [ProductImageDto], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      'Expected current aggregate version for optimistic concurrency control (409 on mismatch)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class UpdateProductStatusReqDto {
  @ApiProperty({
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'],
    example: 'INACTIVE',
  })
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status!: ProductStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ListProductsReqDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      'Optional keyset cursor (`<createdAtISO>_<uuid>`) for deep O(1) pagination',
  })
  @IsOptional()
  @IsString()
  afterCursor?: string;

  @ApiPropertyOptional({ description: 'Search by product name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: ProductStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'name', 'updatedAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'name', 'updatedAt'])
  sort: 'createdAt' | 'name' | 'updatedAt' = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}

export class LookupProductReqDto {
  @ApiPropertyOptional({ example: 'TSHIRT-BLK-M', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({ example: '8938505974192', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
}

export class CreateVariantReqDto {
  @ApiProperty({ example: 'TSHIRT-BLK-M', maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  skuCode!: string;

  @ApiPropertyOptional({
    example: '8938505974192',
    maxLength: 64,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({
    example: 'Áo thun cotton nam (Black / M)',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  name?: string;

  @ApiPropertyOptional({ example: '199000.00', default: '0.00' })
  @IsOptional()
  @IsString()
  basePrice?: string;

  @ApiPropertyOptional({ example: '0.250', nullable: true })
  @IsOptional()
  @IsString()
  weight?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [VariantAttributeInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeInputDto)
  attributes?: VariantAttributeInputDto[];
}

export class VariantGenerationAxisInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;

  @ApiProperty({ type: [String], description: 'AttributeValue UUIDs' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  valueIds!: string[];
}

export class GenerateVariantsReqDto {
  @ApiProperty({ example: 'TSHIRT', maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  skuPrefix!: string;

  @ApiPropertyOptional({ example: '199000.00', default: '0.00' })
  @IsOptional()
  @IsString()
  basePrice?: string;

  @ApiProperty({ type: [VariantGenerationAxisInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VariantGenerationAxisInputDto)
  axes!: VariantGenerationAxisInputDto[];

  @ApiPropertyOptional({
    example: { Black: 'BLK', White: 'WHT', M: 'M', L: 'L' },
    description:
      'Optional map of attribute value text to custom SKU token (e.g. {"Black":"BLK","White":"WHT"})',
  })
  @IsOptional()
  skuTokens?: Record<string, string>;
}

export class UpdateVariantReqDto {
  @ApiPropertyOptional({ example: 'TSHIRT-BLK-M-V2', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  skuCode?: string;

  @ApiPropertyOptional({
    example: '8938505974192',
    maxLength: 64,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  name?: string;

  @ApiPropertyOptional({ example: '219000.00' })
  @IsOptional()
  @IsString()
  basePrice?: string;

  @ApiPropertyOptional({ example: '0.280', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  weight?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class UpdateVariantStatusReqDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status!: VariantStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class CreateUnitConversionReqDto {
  @ApiProperty({ example: 'Pack (6)', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  unitName!: string;

  @ApiProperty({
    example: '6.0000',
    description: 'Positive conversion factor relative to product base unit',
  })
  @IsString()
  @IsNotEmpty()
  conversionFactor!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isBase?: boolean;
}

export interface VariantAttributeRes {
  attributeId: string;
  attributeName: string;
  attributeValueId: string;
  value: string;
}

export interface VariantRes {
  id: string;
  productId: string;
  skuCode: string;
  barcode: string | null;
  name: string;
  basePrice: string;
  weight: string | null;
  imageUrl: string | null;
  combinationSignature: string;
  isDefault: boolean;
  status: VariantStatus;
  version: number;
  attributes: VariantAttributeRes[];
  createdAt: string;
  updatedAt: string;
}

export interface UnitConversionRes {
  id: string;
  productId: string;
  unitName: string;
  conversionFactor: string;
  isBase: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRes {
  id: string;
  categoryId: string | null;
  brandId: string | null;
  name: string;
  description: string | null;
  baseUnit: string;
  isCombo: boolean;
  status: ProductStatus;
  images: ProductImageMeta[];
  version: number;
  variants?: VariantRes[];
  unitConversions?: UnitConversionRes[];
  createdAt: string;
  updatedAt: string;
}
