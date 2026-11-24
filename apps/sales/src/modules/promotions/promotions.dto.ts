import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const PROMOTION_STATUSES = ['ACTIVE', 'INACTIVE'];

export class CreatePromotionDto {
  @IsString()
  @MaxLength(48)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsIn(['FIXED', 'PERCENT'])
  discountType!: 'FIXED' | 'PERCENT';

  @IsNumber()
  @Min(0.01)
  discountValue!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  channelTypes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  customerGroupIds?: string[];

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: 'ACTIVE' | 'INACTIVE';
}

/** Partial update: the promotion code is immutable (a `code` in the body is ignored) */
export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsIn(['FIXED', 'PERCENT'])
  discountType?: 'FIXED' | 'PERCENT';

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  channelTypes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  customerGroupIds?: string[];

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: 'ACTIVE' | 'INACTIVE';
}

export class UpdateCouponDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number | null;

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: 'ACTIVE' | 'INACTIVE';
}

export class EvaluateCouponDto {
  @IsString()
  @MaxLength(48)
  code!: string;

  /** The order amount after line and order discounts, whole VND */
  @IsInt()
  @Min(0)
  orderAmount!: number;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  channelType?: string;

  @IsOptional()
  @IsUUID()
  customerGroupId?: string | null;
}

export class CreateCouponDto {
  @IsUUID()
  promotionId!: string;

  @IsString()
  @MaxLength(48)
  code!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCustomer?: number;

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: 'ACTIVE' | 'INACTIVE';
}
