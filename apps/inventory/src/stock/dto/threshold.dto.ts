import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../common/list-query.dto';

export class UpsertThresholdReqDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  /** Stored as sent: stock is keyed by SKU until catalog variants are linked */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  /** null clears the threshold */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minQuantity?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  maxQuantity?: number | null;
}

export class ListThresholdsReqDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
