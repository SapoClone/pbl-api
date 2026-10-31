import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RecognizePayableDto {
  @IsUUID()
  supplierId!: string;

  @IsInt()
  amount!: number;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsOptional()
  @IsUUID()
  receiptId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

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
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class PayableAllocationLineDto {
  @IsUUID()
  payableId!: string;

  @IsInt()
  amount!: number;
}

export class RecordSupplierPaymentDto {
  @IsInt()
  amount!: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER'])
  paymentMethod?: 'CASH' | 'BANK_TRANSFER';

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayableAllocationLineDto)
  allocations?: PayableAllocationLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ApplySupplierReturnCreditDto {
  @IsInt()
  amount!: number;

  @IsString()
  @MaxLength(128)
  returnRefId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ListPayablesQueryDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'PARTIALLY_PAID', 'PAID', 'ADJUSTED', 'REVERSED'])
  status?: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'ADJUSTED' | 'REVERSED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
