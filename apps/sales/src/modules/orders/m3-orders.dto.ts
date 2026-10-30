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
import type { DiscountType, SalesChannelType } from '../../domain/sales-domain';
import { PosCartLineDto } from '../pos/pos.dto';

export class CreateOmnichannelOrderDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsIn(['POS', 'MANUAL', 'ONLINE', 'MARKETPLACE'])
  channelType!: SalesChannelType;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceConnectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalOrderId?: string;

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
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PENDING'])
  initialStatus?: 'DRAFT' | 'PENDING';

  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateDraftOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosCartLineDto)
  lines?: PosCartLineDto[];

  @IsOptional()
  @IsIn(['NONE', 'FIXED', 'PERCENT'])
  orderDiscountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderDiscountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class ConfirmOrderDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
