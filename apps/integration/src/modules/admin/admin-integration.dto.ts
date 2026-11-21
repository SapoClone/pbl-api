import { Transform, Type } from 'class-transformer';
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
  MinLength,
} from 'class-validator';
import {
  CONNECTION_STATUSES,
  JOB_STATUSES,
  JOB_TYPES,
  PROVIDERS,
  WEBHOOK_STATUSES,
} from './admin-integration.mapper';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AdminPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}

export class ListAdminConnectionsQueryDto extends AdminPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @IsOptional()
  @IsIn(CONNECTION_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ListSyncHistoryQueryDto extends AdminPageQueryDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(JOB_TYPES)
  jobType?: string;

  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class ListWebhookEventsQueryDto extends AdminPageQueryDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @IsOptional()
  @IsIn(WEBHOOK_STATUSES)
  status?: string;

  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class AdminDisconnectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
