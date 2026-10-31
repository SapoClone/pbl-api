import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** D5 `paymentMethod`; the first four are what the counter always accepted */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'cod',
  'e_wallet',
  'marketplace',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CREATE_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'completed',
] as const;
export const ORDER_SOURCES = ['pos', 'manual'] as const;
export const CHANNEL_CODE = /^[a-z][a-z0-9_]{0,29}$/;
const PHONE = /^[0-9+][0-9 .-]{5,18}$/;

export class OrderLineReqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  /** Bare catalog variant id; stored as sent, not checked (catalog is another service) */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;

  /** Integer VND */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitPrice!: number;
}

export class ShippingReqDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  recipientName?: string;

  @IsOptional()
  @Matches(PHONE)
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  /** Stable code from GET /shipping-providers (`ghn`, `self_delivery`, ...) */
  @IsOptional()
  @Matches(CHANNEL_CODE)
  shippingProviderCode?: string;

  /** Integer VND */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  shippingFee?: number;

  /** Who bears the fee: `customer` (added to the total, default) or `shop` */
  @IsOptional()
  @IsIn(['customer', 'shop'])
  feePayer?: 'customer' | 'shop';
}

export class PaymentReqDto {
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  /** Integer VND, above 0 */
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount!: number;
}

/** Fields shared by creating an order and editing a draft. All are optional and additive. */
export class OrderFieldsReqDto {
  @IsOptional()
  @IsIn(ORDER_SOURCES)
  source?: (typeof ORDER_SOURCES)[number];

  /** Stable channel code from GET /sales-channels; defaults to `pos` */
  @IsOptional()
  @Matches(CHANNEL_CODE)
  channel?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  customerName?: string;

  @IsOptional()
  @Matches(PHONE)
  customerPhone?: string;

  @IsOptional()
  @IsUUID()
  registerId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingReqDto)
  shipping?: ShippingReqDto;

  /** Order-level discount, integer VND */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  discountAmount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentReqDto)
  payments?: PaymentReqDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** The totals are computed by the server from the lines, never taken from the client */
export class CreateOrderReqDto extends OrderFieldsReqDto {
  @IsUUID()
  branchId!: string;

  /** Optional: defaults to the first payment's method, else `cash` */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  /** `draft` reserves nothing, `confirmed` reserves stock, `completed` (default) sells at once */
  @IsOptional()
  @IsIn(CREATE_ORDER_STATUSES)
  orderStatus?: (typeof CREATE_ORDER_STATUSES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineReqDto)
  items!: OrderLineReqDto[];
}

/** Edits a draft; `orderStatus: confirmed | completed` finalises it */
export class UpdateOrderReqDto extends OrderFieldsReqDto {
  /** Optimistic lock: 409 when the order changed since it was read */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsIn(['confirmed', 'completed'])
  orderStatus?: 'confirmed' | 'completed';

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineReqDto)
  items?: OrderLineReqDto[];
}

export class ActionReqDto {
  /** Optimistic lock: 409 when the order changed since it was read */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ShipReqDto extends ActionReqDto {
  @IsOptional()
  @Matches(CHANNEL_CODE)
  shippingProviderCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  trackingCode?: string;
}

export class CancelReqDto extends ActionReqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class AddPaymentReqDto extends ActionReqDto {
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  /** Integer VND; a negative amount records a refund */
  @IsInt()
  @Min(-1_000_000_000_000)
  @Max(1_000_000_000_000)
  amount!: number;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
