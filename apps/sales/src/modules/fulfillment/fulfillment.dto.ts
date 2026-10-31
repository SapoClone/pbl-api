import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateFulfillmentItemDto {
  @IsUUID()
  orderItemId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class CreateFulfillmentDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsIn(['POS_PICKUP', 'DELIVERY', 'SHIPPING'])
  fulfillmentType?: 'POS_PICKUP' | 'DELIVERY' | 'SHIPPING';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  carrierCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  trackingNumber?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFulfillmentItemDto)
  items?: CreateFulfillmentItemDto[];
}
