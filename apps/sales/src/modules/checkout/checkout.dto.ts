import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { DiscountType, TenderMethod } from '../../domain/sales-domain';
import { PosCartLineDto } from '../pos/pos.dto';

export class PosTenderItemDto {
  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET', 'COD'])
  method!: Exclude<TenderMethod, 'COMBINED'>;

  @IsInt()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tenderedCash?: number;

  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED'])
  status?: 'PENDING' | 'CONFIRMED';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class PosCheckoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsUUID()
  branchId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  draftId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosCartLineDto)
  lines!: PosCartLineDto[];

  @IsOptional()
  @IsIn(['NONE', 'FIXED', 'PERCENT'])
  orderDiscountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderDiscountValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  shippingFee?: number;

  @IsOptional()
  @IsString()
  discountApprovedBy?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosTenderItemDto)
  tenders?: PosTenderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tenderedCash?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  simulateFailureAfterReserve?: boolean;

  @IsOptional()
  @IsBoolean()
  simulateFailureAfterCommit?: boolean;
}

export class ConfirmCheckoutPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRef?: string;
}
