import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StockLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

/** `POST /internal/reservations`: the order id is the idempotency key */
export class ReserveStockReqDto {
  @IsUUID()
  orderId!: string;

  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockLineDto)
  lines!: StockLineDto[];
}

export class StockReceiptReqDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockLineDto)
  items!: StockLineDto[];
}

export const STOCK_LEVELS = ['ok', 'below_min', 'out_of_stock'] as const;
export const STOCK_SORTS = ['sku', 'available', 'onHand', 'reserved'] as const;

/** Filters shared by the stock list, its export and the summary */
export class StockFilterDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Searches the SKU */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(STOCK_LEVELS)
  level?: (typeof STOCK_LEVELS)[number];

  @IsOptional()
  @IsIn(STOCK_SORTS)
  sort?: (typeof STOCK_SORTS)[number];

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}

export class ExportStockReqDto extends StockFilterDto {}

export class ListStockReqDto extends StockFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Default 10, at most 100 (api-conventions §5) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class StockSummaryReqDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class StockLookupReqDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;
}
