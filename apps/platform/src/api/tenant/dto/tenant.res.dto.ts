import {
  ClassField,
  EnumField,
  StringField,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantStatus } from '../entities/tenant.entity';

@Exclude()
export class TenantResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  @StringFieldOptional({ nullable: true }) @Expose() phone: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() email: string | null;
  @StringFieldOptional({ nullable: true }) @Expose() address: string | null;
  @EnumField(() => TenantStatus) @Expose() status: TenantStatus;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
