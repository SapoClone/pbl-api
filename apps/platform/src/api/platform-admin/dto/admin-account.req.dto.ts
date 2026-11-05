import { PageOptionsDto } from '@/common/dto/offset-pagination/page-options.dto';
import {
  EnumFieldOptional,
  UUIDFieldOptional,
} from '@/decorators/field.decorators';

/** The role filter of the users screen: the five seeded roles, or any role a store made itself */
export enum AdminAccountRoleFilter {
  OWNER = 'owner',
  BRANCH_MANAGER = 'branch_manager',
  SALES_STAFF = 'sales_staff',
  WAREHOUSE_STAFF = 'warehouse_staff',
  ACCOUNTANT = 'accountant',
  CUSTOM = 'custom',
}

/**
 * `pending_verification` is in the contract; no account has an unverified email in this system yet (the verify-email
 * flow is not built), so that filter matches nothing.
 */
export enum AdminAccountStatus {
  ACTIVE = 'active',
  PENDING_VERIFICATION = 'pending_verification',
  DISABLED = 'disabled',
}

/** `q` searches name, email and code */
export class ListAdminAccountsReqDto extends PageOptionsDto {
  @UUIDFieldOptional()
  readonly tenantId?: string;

  @EnumFieldOptional(() => AdminAccountRoleFilter)
  readonly role?: AdminAccountRoleFilter;

  @EnumFieldOptional(() => AdminAccountStatus)
  readonly status?: AdminAccountStatus;
}

export class ListAdminAccountSessionsReqDto extends PageOptionsDto {}
