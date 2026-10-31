import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** `Q3-01`: letters, digits and dashes */
export const REGISTER_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;

export class ListRegistersReqDto {
  @IsUUID()
  branchId!: string;
}

export class CreateRegisterReqDto {
  @IsUUID()
  branchId!: string;

  @Matches(REGISTER_CODE)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateRegisterReqDto {
  @IsOptional()
  @Matches(REGISTER_CODE)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
