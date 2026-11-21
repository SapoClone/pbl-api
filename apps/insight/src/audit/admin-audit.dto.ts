import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** `GET /admin/audit-logs` (platform admin). `from`/`to` are YYYY-MM-DD in Asia/Ho_Chi_Minh, both inclusive */
export class ListAdminAuditLogsReqDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      'Searches the action code, the target label and the actor name',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: ['platform', 'tenant'],
    description:
      '`platform`: rows that belong to no store; `tenant`: store rows',
  })
  @IsOptional()
  @IsIn(['platform', 'tenant'])
  scope?: 'platform' | 'tenant';

  @ApiPropertyOptional({ format: 'uuid', description: 'Rows of one store' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ enum: ['success', 'failed'] })
  @IsOptional()
  @IsIn(['success', 'failed'])
  result?: 'success' | 'failed';

  @ApiPropertyOptional({
    example: 'tenant.updated',
    description: 'One action code (see /admin/audit-logs/actions)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Rows by one actor' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-20' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}
