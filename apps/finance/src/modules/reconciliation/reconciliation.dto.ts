import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReconcileShiftCashDto {
  @IsUUID()
  shiftId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  shiftCode?: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  staffId?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsInt()
  openingCash!: number;

  @IsInt()
  confirmedCashSales!: number;

  @IsOptional()
  @IsInt()
  confirmedCashRefunds?: number;

  @IsOptional()
  @IsInt()
  otherCashReceipts?: number;

  @IsOptional()
  @IsInt()
  otherCashExpenses?: number;

  @IsInt()
  actualCountedCash!: number;
}

export class CreateFinancialAdjustmentDto {
  @IsString()
  @MaxLength(32)
  adjustmentType!: string;

  @IsIn(['RECEIVABLE', 'PAYABLE', 'CASH_ACCOUNT'])
  targetType!: 'RECEIVABLE' | 'PAYABLE' | 'CASH_ACCOUNT';

  @IsUUID()
  targetId!: string;

  @IsInt()
  amount!: number;

  @IsIn(['DECREASE', 'INCREASE'])
  direction!: 'DECREASE' | 'INCREASE';

  @IsString()
  @MaxLength(48)
  reasonCode!: string;

  @IsString()
  @MaxLength(500)
  explanation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class TriggerReconciliationRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  reconciliationType?: string;
}

export class ResolveReconciliationIssueDto {
  @IsString()
  @MaxLength(500)
  resolutionNote!: string;

  @IsOptional()
  @IsIn(['INVESTIGATING', 'RESOLVED', 'IGNORED'])
  status?: 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
}

export class ListReconciliationIssuesQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED'])
  status?: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';

  @IsOptional()
  @IsString()
  issueType?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
