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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PriceListStatus } from '../../domain/catalog-domain';

export class CreatePriceListReqDto {
  @ApiProperty({ example: 'Retail Default Price List', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'VND', default: 'VND' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: PriceListStatus;

  @ApiPropertyOptional({ example: '2026-01-01', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be formatted as YYYY-MM-DD',
  })
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be formatted as YYYY-MM-DD',
  })
  endDate?: string | null;
}

export class UpdatePriceListReqDto {
  @ApiPropertyOptional({ example: 'Retail Holiday Price List', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'VND' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: PriceListStatus;

  @ApiPropertyOptional({ example: '2026-01-01', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate must be formatted as YYYY-MM-DD',
  })
  startDate?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate must be formatted as YYYY-MM-DD',
  })
  endDate?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic locking',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class PriceListItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 199000, description: 'Whole VND' })
  @IsInt()
  @Min(0)
  price!: number;
}

export class UpsertPriceListItemsReqDto {
  @ApiProperty({ type: [PriceListItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PriceListItemInputDto)
  items!: PriceListItemInputDto[];
}

export class ResolveVariantPriceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  priceListId?: string;

  @ApiPropertyOptional({
    example: '2026-10-29',
    description: 'ISO date (YYYY-MM-DD) for effective date evaluation',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOfDate must be formatted as YYYY-MM-DD',
  })
  asOfDate?: string;
}

export interface PriceListItemRes {
  id: string;
  priceListId: string;
  variantId: string;
  skuCode?: string;
  price: number;
  version: number;
  updatedAt: string;
}

export interface PriceListRes {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  status: PriceListStatus;
  startDate: string | null;
  endDate: string | null;
  version: number;
  items?: PriceListItemRes[];
  createdAt: string;
  updatedAt: string;
}
