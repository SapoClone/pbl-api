import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../common/page';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class ListCategoriesReqDto extends PageQueryDto {
  /** Children of this category; `root` for the top level */
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class CreateCategoryReqDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}

export class UpdateCategoryReqDto {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}

export class NameReqDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;
}

export class UpdateBrandReqDto extends NameReqDto {}

export class CreateAttributeValueReqDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;

  /** Used in generated SKUs; defaults to the value in capitals */
  @IsOptional()
  @trim()
  @Matches(/^[A-Za-z0-9]{1,30}$/, {
    message: 'code must be 1-30 letters or digits',
  })
  code?: string;
}

export interface CategoryRes {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  productCount: number;
  createdAt: string;
}

export interface BrandRes {
  id: string;
  name: string;
  createdAt: string;
}

export interface AttributeRes {
  id: string;
  name: string;
  values: { id: string; value: string; code: string }[];
}
