import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateM2WarehouseDto {
  @ApiProperty({ example: 'WH-MAIN', maxLength: 32 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: 'Main Store Warehouse', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    enum: ['BRANCH', 'CENTRAL', 'QUARANTINE'],
    default: 'BRANCH',
  })
  @IsOptional()
  @IsIn(['BRANCH', 'CENTRAL', 'QUARANTINE'])
  kind?: 'BRANCH' | 'CENTRAL' | 'QUARANTINE';

  @ApiPropertyOptional({
    format: 'uuid',
    example: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: '123 Nguyen Hue, District 1, HCMC' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class UpdateM2WarehouseDto {
  @ApiPropertyOptional({ example: 'Updated Warehouse Name', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['BRANCH', 'CENTRAL', 'QUARANTINE'] })
  @IsOptional()
  @IsIn(['BRANCH', 'CENTRAL', 'QUARANTINE'])
  kind?: 'BRANCH' | 'CENTRAL' | 'QUARANTINE';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ListWarehousesQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ enum: ['BRANCH', 'CENTRAL', 'QUARANTINE'] })
  @IsOptional()
  @IsIn(['BRANCH', 'CENTRAL', 'QUARANTINE'])
  kind?: 'BRANCH' | 'CENTRAL' | 'QUARANTINE';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
