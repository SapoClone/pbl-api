import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * What the staff-sales reports look at. `from` and `to` are days (`2026-11-05`, counted in UTC+7, `to` included) or
 * datetimes; none means no bound. Only completed orders count; a POS order unless `channelType` says otherwise.
 */
export class StaffSalesQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** One cashier shift: the sales rung up while that register session was open */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-05' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: ['POS', 'ALL'],
    default: 'POS',
    description:
      '`POS` counts what staff rang up; `ALL` adds online orders, which carry the integration as their creator',
  })
  @IsOptional()
  @IsIn(['POS', 'ALL'])
  channelType?: 'POS' | 'ALL';
}
