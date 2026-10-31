import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

  @ApiProperty({ example: 3750000, description: 'Integer VND' })
  @IsInt()
  @Min(0)
  actualCash!: number;

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
