import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DatedPageQueryDto } from '../../common/list-query.dto';

export const LEDGER_REF_TYPES = [
  'receipt',
  'issue',
  'transfer_out',
  'transfer_in',
  'stock_take',
  'sale',
  'sale_shortfall',
  'reservation_release',
] as const;

export class ListLedgerReqDto extends DatedPageQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @IsIn(LEDGER_REF_TYPES)
  refType?: (typeof LEDGER_REF_TYPES)[number];
}
