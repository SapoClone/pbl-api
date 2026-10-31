import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  SEEDED_ROLES,
} from '@pbl/contracts';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { seedRoles } from './role-seeding';

describe('seedRoles', () => {
  const run = async () => {
    const em = {
      save: jest.fn(async (roles: RoleEntity[]) =>
        roles.map((r) => Object.assign(r, { id: `id-${r.code}` })),
      ),
      insert: jest.fn(),
    };
    const roles = await seedRoles(em as never, 't1');
    return { em, roles };
  };

  it('creates the five seeded roles of the store, named as in the contracts', async () => {
    const { em, roles } = await run();

    expect([...roles.keys()]).toEqual(Object.keys(SEEDED_ROLES));
    for (const [code, spec] of Object.entries(SEEDED_ROLES)) {
      expect(roles.get(code)).toMatchObject({
        tenantId: 't1',
        code,
        name: spec.name,
        description: spec.description,
        isSeeded: true,
      });
    }
    expect(em.save).toHaveBeenCalledTimes(1);
  });

  it('gives each role its default permissions, and the owner none (it is always "*")', async () => {
    const { em } = await run();
    const rows: RolePermissionEntity[] = em.insert.mock.calls[0][1];
    const of = (code: string) =>
      rows
        .filter((r) => r.roleId === `id-${code}`)
        .map((r) => r.permissionCode);

    expect(em.insert.mock.calls[0][0]).toBe(RolePermissionEntity);
    expect(of('owner')).toEqual([]);
    expect(of('branch_manager')).toEqual([
      ...(DEFAULT_ROLE_PERMISSIONS.branch_manager as readonly string[]),
    ]);
    expect(of('branch_manager')).not.toContain('staff.update');
    expect(
      of('branch_manager').every((c) => ALL_PERMISSIONS.includes(c as never)),
    ).toBe(true);
    expect(of('sales_staff')).toContain('pos.create');
    expect(of('accountant')).toContain('reports.view');
    expect(of('warehouse_staff')).toContain('inventory.create');
  });
});
