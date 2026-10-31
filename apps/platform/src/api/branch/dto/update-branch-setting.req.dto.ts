import {
  EnumFieldOptional,
  NumberFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  InvoiceTemplateCode,
  PaymentMethod,
} from '../entities/branch-setting.entity';

/** Any field may be omitted; only `invoiceTemplateCode` may be cleared with null. */
export class UpdateBranchSettingReqDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @StringFieldOptional({ maxLength: 20 })
  @Matches(/^[A-Z0-9_-]{1,20}$/)
  invoicePrefix?: string;

  @EnumFieldOptional(() => InvoiceTemplateCode, { nullable: true })
  invoiceTemplateCode?: InvoiceTemplateCode | null;

  /** Percent, 0-100 */
  @NumberFieldOptional({ min: 0, max: 100 })
  defaultTaxRate?: number;

  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(PaymentMethod, { each: true })
  allowedPaymentMethods?: PaymentMethod[];
}
