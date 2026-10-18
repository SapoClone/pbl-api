import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

export class ListStockReqDto {
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

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
