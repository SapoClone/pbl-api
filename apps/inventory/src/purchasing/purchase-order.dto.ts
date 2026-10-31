import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { DatedPageQueryDto, DateRangeQueryDto } from '../common/list-query.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PurchaseOrderLineDto {
  /** Stored as sent (stock is keyed by SKU in this release) */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unitName?: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantityOrdered!: number;

  /** Integer VND per unit, before VAT */
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitCost!: number;

  /** Whole-number percentage, 0-10 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  vatRate: number = 0;
}

class PurchaseOrderFields {
  @IsOptional()
  @Matches(DATE)
  expectedDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  noteToSupplier?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  depositAmount?: number;
}

export class CreatePurchaseOrderReqDto extends PurchaseOrderFields {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  items!: PurchaseOrderLineDto[];

  /** true creates the order as `pending_approval` instead of `draft` */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdatePurchaseOrderReqDto extends PurchaseOrderFields {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Replaces all lines */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  items?: PurchaseOrderLineDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class PurchaseOrderActionReqDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** Used by `cancel` */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const PAYMENT_METHODS = [
  'cash',
  'transfer',
  'card',
  'e_wallet',
] as const;

export class CreatePaymentReqDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsIn(PAYMENT_METHODS)
  method!: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export const PO_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'partially_received',
  'received',
  'cancelled',
] as const;
export const PO_SORTS = ['createdAt', 'expectedDate', 'totalAmount'] as const;

export class PurchaseOrderFilterDto extends DatedPageQueryDto {
  @IsOptional()
  @IsIn(PO_STATUSES)
  status?: (typeof PO_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(PO_SORTS)
  sort?: (typeof PO_SORTS)[number];
}

export class ExportPurchaseOrdersReqDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PO_STATUSES)
  status?: (typeof PO_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Matches(DATE)
  from?: string;

  @IsOptional()
  @Matches(DATE)
  to?: string;

  @IsOptional()
  @IsIn(PO_SORTS)
  sort?: (typeof PO_SORTS)[number];

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}

export class PurchaseOrderSummaryReqDto extends DateRangeQueryDto {}
