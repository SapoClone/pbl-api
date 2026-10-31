import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ListAuditLogsReqDto {
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

  /** Exact event type, e.g. `platform.account.logged_in` */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  type?: string;
}

/** `from` and `to` are YYYY-MM-DD, both inclusive; the default is the last 7 days */
export class SalesSummaryReqDto {
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @Matches(DAY)
  to?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const GROUP_BY = ['day', 'day_channel'] as const;

/** `GET /sales-summary/daily`: `groupBy=day_channel` adds the channel dimension */
export class DailySalesReqDto extends SalesSummaryReqDto {
  @IsOptional()
  @IsIn(GROUP_BY)
  groupBy?: (typeof GROUP_BY)[number];
}

export class KpisReqDto {
  /** YYYY-MM-DD, default today (UTC+7) */
  @IsOptional()
  @Matches(DAY)
  date?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class HourlyReqDto extends KpisReqDto {
  /** Default: the day before `date` */
  @IsOptional()
  @Matches(DAY)
  compareDate?: string;
}

/** `from`/`to` inclusive YYYY-MM-DD; the default is today */
export class RangeReqDto extends SalesSummaryReqDto {}

export const PRODUCT_SORTS = ['revenue', 'quantity'] as const;

export class TopProductsReqDto extends RangeReqDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 5;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: (typeof PRODUCT_SORTS)[number] = 'revenue';
}

export const REPORTS = ['daily', 'by_channel', 'top_products'] as const;

export class ExportReqDto extends RangeReqDto {
  @IsIn(REPORTS)
  report!: (typeof REPORTS)[number];
}

export class AttentionItemsReqDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 4;
}
