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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StockLineDto {
  @ApiProperty({ example: 'AO-01', description: 'Product SKU code' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

/** `POST /internal/reservations`: the order id is the idempotency key */
export class ReserveStockReqDto {
  @ApiProperty({
    format: 'uuid',
    example: '33333333-3333-4333-8333-333333333333',
    description: 'Order UUID used as the reservation idempotency key',
  })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: () => [StockLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockLineDto)
  lines!: StockLineDto[];
}

export class StockReceiptReqDto {
  @ApiProperty({
    format: 'uuid',
    example: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
    description: 'Branch UUID receiving stock',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: () => [StockLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StockLineDto)
  items!: StockLineDto[];
}

export class ListStockReqDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Default 10, at most 100 (api-conventions §5) */
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter stock items by branch UUID',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class WarehouseReservationLineDto {
  @ApiProperty({
    format: 'uuid',
    example: '77777777-7777-4777-8777-777777777777',
  })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '2.000',
    description: 'Positive decimal quantity (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/, {
    message: 'qty must be a positive decimal with up to 3 fractional digits',
  })
  qty!: string;
}

/** `POST /internal/v1/reservations` (inventory-reservation.openapi.yaml) */
export class CreateWarehouseReservationDto {
  @ApiProperty({
    enum: ['sales', 'inventory', 'integration'],
    example: 'sales',
  })
  @IsIn(['sales', 'inventory', 'integration'])
  callerService!: 'sales' | 'inventory' | 'integration';

  @ApiProperty({ enum: ['ORDER', 'TRANSFER', 'RETURN'], example: 'ORDER' })
  @IsIn(['ORDER', 'TRANSFER', 'RETURN'])
  sourceRefType!: 'ORDER' | 'TRANSFER' | 'RETURN';

  @ApiProperty({
    format: 'uuid',
    example: '44444444-4444-4444-8444-444444444444',
  })
  @IsUUID()
  sourceRefId!: string;

  @ApiPropertyOptional({ default: 900, minimum: 30, maximum: 86400 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(86400)
  ttlSeconds?: number;

  @ApiProperty({ type: () => [WarehouseReservationLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WarehouseReservationLineDto)
  lines!: WarehouseReservationLineDto[];
}

export class ReleaseWarehouseReservationDto {
  @ApiPropertyOptional({ example: 'CHECKOUT_CANCELLED' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateWarehouseDto {
  @ApiProperty({
    format: 'uuid',
    example: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
  })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 'WH-HCM-01', maxLength: 32 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: 'Kho Trung Tam HCM', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ default: false, example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ReceiveStockBalanceDto {
  @ApiProperty({
    format: 'uuid',
    example: '77777777-7777-4777-8777-777777777777',
  })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
  })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '10.000',
    description: 'Positive decimal quantity received (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/, {
    message: 'qty must be a positive decimal with up to 3 fractional digits',
  })
  qty!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional receipt reference UUID',
  })
  @IsOptional()
  @IsUUID()
  referenceId?: string;
}
