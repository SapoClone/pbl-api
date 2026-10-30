import {
  IsBoolean,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCashbookCategoryDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(['RECEIPT', 'EXPENSE'])
  direction!: 'RECEIPT' | 'EXPENSE';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  glAccountCode?: string;
}

export class CreateCashbookVoucherDto {
  @IsUUID()
  cashAccountId!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  categoryCode?: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  voucherType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sourceId?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'CARRIER'])
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceDoc?: string;

  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class PostCashbookEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ReverseCashbookEntryDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ListCashbookEntriesQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(['RECEIPT', 'EXPENSE'])
  direction?: 'RECEIPT' | 'EXPENSE';

  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'])
  status?: 'DRAFT' | 'APPROVED' | 'POSTED' | 'REVERSED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
