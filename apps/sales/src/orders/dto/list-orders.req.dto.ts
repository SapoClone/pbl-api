import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `a,b` or `a&a=b` into `['a', 'b']` */
const toList = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || value === ''
    ? undefined
    : (Array.isArray(value) ? value : [value])
        .flatMap((v) => String(v).split(','))
        .map((v) => v.trim())
        .filter(Boolean);

export const LIST_TABS = [
  'all',
  'new',
  'confirmed',
  'packing',
  'shipping',
  'completed',
  'needs_action',
  'processing',
] as const;
export type ListTab = (typeof LIST_TABS)[number];

export class ListOrdersReqDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Default 10, at most 100 (api-conventions §5) */
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter orders by branch UUID',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Searches code, external order code and customer name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: LIST_TABS })
  @IsOptional()
  @IsIn(LIST_TABS)
  tab?: ListTab;

  @ApiPropertyOptional({
    description: 'Comma separated: draft,new,confirmed,completed,cancelled',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(['draft', 'new', 'confirmed', 'completed', 'cancelled'], {
    each: true,
  })
  orderStatus?: string[];

  @ApiPropertyOptional({
    description:
      'Comma separated: unpaid,partially_paid,paid,refunded,unreconciled',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(['unpaid', 'partially_paid', 'paid', 'refunded', 'unreconciled'], {
    each: true,
  })
  paymentStatus?: string[];

  @ApiPropertyOptional({
    description:
      'Comma separated: unfulfilled,packing,shipping,delivered,returned',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(['unfulfilled', 'packing', 'shipping', 'delivered', 'returned'], {
    each: true,
  })
  fulfillmentStatus?: string[];

  @ApiPropertyOptional({ description: 'Channel types, e.g. pos,shopee' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  channel?: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  registerId?: string;

  @ApiPropertyOptional({
    description: 'ISO date or datetime (a date is UTC+7)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO date or datetime; a date includes that day',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'totalAmount'] })
  @IsOptional()
  @IsIn(['createdAt', 'totalAmount'])
  sort?: 'createdAt' | 'totalAmount';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class OrderSummaryQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class PrintOrderQueryDto {
  @IsOptional()
  @IsIn(['packing_slip', 'receipt'])
  type?: 'packing_slip' | 'receipt';

  @IsOptional()
  @IsIn(['80mm', '58mm'])
  paper?: '80mm' | '58mm';
}
