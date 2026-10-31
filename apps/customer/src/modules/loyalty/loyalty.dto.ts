import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateLoyaltySettingsDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  earnAmountPerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  redeemValuePerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minRedeemPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedeemPointsPerOrder?: number | null;

  @IsOptional()
  @IsInt()
  @Min(30)
  holdTtlSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointsExpirationDays?: number | null;
}

export class ManualLoyaltyAdjustmentDto {
  @IsInt()
  pointsDelta!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreateLoyaltyHoldDto {
  @IsUUID()
  customerId!: string;

  @IsInt()
  @Min(1)
  points!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  sourceRefType?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceRefId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  callerService?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttlSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CommitLoyaltyHoldDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;
}

export class ReleaseLoyaltyHoldDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;
}

/** Screen-contract settings body (PATCH /loyalty-settings). */
export class PatchLoyaltySettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  earnAmountPerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  redeemValuePerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  pointsExpireMonths?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  minRedeemPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedeemPointsPerOrder?: number | null;

  @IsOptional()
  @IsInt()
  @Min(30)
  holdTtlSeconds?: number;
}

/** Screen-contract adjustment body (POST /customers/:id/loyalty-adjustments). */
export class LoyaltyAdjustmentDto {
  @IsInt()
  points!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason!: string;
}

export class ListLoyaltyTransactionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
