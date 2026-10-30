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

export class CreateStocktakeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ example: 'PKK-001', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  freezeMovement?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional list of SKU UUIDs to snapshot immediately',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skuIds?: string[];
}

export class RecordStocktakeCountLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({
    example: '75.000',
    description: 'Physically counted quantity (non-negative NUMERIC(18,3))',
  })
  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/)
  countedQty!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class RecordStocktakeCountsDto {
  @ApiProperty({ type: () => [RecordStocktakeCountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecordStocktakeCountLineDto)
  counts!: RecordStocktakeCountLineDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'If true, refreshes snapshot version to current stock_balance version when recording counts',
  })
  @IsOptional()
  @IsBoolean()
  refreshSnapshot?: boolean;
}

export class ApproveStocktakeDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Default false: rejects with 409 STOCKTAKE_STALE_SNAPSHOT if stock moved since snapshot was captured',
  })
  @IsOptional()
  @IsBoolean()
  forceRebase?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
