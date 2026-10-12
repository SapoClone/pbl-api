import { EnumField, StringField } from '@/decorators/field.decorators';
import { Exclude, Expose } from 'class-transformer';
import { TenantRole } from '../entities/account-tenant.entity';

/** A store the caller belongs to, with the caller's role in it. */
@Exclude()
export class MembershipResDto {
  @StringField() @Expose() id: string;
  @StringField() @Expose() name: string;
  @StringField() @Expose() subdomain: string;
  @EnumField(() => TenantRole) @Expose() role: TenantRole;
}
