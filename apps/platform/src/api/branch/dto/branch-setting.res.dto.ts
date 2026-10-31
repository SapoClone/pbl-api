import {
  EnumField,
  NumberField,
  StringField,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import {
  InvoiceTemplateCode,
  PaymentMethod,
} from '../entities/branch-setting.entity';

@Exclude()
export class BranchSettingResDto {
  @StringField() @Expose() branchId: string;
  @StringField() @Expose() invoicePrefix: string;
  @EnumField(() => InvoiceTemplateCode, { nullable: true })
  @Expose()
  invoiceTemplateCode: InvoiceTemplateCode | null;
  /** Percent */
  @NumberField({ min: 0, max: 100 }) @Expose() defaultTaxRate: number;
  @EnumField(() => PaymentMethod, { each: true })
  @Expose()
  allowedPaymentMethods: PaymentMethod[];
}
