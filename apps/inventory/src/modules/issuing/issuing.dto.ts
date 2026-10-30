import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateStockIssueItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '2.000',
    description: 'Quantity to issue in base unit (NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  qty!: string;
}

export class CreateStockIssueDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ example: 'PXK-001', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiProperty({
    enum: [
      'MANUAL_WITHDRAWAL',
      'DAMAGED',
      'DISPOSAL',
      'SAMPLE',
      'SUPPLIER_RETURN',
    ],
    example: 'DAMAGED',
  })
  @IsIn([
    'MANUAL_WITHDRAWAL',
    'DAMAGED',
    'DISPOSAL',
    'SAMPLE',
    'SUPPLIER_RETURN',
  ])
  reasonCode!:
    | 'MANUAL_WITHDRAWAL'
    | 'DAMAGED'
    | 'DISPOSAL'
    | 'SAMPLE'
    | 'SUPPLIER_RETURN';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @ApiProperty({ type: () => [CreateStockIssueItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateStockIssueItemDto)
  items!: CreateStockIssueItemDto[];
}
