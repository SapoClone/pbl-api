import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { SCREEN_PAYMENT_METHODS } from '../../common/order-views';

/** Body of `/pack` and `/complete`: the order version the client saw */
export class OrderVersionDto {
  @IsInt()
  @Min(1)
  version!: number;
}

export class ShipOrderDto extends OrderVersionDto {
  @IsOptional()
  @IsUUID()
  shippingProviderId?: string;

  /** null: the provider assigns one */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  trackingCode?: string | null;
}

export class RecordPaymentDto {
  @IsIn(SCREEN_PAYMENT_METHODS)
  method!: string;

  /** Integer VND; negative records a refund */
  @IsInt()
  @NotEquals(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

export class OrderReturnItemDto {
  @IsUUID()
  orderItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

export class OrderReturnRefundDto {
  @IsIn(['cash', 'transfer', 'card', 'e_wallet'])
  method!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

export class OrderReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderReturnItemDto)
  items!: OrderReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderReturnRefundDto)
  refund?: OrderReturnRefundDto;

  /** Default true: the goods go back on the shelf */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class OpenContractShiftDto {
  @IsUUID()
  registerId!: string;

  @IsInt()
  @Min(0)
  openingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CloseContractShiftDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsInt()
  @Min(0)
  closingCashActual!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CurrentShiftQueryDto {
  @IsUUID()
  registerId!: string;
}
