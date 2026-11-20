import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { SkuMappingStatus } from '../../domain/integration-domain';

export class CreateSkuMappingDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalItemId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalSkuId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalSkuCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalProductName?: string;

  @IsUUID()
  internalVariantId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  externalPrice?: number;

  @IsOptional()
  @IsIn(['MANUAL', 'EXACT_SKU_AUTO'])
  mappingMode?: 'MANUAL' | 'EXACT_SKU_AUTO';
}

export class UpdateSkuMappingDto {
  @IsOptional()
  @IsUUID()
  internalVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalSkuCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalProductName?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'CONFLICT', 'NEEDS_REVIEW'])
  status?: SkuMappingStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  externalPrice?: number;
}

export class AutoMatchSelectedPairDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalItemId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalSkuId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalSkuCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalProductName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  externalPrice?: number;

  @IsUUID()
  internalVariantId!: string;
}

export class AutoMatchSkuMappingsDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AutoMatchSelectedPairDto)
  selectedPairs?: AutoMatchSelectedPairDto[];
}
