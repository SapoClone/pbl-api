import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ReturnDisposition } from '../../domain/sales-domain';

export class CreateReturnItemDto {
  @IsUUID()
  orderItemId!: string;

  @IsNumber()
  @Min(0.001)
  returnQty!: number;

  @IsOptional()
  @IsIn(['RESTOCK', 'DAMAGED', 'QUARANTINE', 'NO_PHYSICAL_RETURN'])
  disposition?: ReturnDisposition;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class CreateReturnDto {
  @IsUUID()
  orderId!: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;

  @IsOptional()
  @IsBoolean()
  autoReceive?: boolean;
}

export class ReceiveReturnDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class CreateRefundRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET'])
  method?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'E_WALLET';

  @IsOptional()
  @IsUUID()
  shiftId?: string;
}
