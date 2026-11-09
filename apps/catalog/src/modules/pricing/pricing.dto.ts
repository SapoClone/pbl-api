import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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

/** The most branches one price list can name */
export const MAX_PRICE_LIST_BRANCHES = 100;

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

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_PRICE_LIST_BRANCHES,
    description:
      'The branches this price list applies to. Empty or left out: every branch. A branch can have only one active price list (409 PRICE_LIST_BRANCH_CONFLICT), and the default price list cannot be limited to branches.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRICE_LIST_BRANCHES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];
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
    type: [String],
    maxItems: MAX_PRICE_LIST_BRANCHES,
    description:
      'The branches this price list applies to. Empty or left out: every branch. A branch can have only one active price list (409 PRICE_LIST_BRANCH_CONFLICT), and the default price list cannot be limited to branches.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRICE_LIST_BRANCHES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];

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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The branch the price is for. Chooses the active price list of that branch before the default one; without it, only the default price list applies.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
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
  /** The branches the list applies to; empty means every branch */
  branchIds: string[];
  items?: PriceListItemRes[];
  createdAt: string;
  updatedAt: string;
}
