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

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'cod'] as const;

export class OrderLineReqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  /** Integer VND */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitPrice!: number;
}

/** The total is computed by the server from the lines, never taken from the client */
export class CreateOrderReqDto {
  @IsUUID()
  branchId!: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineReqDto)
  items!: OrderLineReqDto[];
}
