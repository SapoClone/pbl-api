import { TenantRole } from './entities/account-tenant.entity';

/** Display names of the three store roles (Vietnamese, as in the Figma screens). */
export const ROLE_LABELS: Record<TenantRole, string> = {
  [TenantRole.OWNER]: 'Chủ cửa hàng',
  [TenantRole.MANAGER]: 'Quản lý chi nhánh',
  [TenantRole.CASHIER]: 'Nhân viên bán hàng',
};

export const DEFAULT_ROLE_COUNT = Object.keys(ROLE_LABELS).length;
