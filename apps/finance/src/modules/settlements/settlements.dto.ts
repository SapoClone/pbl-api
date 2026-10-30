import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ConfirmSettlementDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUUID()
  checkoutId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenderRef?: string;

  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'COD', 'ON_ACCOUNT'])
  paymentMethod!:
    | 'CASH'
    | 'BANK_TRANSFER'
    | 'CARD'
    | 'EWALLET'
    | 'COD'
    | 'ON_ACCOUNT';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalTxId?: string;

  @IsString()
  requestedAmount!: string;

  @IsOptional()
  @IsString()
  confirmedAmount?: string;

  @IsOptional()
  @IsString()
  settledAmount?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsBoolean()
  ambiguousOutcome?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ProviderWebhookCallbackDto {
  @IsString()
  @MaxLength(32)
  provider!: string;

  @IsString()
  @MaxLength(128)
  externalTxId!: string;

  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUUID()
  checkoutId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenderRef?: string;

  @IsOptional()
  @IsIn(['BANK_TRANSFER', 'CARD', 'EWALLET'])
  paymentMethod?: 'BANK_TRANSFER' | 'CARD' | 'EWALLET';

  @IsString()
  confirmedAmount!: string;

  @IsOptional()
  @IsString()
  requestedAmount?: string;

  @IsOptional()
  @IsIn(['CONFIRMED', 'SETTLED', 'FAILED', 'PENDING', 'AMBIGUOUS'])
  providerStatus?: 'CONFIRMED' | 'SETTLED' | 'FAILED' | 'PENDING' | 'AMBIGUOUS';

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ListSettlementsQueryDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsIn([
    'PENDING',
    'AUTHORIZED',
    'CAPTURED',
    'SETTLEMENT_PENDING',
    'SETTLED',
    'FAILED',
    'REVERSED',
    'RECONCILIATION_REQUIRED',
  ])
  settlementStatus?:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'SETTLEMENT_PENDING'
    | 'SETTLED'
    | 'FAILED'
    | 'REVERSED'
    | 'RECONCILIATION_REQUIRED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
