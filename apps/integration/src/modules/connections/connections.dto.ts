import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { MarketplaceProvider } from '../../domain/integration-domain';

export class CreateChannelConnectionDto {
  @IsIn(['SHOPEE', 'LAZADA'])
  provider!: MarketplaceProvider;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  externalShopId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  shopName?: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  safetyStockBuffer?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  stockAllocationPercent?: number;

  @IsOptional()
  @IsBoolean()
  autoSyncInventory?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  webhookSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  partnerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

export class UpdateChannelConnectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  shopName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  warehouseId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  safetyStockBuffer?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  stockAllocationPercent?: number;

  @IsOptional()
  @IsBoolean()
  autoSyncInventory?: boolean;
}

export class AuthorizeChannelConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirectUri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  authorizationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  stateNonce?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalShopId?: string;
}

export class LazadaOAuthCallbackQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  error_description?: string;
}

export class RefreshConnectionTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  workerId?: string;
}
