import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  isPermissionCode,
  LEGACY_ROLE_CODES,
  normalizeRoleCode,
  ROLE_CODES,
  SEEDED_ROLES,
  WILDCARD_PERMISSION,
} from './permissions';

describe('permissions', () => {
  it('lists sorted, unique codes', () => {
    expect([...ALL_PERMISSIONS]).toEqual([...new Set(ALL_PERMISSIONS)].sort());
    expect(ALL_PERMISSIONS).toContain('orders.approve');
    expect(ALL_PERMISSIONS).toHaveLength(42);
    expect(ALL_PERMISSIONS).toContain('finance.approve');
  });

  it('only grants permissions that exist, without duplicates', () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (perms === '*') continue;
      expect(new Set(perms).size).toBe(perms.length);
      for (const p of perms) {
        expect({ role, p, ok: isPermissionCode(p) }).toEqual({
          role,
          p,
          ok: true,
        });
      }
    }
  });

  it('gives the owner the wildcard and every seeded role a default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toBe('*');
    expect(WILDCARD_PERMISSION).toBe('*');
    for (const code of Object.values(ROLE_CODES)) {
      expect(DEFAULT_ROLE_PERMISSIONS[code]).toBeDefined();
      expect(SEEDED_ROLES[code].name).toBeTruthy();
    }
  });

  it('keeps member management and settings away from the branch manager', () => {
    const perms = DEFAULT_ROLE_PERMISSIONS.branch_manager as string[];
    expect(perms).toHaveLength(ALL_PERMISSIONS.length - 4);
    expect(perms).not.toContain('staff.create');
    expect(perms).not.toContain('settings.update');
    expect(perms).toContain('staff.view');
  });

  it('grants finance by role', () => {
    const d = DEFAULT_ROLE_PERMISSIONS;
    const finance = (r: readonly string[] | '*') =>
      (r as readonly string[]).filter((p) => p.startsWith('finance.'));
    expect(finance(d.branch_manager)).toHaveLength(4);
    expect(finance(d.accountant)).toEqual([
      'finance.view',
      'finance.create',
      'finance.update',
      'finance.approve',
    ]);
    expect(finance(d.sales_staff)).toEqual(['finance.view', 'finance.create']);
    expect(finance(d.warehouse_staff)).toEqual([]);
  });

  it('maps legacy role names', () => {
    expect(LEGACY_ROLE_CODES.manager).toBe('branch_manager');
    expect(normalizeRoleCode('manager')).toBe('branch_manager');
    expect(normalizeRoleCode('cashier')).toBe('sales_staff');
    expect(normalizeRoleCode('owner')).toBe('owner');
    expect(normalizeRoleCode('custom')).toBe('custom');
    expect(normalizeRoleCode('toString')).toBe('toString');
  });

  it('recognises permission codes', () => {
    expect(isPermissionCode('orders.create')).toBe(true);
    expect(isPermissionCode('pos.delete')).toBe(false);
    expect(isPermissionCode('*')).toBe(false);
    expect(isPermissionCode(1)).toBe(false);
  });
});
