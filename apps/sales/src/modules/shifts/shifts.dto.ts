import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

const MONEY_REGEX = /^\d+(\.\d{1,2})?$/;

export class OpenShiftReqDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ example: 'REG-01', default: 'REG-01' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  registerCode?: string;

  @ApiProperty({ example: '1000000.00' })
  @Matches(MONEY_REGEX, {
    message: 'openingCash must be a non-negative VND amount',
  })
  openingCash!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CloseShiftReqDto {
  @ApiProperty({ example: '3750000.00' })
  @Matches(MONEY_REGEX, {
    message: 'actualCash must be a non-negative VND amount',
  })
  actualCash!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListShiftsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsString()
  status?: string;

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
