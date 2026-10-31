import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
import type { DiscountType } from '../../domain/sales-domain';

export class PosCartLineDto {
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  skuCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  productName?: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedUnitPrice?: number;

  @IsOptional()
  @IsIn(['NONE', 'FIXED', 'PERCENT'])
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRatePercent?: number;
}

export class PosQuoteDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

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
}

export class CreatePosDraftDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsArray()
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
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdatePosDraftDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsArray()
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
  @IsString()
  @MaxLength(64)
  couponCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
