import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export class TriggerReconciliationRunDto {
  @IsOptional()
  @IsUUID()
  connectionId?: string;

  @IsOptional()
  @IsIn(['INCREMENTAL', 'FULL', 'ORDER_VERIFICATION', 'INVENTORY_VERIFICATION'])
  runType?:
    | 'INCREMENTAL'
    | 'FULL'
    | 'ORDER_VERIFICATION'
    | 'INVENTORY_VERIFICATION';

  @IsOptional()
  @IsBoolean()
  autoRecoverSafeItems?: boolean;
}
