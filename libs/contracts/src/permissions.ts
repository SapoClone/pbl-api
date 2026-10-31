/**
 * Permission catalog and default roles (ADR-0012). The catalog is code: adding a
 * permission ships with the service that enforces it.
 */

export const PERMISSION_CATALOG = {
  dashboard: ['view'],
  products: ['view', 'create', 'update', 'delete'],
  inventory: ['view', 'create', 'update', 'delete', 'approve'],
  orders: ['view', 'create', 'update', 'delete', 'approve'],
  pos: ['view', 'create', 'update'],
  channels: ['view', 'create', 'update', 'delete'],
  customers: ['view', 'create', 'update', 'delete'],
  purchasing: ['view', 'create', 'update', 'delete', 'approve'],
  staff: ['view', 'create', 'update', 'delete'],
  reports: ['view'],
  settings: ['view', 'update'],
} as const;

export type PermissionModule = keyof typeof PERMISSION_CATALOG;
export type PermissionAction =
  (typeof PERMISSION_CATALOG)[PermissionModule][number];

export type PermissionCode = {
  [M in PermissionModule]: `${M}.${(typeof PERMISSION_CATALOG)[M][number]}`;
}[PermissionModule];

export const PERMISSION_MODULES = Object.keys(
  PERMISSION_CATALOG,
) as PermissionModule[];

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'approve',
] as const;

/** Every permission code, sorted. */
export const ALL_PERMISSIONS: readonly PermissionCode[] = (
  Object.entries(PERMISSION_CATALOG) as [PermissionModule, readonly string[]][]
)
  .flatMap(([module, actions]) =>
    actions.map((action) => `${module}.${action}` as PermissionCode),
  )
  .sort();

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export const isPermissionCode = (value: unknown): value is PermissionCode =>
  typeof value === 'string' && PERMISSION_SET.has(value);

/** In a token's `perms` claim (and in a role): every permission. */
export const WILDCARD_PERMISSION = '*';

// ---- roles

export const ROLE_CODES = {
  OWNER: 'owner',
  BRANCH_MANAGER: 'branch_manager',
  SALES_STAFF: 'sales_staff',
  WAREHOUSE_STAFF: 'warehouse_staff',
  ACCOUNTANT: 'accountant',
} as const;
export type SeededRoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const SEEDED_ROLES: Record<
  SeededRoleCode,
  { name: string; description: string }
> = {
  owner: {
    name: 'Chủ cửa hàng',
    description: 'Toàn quyền với cửa hàng, không thể chỉnh sửa.',
  },
  branch_manager: {
    name: 'Quản lý chi nhánh',
    description:
      'Quản lý vận hành chi nhánh, trừ quản lý nhân viên và cài đặt cửa hàng.',
  },
  sales_staff: {
    name: 'Nhân viên bán hàng',
    description: 'Bán hàng tại quầy, tạo và cập nhật đơn hàng, chăm sóc khách.',
  },
  warehouse_staff: {
    name: 'Nhân viên kho',
    description: 'Quản lý tồn kho, nhập hàng và xem đơn hàng cần xử lý.',
  },
  accountant: {
    name: 'Kế toán',
    description: 'Xem đơn hàng, công nợ mua hàng và báo cáo.',
  },
};

/** Old role names, still accepted on input (ADR-0012 §3). */
export const LEGACY_ROLE_CODES = {
  manager: 'branch_manager',
  cashier: 'sales_staff',
} as const;

export function normalizeRoleCode(code: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_ROLE_CODES, code)
    ? LEGACY_ROLE_CODES[code as keyof typeof LEGACY_ROLE_CODES]
    : code;
}

const NOT_FOR_MANAGER: readonly PermissionCode[] = [
  'staff.create',
  'staff.update',
  'staff.delete',
  'settings.update',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<
  SeededRoleCode,
  readonly PermissionCode[] | '*'
> = {
  owner: '*',
  branch_manager: ALL_PERMISSIONS.filter((p) => !NOT_FOR_MANAGER.includes(p)),
  sales_staff: [
    'dashboard.view',
    'products.view',
    'inventory.view',
    'orders.view',
    'orders.create',
    'orders.update',
    'pos.view',
    'pos.create',
    'pos.update',
    'customers.view',
    'customers.create',
    'customers.update',
  ],
  warehouse_staff: [
    'dashboard.view',
    'products.view',
    'inventory.view',
    'inventory.create',
    'inventory.update',
    'orders.view',
    'purchasing.view',
    'purchasing.create',
  ],
  accountant: [
    'dashboard.view',
    'orders.view',
    'customers.view',
    'inventory.view',
    'purchasing.view',
    'purchasing.update',
    'reports.view',
  ],
};
