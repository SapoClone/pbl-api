import {
  ClassField,
  EnumField,
  StringField,
} from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantRole } from '../entities/account-tenant.entity';

/** A member of the selected store. */
@Exclude()
export class MemberResDto {
  @StringField() @Expose() accountId: string;
  @StringField() @Expose() email: string;
  @StringField() @Expose() name: string;
  @EnumField(() => TenantRole) @Expose() role: TenantRole;
  @ClassField(() => Date) @Expose() createdAt: Date;
}
