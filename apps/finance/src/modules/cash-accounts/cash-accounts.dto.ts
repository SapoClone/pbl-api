import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCashAccountDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['CASH_DRAWER', 'SAFE', 'BANK', 'E_WALLET'])
  accountType?: 'CASH_DRAWER' | 'SAFE' | 'BANK' | 'E_WALLET';

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;
}

export class UpdateCashAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'CLOSED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;
}

export class ListCashAccountsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'CLOSED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';

  @IsOptional()
  @IsIn(['CASH_DRAWER', 'SAFE', 'BANK', 'E_WALLET'])
  accountType?: 'CASH_DRAWER' | 'SAFE' | 'BANK' | 'E_WALLET';
}
