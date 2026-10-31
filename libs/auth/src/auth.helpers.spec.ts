import {
  allowedBranches,
  canAccessBranch,
  hasPermission,
} from './auth.helpers';

describe('auth helpers', () => {
  it('hasPermission: any-of, wildcard, none', () => {
    const user = { permissions: ['orders.view', 'pos.view'] };
    expect(hasPermission(user, 'orders.view')).toBe(true);
    expect(hasPermission(user, 'orders.create', 'pos.view')).toBe(true);
    expect(hasPermission(user, 'orders.create')).toBe(false);
    expect(hasPermission({ permissions: [] }, 'orders.view')).toBe(false);
    expect(hasPermission({ permissions: ['*'] }, 'anything.at.all')).toBe(true);
  });

  it('canAccessBranch', () => {
    expect(canAccessBranch({ branches: ['*'] }, 'b1')).toBe(true);
    expect(canAccessBranch({ branches: ['b1'] }, 'b1')).toBe(true);
    expect(canAccessBranch({ branches: ['b1'] }, 'b2')).toBe(false);
    expect(canAccessBranch({ branches: [] }, 'b1')).toBe(false);
  });

  it('allowedBranches: null for every branch, else a copy', () => {
    expect(allowedBranches({ branches: ['*'] })).toBeNull();
    const branches = ['b1', 'b2'];
    const result = allowedBranches({ branches });
    expect(result).toEqual(['b1', 'b2']);
    expect(result).not.toBe(branches);
  });
});
