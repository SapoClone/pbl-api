import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RecognizeReceivableDto {
  @IsUUID()
  customerId!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  overrideApprovedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ReceivableAllocationLineDto {
  @IsUUID()
  receivableId!: string;

  @IsNumberString()
  amount!: string;
}

export class RecordReceivablePaymentDto {
  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET'])
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'E_WALLET';

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['REJECT', 'PREPAYMENT'])
  overpaymentPolicy?: 'REJECT' | 'PREPAYMENT';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivableAllocationLineDto)
  allocations?: ReceivableAllocationLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ListReceivablesQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'PARTIALLY_PAID', 'PAID', 'WRITTEN_OFF', 'REVERSED'])
  status?: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'WRITTEN_OFF' | 'REVERSED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
