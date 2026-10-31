import { OmitType } from '@nestjs/swagger';
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
  @IsInt()
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
  @IsInt()
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

  /** Same as `expectedVersion`, under the screen contract's name */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** `confirmed` finalises the draft after the update (reserves stock) */
  @IsOptional()
  @IsIn(['confirmed'])
  orderStatus?: 'confirmed';

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class ConfirmOrderDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** The order version the client saw (screen contract); a stale one is 409 */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

/** A line of the internal order route: the marketplace's own price may replace the catalog price */
export class InternalOrderLineDto extends PosCartLineDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceOverride?: number;
}

/** Body of `POST /internal/v1/orders/omnichannel` (integration -> sales) */
export class InternalOmnichannelOrderDto extends OmitType(
  CreateOmnichannelOrderDto,
  ['lines'] as const,
) {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLineDto)
  lines!: InternalOrderLineDto[];

  @IsOptional()
  @IsIn(['sku_unmapped', 'stock_shortage'])
  exceptionCode?: 'sku_unmapped' | 'stock_shortage';
}
