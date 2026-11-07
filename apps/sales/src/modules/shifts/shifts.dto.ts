import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CASH_RESPONSIBILITIES,
  VARIANCE_REASONS,
} from '../../domain/sales-domain';

export class OpenShiftReqDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ example: 'REG-01', default: 'REG-01' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  registerCode?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A register of the branch: its code replaces registerCode and only one open shift is allowed per register',
  })
  @IsOptional()
  @IsUUID()
  registerId?: string;

  @ApiProperty({ example: 1000000, description: 'Integer VND' })
  @IsInt()
  @Min(0)
  openingCash!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CloseShiftReqDto {
  @ApiPropertyOptional({ description: 'The shift version the client saw' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    example: 3750000,
    description:
      'Integer VND. Optional when the drawer was counted with POST /count; a total given here replaces that count',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  actualCash?: number;

  @ApiPropertyOptional({
    enum: VARIANCE_REASONS,
    description: 'Required when the variance is above the tolerance',
  })
  @IsOptional()
  @IsIn([...VARIANCE_REASONS])
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CountShiftReqDto {
  @ApiProperty({
    example: { '500000': 1, '200000': 2, '100000': 3 },
    description: 'Number of notes per denomination',
  })
  @IsObject()
  denominations!: Record<string, number>;

  @ApiPropertyOptional({ description: 'The shift version the client saw' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ApproveCloseReqDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectCloseReqDto {
  @ApiProperty({ description: 'Why the drawer must be counted again' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}

export class CashEntryReqDto {
  @ApiProperty({ enum: ['PAY_IN', 'PAY_OUT'] })
  @IsIn(['PAY_IN', 'PAY_OUT'])
  kind!: 'PAY_IN' | 'PAY_OUT';

  @ApiProperty({ example: 50000, description: 'Integer VND, above 0' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({
    example: 'supplier_payment',
    description: 'A reason code (required)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PatchShiftReqDto {
  @ApiProperty({ description: 'ISO time the shift is planned to end' })
  @IsDateString()
  plannedEndAt!: string;
}

export class AvailableShiftsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateCashSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  toleranceVnd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  approvalAboveVnd?: number;

  @IsOptional()
  @IsIn([...CASH_RESPONSIBILITIES])
  responsibility?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxOpenHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxOpeningFloatVnd?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  denominations?: number[];
}

export class CashShortagesQueryDto {
  @ApiPropertyOptional({ enum: ['staff', 'branch', 'day'], default: 'staff' })
  @IsOptional()
  @IsIn(['staff', 'branch', 'day'])
  groupBy?: 'staff' | 'branch' | 'day';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Day or datetime, UTC+7 days' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;
}

export class ListShiftsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'OPEN, PENDING_CLOSE, PENDING_APPROVAL or CLOSED (several, comma separated)',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description:
      'true: only shifts open longer than maxOpenHours or past plannedEndAt',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
