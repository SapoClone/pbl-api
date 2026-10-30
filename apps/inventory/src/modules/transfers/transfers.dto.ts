import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateStockTransferItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '20.000',
    description: 'Quantity to transfer (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  qty!: string;
}

export class CreateStockTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toWarehouseId!: string;

  @ApiPropertyOptional({ example: 'PCK-001', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ type: () => [CreateStockTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferItemDto)
  items!: CreateStockTransferItemDto[];
}

export class ReceiveStockTransferLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '8.000',
    description:
      'Quantity physically received into destination (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  receivedQty!: string;

  @ApiPropertyOptional({
    example: '2.000',
    description: 'Optional lost/damaged discrepancy quantity (NUMERIC(18,3))',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  discrepancyQty?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  discrepancyReason?: string;
}

export class ReceiveStockTransferDto {
  @ApiPropertyOptional({
    type: () => [ReceiveStockTransferLineDto],
    description:
      'If omitted, receives the full remaining in-transit quantity for all lines',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockTransferLineDto)
  items?: ReceiveStockTransferLineDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, marks a transfer with recorded discrepancy as resolved (RECEIVED)',
  })
  @IsOptional()
  @IsBoolean()
  resolveDiscrepancy?: boolean;
}
