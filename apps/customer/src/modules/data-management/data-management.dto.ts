import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MergeCustomersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceCustomerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetCustomerId!: string;

  @ApiPropertyOptional({ example: 'Duplicate phone / email profile' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({ example: 'merge-idem-001' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ImportCustomerRowDto {
  @ApiPropertyOptional({ example: 'KH000100' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiProperty({ example: 'Tran Thi B' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ example: '0987654321' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'tranthib@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ example: 'POS' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;

  @ApiPropertyOptional({ example: 'VIP customer' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateImportJobDto {
  @ApiPropertyOptional({ type: [ImportCustomerRowDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerRowDto)
  rows?: ImportCustomerRowDto[];

  @ApiPropertyOptional({
    description:
      'Raw CSV string with header: code,name,phone,email,source,note',
  })
  @IsOptional()
  @IsString()
  csvContent?: string;

  @ApiPropertyOptional({ enum: ['SKIP', 'UPDATE'], default: 'SKIP' })
  @IsOptional()
  @IsIn(['SKIP', 'UPDATE'])
  conflictPolicy?: 'SKIP' | 'UPDATE';
}

export class CreateExportJobDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ANONYMIZED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ANONYMIZED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerGroupId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipTierId?: string;
}
