import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSalesChannelDto {
  /** Lower-case slug, e.g. `instagram`; a marketplace type belongs to an integration connection */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,23}$/)
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateSalesChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

export class ListRegistersQueryDto {
  @IsUUID()
  branchId!: string;
}

export class CreateRegisterDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateRegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
