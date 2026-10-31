import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/page';
import { ProductStatus } from '../entities/catalog.entities';

export const STATUSES = ['active', 'inactive'] as const;
const MAX_MONEY = 1_000_000_000_000;
const CHANNEL = /^[a-z][a-z0-9_]{1,29}$/;

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const csv = () =>
  Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  );
const emptyToNull = () =>
  Transform(({ value }) => (value === '' ? null : value));

export class AttributeValueRefDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(100)
  value!: string;
}

/** One axis of the product: an attribute and the values this product uses */
export class AxisReqDto {
  @IsUUID()
  attributeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  valueIds!: string[];
}

export class ImageReqDto {
  /** Supplied by the client; the first image is the cover */
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(1000)
  url!: string;
}

export class ChannelsMixin {
  /** Channels the variants are listed on; the others are unlisted */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CHANNEL, { each: true, message: 'each channel must be snake_case' })
  channels?: string[];
}

export class VariantReqDto extends ChannelsMixin {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  skuCode!: string;

  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @trim()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  /** Integer VND */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  price?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  costPrice?: number | null;

  /** Grams */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000_000)
  weight?: number | null;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  /** Attribute values by id (resolved to name/value) ... */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  attributeValueIds?: string[];

  /** ... or by label, as the variant stores them */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttributeValueRefDto)
  attributes?: AttributeValueRefDto[];
}

export class CreateProductReqDto extends ChannelsMixin {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Prefix of generated SKUs; the SKU of the one default variant when none are given */
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  baseSku?: string;

  /** Barcode, price, cost and weight of the one default variant */
  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @trim()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  price?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  costPrice?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weight?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  baseUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  isCombo?: boolean;

  /** The axes of the product (attribute and value ids) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AxisReqDto)
  attributes?: AxisReqDto[];

  /** With axes: the server creates every combination as `<baseSku>-<value codes>` */
  @IsOptional()
  @IsBoolean()
  generateVariants?: boolean;

  /** Else the client sends the variants */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VariantReqDto)
  variants?: VariantReqDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImageReqDto)
  images?: ImageReqDto[];
}

export class UpdateProductReqDto extends ChannelsMixin {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  brandId?: string | null;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  baseUnit?: string;

  /** Also sets the status of every variant */
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  /** The ordered list replaces the current images */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImageReqDto)
  images?: ImageReqDto[];
}

export class UpdateVariantReqDto extends ChannelsMixin {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  skuCode?: string;

  @IsOptional()
  @emptyToNull()
  @ValidateIf((_, value) => value !== null)
  @trim()
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  price?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  costPrice?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weight?: number | null;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;
}

export const PRODUCT_SORTS = ['createdAt', 'price', 'name', 'skuCode'] as const;

export class ListProductsReqDto extends PageQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  /** Includes the sub-categories */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  /** Comma-separated: `pos,shopee` (any of them) */
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CHANNEL, { each: true })
  channel?: string[];

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: (typeof PRODUCT_SORTS)[number] = 'createdAt';

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}

/** Same filters, but no paging: the export takes everything up to the cap */
export class ExportProductsReqDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(CHANNEL, { each: true })
  channel?: string[];

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: (typeof PRODUCT_SORTS)[number] = 'createdAt';

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}

/** `GET /variants`: the picker of POS, manual orders and receipts */
export class ListVariantsReqDto extends PageQueryDto {
  /** Exact match */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  /** Exact match */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids?: string[];

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
