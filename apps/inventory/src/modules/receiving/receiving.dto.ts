import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateStockReceiptItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '10.000',
    description: 'Quantity in packaging or base unit (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  qty!: string;

  @ApiPropertyOptional({
    example: 100000,
    description: 'Unit cost per base unit (integer VND)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ default: 'PCS', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  unitName?: string;

  @ApiPropertyOptional({
    default: '1.0000',
    description: 'Conversion factor to base unit (NUMERIC(18,4))',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  conversionFactor?: string;
}

export class CreateStockReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ example: 'PNK-001', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({
    enum: ['MANUAL', 'PURCHASE_ORDER', 'RETURN', 'ADJUSTMENT'],
    default: 'MANUAL',
  })
  @IsOptional()
  @IsIn(['MANUAL', 'PURCHASE_ORDER', 'RETURN', 'ADJUSTMENT'])
  sourceType?: 'MANUAL' | 'PURCHASE_ORDER' | 'RETURN' | 'ADJUSTMENT';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, immediately posts the receipt in the same transaction',
  })
  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @ApiProperty({ type: () => [CreateStockReceiptItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateStockReceiptItemDto)
  items!: CreateStockReceiptItemDto[];
}
