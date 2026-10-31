import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRefundDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUUID()
  salesRefundRequestId?: string;

  @IsOptional()
  @IsUUID()
  returnId?: string;

  @IsOptional()
  @IsUUID()
  settlementId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'CUSTOMER_CREDIT'])
  method!: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'EWALLET' | 'CUSTOMER_CREDIT';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @IsInt()
  amount!: number;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;

  @IsOptional()
  @IsBoolean()
  autoExecute?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ExecuteRefundDto {
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRefundRef?: string;

  @IsOptional()
  @IsBoolean()
  simulateProviderTimeout?: boolean;

  @IsOptional()
  @IsBoolean()
  requireReconciliationOnTimeout?: boolean;
}

export class ConfirmRefundOutcomeDto {
  @IsIn(['COMPLETED', 'FAILED', 'RECONCILIATION_REQUIRED'])
  outcome!: 'COMPLETED' | 'FAILED' | 'RECONCILIATION_REQUIRED';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRefundRef?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  failureReason?: string;
}

export class ListRefundsQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsIn([
    'REQUESTED',
    'APPROVED',
    'REJECTED',
    'EXECUTING',
    'PENDING_CONFIRMATION',
    'COMPLETED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
  ])
  status?:
    | 'REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTING'
    | 'PENDING_CONFIRMATION'
    | 'COMPLETED'
    | 'FAILED'
    | 'RECONCILIATION_REQUIRED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
