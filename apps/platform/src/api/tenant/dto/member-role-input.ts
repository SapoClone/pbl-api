/**
 * Role names accepted in the legacy `role` field of a member request: the old
 * `manager` and `cashier` (normalised by `normalizeRoleCode`) and the seeded
 * codes. `owner` is deliberately absent: it is only held by the store's creator.
 */
export enum AssignableRole {
  MANAGER = 'manager',
  CASHIER = 'cashier',
  BRANCH_MANAGER = 'branch_manager',
  SALES_STAFF = 'sales_staff',
  WAREHOUSE_STAFF = 'warehouse_staff',
  ACCOUNTANT = 'accountant',
}

/** What a request names to pick a role; `roleId` wins when both are sent. */
export type MemberRoleInput = { roleId?: string; role?: string };
