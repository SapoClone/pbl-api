import {
  EnumFieldOptional,
  StringFieldOptional,
} from '@/decorators/field.decorators';
import { MemberStatus, TenantRole } from '../entities/account-tenant.entity';

export class ListMemberReqDto {
  /** Searches name, email and code */
  @StringFieldOptional({ maxLength: 100 })
  q?: string;

  @EnumFieldOptional(() => MemberStatus)
  status?: MemberStatus;

  @EnumFieldOptional(() => TenantRole)
  role?: TenantRole;
}
