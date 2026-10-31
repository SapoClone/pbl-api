import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const STOCK_LEVELS = ['ok', 'below_min', 'out_of_stock'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];
export const STOCK_SORTS = ['available', 'onHand', 'name'] as const;
export const LEDGER_REF_TYPES = [
  'receipt',
  'issue',
  'transfer_out',
  'transfer_in',
  'stock_take',
  'sale',
  'sale_shortfall',
  'reservation_release',
] as const;
export type LedgerRefType = (typeof LEDGER_REF_TYPES)[number];

/** The filters shared by the stock list and its CSV export (contract 02) */
export class StockFilterQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'SKU code, name or barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated catalog variant ids',
    example: 'uuid,uuid',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  variantIds?: string[];

  @ApiPropertyOptional({ enum: STOCK_LEVELS })
  @IsOptional()
  @IsIn(STOCK_LEVELS)
  level?: StockLevel;

  @ApiPropertyOptional({ enum: STOCK_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(STOCK_SORTS)
  sort?: (typeof STOCK_SORTS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class ListStockLevelsQueryDto extends StockFilterQueryDto {
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
}

export class StockSummaryQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Omit for every branch the caller can see',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class StockLookupQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ description: 'SKU or barcode, exact match' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;
}

export class ListLedgerEntriesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiPropertyOptional({ enum: LEDGER_REF_TYPES })
  @IsOptional()
  @IsIn(LEDGER_REF_TYPES)
  refType?: LedgerRefType;

  @ApiPropertyOptional({ description: 'ISO date or timestamp (inclusive)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO date or timestamp (a bare date includes that whole day)',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

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
}

/** `POST /stock-thresholds`: an upsert keyed by (branchId, variantId) */
export class UpsertBranchThresholdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid', description: 'Catalog variant id' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minQuantity!: number;

  @ApiPropertyOptional({ nullable: true, example: null })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  maxQuantity?: number | null;
}
