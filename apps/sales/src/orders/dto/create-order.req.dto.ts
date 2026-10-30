import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'cod'] as const;

export class OrderLineReqDto {
  @ApiProperty({ example: 'SKU-TSHIRT-BLK-M', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 'Classic Black T-Shirt (M)', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  /** Integer VND */
  @ApiProperty({
    example: 150000,
    minimum: 0,
    maximum: 1_000_000_000,
    description: 'Unit price in integer VND',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitPrice!: number;
}

/** The total is computed by the server from the lines, never taken from the client */
export class CreateOrderReqDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: PAYMENT_METHODS, example: 'cash' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ example: 'Nguyen Van A', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @ApiProperty({ type: [OrderLineReqDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineReqDto)
  items!: OrderLineReqDto[];
}

export class CheckoutLineReqDto {
  @ApiProperty({
    format: 'uuid',
    example: '33333333-3333-4333-8333-333333333333',
  })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 'SKU-TSHIRT-BLK-M', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 'Classic Black T-Shirt (M)', maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({
    example: '2.000',
    description: 'Positive decimal string with up to 3 decimal places',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,3})?$/, {
    message:
      'qty must be a positive decimal string with up to 3 decimal places',
  })
  qty!: string;

  @ApiProperty({
    example: 150000,
    minimum: 0,
    maximum: 1_000_000_000,
    description: 'Unit price in integer VND',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitPrice!: number;
}

export class CreateCheckoutReqDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '22222222-2222-4222-8222-222222222222',
  })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: PAYMENT_METHODS, example: 'card' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ example: 'Nguyen Van A', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiProperty({ type: [CheckoutLineReqDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineReqDto)
  items!: CheckoutLineReqDto[];
}
