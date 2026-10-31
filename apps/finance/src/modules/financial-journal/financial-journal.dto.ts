import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateFinancialAccountDto {
  @IsString()
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn([
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'REVENUE',
    'CONTRA_REVENUE',
    'EXPENSE',
  ])
  accountType!:
    | 'ASSET'
    | 'LIABILITY'
    | 'EQUITY'
    | 'REVENUE'
    | 'CONTRA_REVENUE'
    | 'EXPENSE';

  @IsIn(['DEBIT', 'CREDIT'])
  normalSide!: 'DEBIT' | 'CREDIT';
}

export class PostJournalLineDto {
  @IsString()
  @MaxLength(32)
  accountCode!: string;

  @IsOptional()
  @IsNumberString()
  debitAmount?: string;

  @IsOptional()
  @IsNumberString()
  creditAmount?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'CARRIER'])
  partyType?: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

export class PostJournalDto {
  @IsString()
  @MaxLength(32)
  journalType!: string;

  @IsString()
  @MaxLength(48)
  sourceType!: string;

  @IsString()
  @MaxLength(128)
  sourceId!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PostJournalLineDto)
  lines!: PostJournalLineDto[];
}

export class ReverseJournalDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ListJournalsQueryDto {
  @IsOptional()
  @IsString()
  journalType?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['POSTED', 'REVERSED'])
  status?: 'POSTED' | 'REVERSED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
