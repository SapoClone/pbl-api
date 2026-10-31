import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';

export const ORDER_STATUSES = [
  'draft',
  'new',
  'confirmed',
  'completed',
  'cancelled',
] as const;
export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'refunded',
  'unreconciled',
] as const;
export const FULFILLMENT_STATUSES = [
  'unfulfilled',
  'packing',
  'shipping',
  'delivered',
  'returned',
] as const;
export const ORDER_TABS = [
  'new',
  'confirmed',
  'packing',
  'shipping',
  'completed',
  'needs_action',
  'processing',
] as const;
export const ORDER_SORTS = ['createdAt', 'totalAmount'] as const;

/** `a,b` or `a&a=b` become a list; the elements are checked with `each` */
const list = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parts = Array.isArray(value) ? value : String(value).split(',');
    return parts.map((p: string) => p.trim()).filter(Boolean);
  });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters shared by the list, the summary and the export */
export class OrderFiltersReqDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Searches code, external order code, customer name and phone */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(ORDER_TABS)
  tab?: (typeof ORDER_TABS)[number];

  @IsOptional()
  @list()
  @IsIn(ORDER_STATUSES, { each: true })
  orderStatus?: string[];

  @IsOptional()
  @list()
  @IsIn(PAYMENT_STATUSES, { each: true })
  paymentStatus?: string[];

  @IsOptional()
  @list()
  @IsIn(FULFILLMENT_STATUSES, { each: true })
  fulfillmentStatus?: string[];

  /** Channel codes: `pos,website` */
  @IsOptional()
  @list()
  @Matches(/^[a-z][a-z0-9_]{0,29}$/, { each: true })
  channel?: string[];

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  registerId?: string;

  /** YYYY-MM-DD, inclusive, in Asia/Ho_Chi_Minh */
  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
  to?: string;
}

export class ListOrdersReqDto extends OrderFiltersReqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Default 10, at most 100 (api-conventions §5) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort?: (typeof ORDER_SORTS)[number];

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
}

/** The summary and the export take the filters only */
export class OrderSummaryReqDto extends OrderFiltersReqDto {}
