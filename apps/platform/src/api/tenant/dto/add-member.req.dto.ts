import { EmailField, EnumField } from '@/decorators/field.decorators';
import { Transform } from 'class-transformer';
import { TenantRole } from '../entities/account-tenant.entity';

/** Roles an owner can hand out; the owner role is only held by the creator. */
export enum GrantableRole {
  MANAGER = TenantRole.MANAGER,
  CASHIER = TenantRole.CASHIER,
}

export class AddMemberReqDto {
  /** The account to add; it must already have registered */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @EmailField()
  email!: string;

  @EnumField(() => GrantableRole)
  role!: GrantableRole;
}
