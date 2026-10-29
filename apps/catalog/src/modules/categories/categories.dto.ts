import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { CategoryStatus } from '../../infrastructure/persistence/catalog.entities';

export class CreateCategoryReqDto {
  @ApiProperty({ example: 'Clothing', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'clothing', maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  slug?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Optional parent category UUID (max depth 3)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateCategoryReqDto {
  @ApiPropertyOptional({ example: 'Men Clothing', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'men-clothing', maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  slug?: string;
}

export class UpdateCategoryStatusReqDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], example: 'INACTIVE' })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: CategoryStatus;

  @ApiPropertyOptional({
    default: false,
    description: 'If true, cascades deactivation to child categories',
  })
  @IsOptional()
  @IsBoolean()
  cascade?: boolean;
}

export class ReparentCategoryReqDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: null,
    description: 'New parent category UUID, or null to move to root level',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId!: string | null;
}

export class ListCategoriesReqDto {
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

  @ApiPropertyOptional({ description: 'Search by category name or slug' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: CategoryStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by parentId' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export interface CategoryRes {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  depth: number;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTreeNodeRes extends CategoryRes {
  children: CategoryTreeNodeRes[];
}
