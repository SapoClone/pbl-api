import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  /** Exact event type, e.g. `platform.account.logged_in` */
  @ApiPropertyOptional({
    example: 'platform.account.logged_in',
    maxLength: 150,
    description: 'Filter audit logs by exact domain event type',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  type?: string;
}

/** `from` and `to` are YYYY-MM-DD, both inclusive; the default is the last 7 days */
export class SalesSummaryReqDto {
  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Start date (YYYY-MM-DD, inclusive)',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-27',
    description: 'End date (YYYY-MM-DD, inclusive)',
  })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional branch UUID filter',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
