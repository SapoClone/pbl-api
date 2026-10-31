import {
  EnumFieldOptional,
  StringFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';
import { MemberStatus } from '../entities/account-tenant.entity';

export class ListMemberReqDto {
  /** Searches name, email and code */
  @StringFieldOptional({ maxLength: 100 })
  q?: string;

  @EnumFieldOptional(() => MemberStatus)
  status?: MemberStatus;

  /** A role code (`branch_manager`; the legacy `manager` and `cashier` too) */
  @StringFieldOptional({ maxLength: 64 })
  role?: string;

  @UUIDFieldOptional()
  roleId?: string;
}
