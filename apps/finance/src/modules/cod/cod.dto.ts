import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateCodReceivableDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUUID()
  fulfillmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsString()
  @MaxLength(32)
  carrierCode!: string;

  @IsString()
  @MaxLength(64)
  trackingNumber!: string;

  @IsInt()
  expectedCodAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CodSettlementBatchLineDto {
  @IsString()
  @MaxLength(64)
  trackingNumber!: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  fulfillmentId?: string;

  @IsInt()
  reportedCodAmount!: number;

  @IsOptional()
  @IsInt()
  carrierFeeAmount?: number;

  @IsInt()
  netPayoutAmount!: number;
}

export class ImportCodSettlementBatchDto {
  @IsString()
  @MaxLength(32)
  carrierCode!: string;

  @IsString()
  @MaxLength(128)
  statementRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  fileChecksum?: string;

  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsBoolean()
  autoReconcile?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CodSettlementBatchLineDto)
  lines!: CodSettlementBatchLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ReconcileCodBatchDto {
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;
}

export class ListCodReceivablesQueryDto {
  @IsOptional()
  @IsString()
  carrierCode?: string;

  @IsOptional()
  @IsIn([
    'COD_RECEIVABLE_RECOGNIZED',
    'SETTLEMENT_EXPECTED',
    'SETTLEMENT_RECEIVED',
    'RECONCILED',
    'DISCREPANCY',
  ])
  status?:
    | 'COD_RECEIVABLE_RECOGNIZED'
    | 'SETTLEMENT_EXPECTED'
    | 'SETTLEMENT_RECEIVED'
    | 'RECONCILED'
    | 'DISCREPANCY';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}

export class ListCodBatchesQueryDto {
  @IsOptional()
  @IsString()
  carrierCode?: string;

  @IsOptional()
  @IsIn(['IMPORTED', 'RECONCILED', 'DISCREPANCY_DETECTED'])
  status?: 'IMPORTED' | 'RECONCILED' | 'DISCREPANCY_DETECTED';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
