import { In, IsNull, Repository } from 'typeorm';
import { RolePermissionEntity } from '../role/entities/role-permission.entity';
import { RoleEntity } from '../role/entities/role.entity';
import { AccountTenantBranchEntity } from './entities/account-tenant-branch.entity';
import {
  AccountTenantEntity,
  MemberStatus,
} from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';

const row = (
  tenantId: string,
  name: string,
  roleCode = 'owner',
  accountId = 'a1',
) =>
  new AccountTenantEntity({
    accountId,
    tenantId,
    role: roleCode,
    roleId: `role-${tenantId}-${roleCode}`,
    memberRole: new RoleEntity({
      id: `role-${tenantId}-${roleCode}`,
      code: roleCode,
      name: `Name of ${roleCode}`,
    }),
    tenant: new TenantEntity({
      id: tenantId as TenantEntity['id'],
      name,
      subdomain: name.toLowerCase(),
    }),
  });

describe('MembershipService', () => {
  let repository: { find: jest.Mock };
  let rolePermissions: { find: jest.Mock };
  let memberBranches: { find: jest.Mock };
  let service: MembershipService;

  beforeEach(() => {
    repository = { find: jest.fn() };
    rolePermissions = { find: jest.fn().mockResolvedValue([]) };
    memberBranches = { find: jest.fn().mockResolvedValue([]) };
    service = new MembershipService(
      repository as unknown as Repository<AccountTenantEntity>,
      rolePermissions as unknown as Repository<RolePermissionEntity>,
      memberBranches as unknown as Repository<AccountTenantBranchEntity>,
    );
  });

  it('only returns memberships of active, non-deleted stores, by name', async () => {
    repository.find.mockResolvedValue([row('t1', 'Alpha'), row('t2', 'Beta')]);

    const memberships = await service.findActiveMemberships('a1');

    expect(repository.find).toHaveBeenCalledWith({
      where: {
        accountId: 'a1',
        status: MemberStatus.ACTIVE,
        tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() },
      },
      relations: { tenant: true, memberRole: true },
      order: { tenant: { name: 'ASC' } },
    });
    expect(memberships).toEqual([
      {
        tenantId: 't1',
        name: 'Alpha',
        subdomain: 'alpha',
        role: 'owner',
        roleId: 'role-t1-owner',
        roleName: 'Name of owner',
        permissions: ['*'],
        branches: ['*'],
      },
      expect.objectContaining({ tenantId: 't2', role: 'owner' }),
    ]);
  });

  it('finds one membership with the same filters', async () => {
    repository.find.mockResolvedValue([row('t2', 'Beta')]);

    await expect(service.findActiveMembership('a1', 't2')).resolves.toEqual(
      expect.objectContaining({ tenantId: 't2', role: 'owner' }),
    );
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'a1',
          tenantId: 't2',
          status: MemberStatus.ACTIVE,
          tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() },
        },
      }),
    );
  });

  it('returns null for a store the account does not belong to, or that is suspended/deleted', async () => {
    repository.find.mockResolvedValue([]);

    await expect(service.findActiveMembership('a1', 'tX')).resolves.toBeNull();
    expect(rolePermissions.find).not.toHaveBeenCalled();
  });

  describe('claims', () => {
    it('gives the role code, its permission codes (sorted) and every branch when none is assigned', async () => {
      repository.find.mockResolvedValue([row('t1', 'Alpha', 'sales_staff')]);
      rolePermissions.find.mockResolvedValue([
        { roleId: 'role-t1-sales_staff', permissionCode: 'pos.view' },
        { roleId: 'role-t1-sales_staff', permissionCode: 'orders.view' },
      ]);

      const [membership] = await service.findActiveMemberships('a1');

      expect(rolePermissions.find).toHaveBeenCalledWith({
        where: { roleId: In(['role-t1-sales_staff']) },
      });
      expect(membership).toMatchObject({
        role: 'sales_staff',
        roleName: 'Name of sales_staff',
        permissions: ['orders.view', 'pos.view'],
        branches: ['*'],
      });
    });

    it('lists the assigned branches of that store only', async () => {
      repository.find.mockResolvedValue([
        row('t1', 'Alpha', 'sales_staff'),
        row('t2', 'Beta', 'sales_staff'),
      ]);
      memberBranches.find.mockResolvedValue([
        { accountId: 'a1', tenantId: 't1', branchId: 'b2' },
        { accountId: 'a1', tenantId: 't1', branchId: 'b1' },
      ]);

      const [alpha, beta] = await service.findActiveMemberships('a1');

      expect(alpha.branches).toEqual(['b1', 'b2']);
      expect(beta.branches).toEqual(['*']); // no rows in that store
    });

    it('gives the owner every permission and branch whatever the rows say', async () => {
      repository.find.mockResolvedValue([row('t1', 'Alpha', 'owner')]);
      rolePermissions.find.mockResolvedValue([
        { roleId: 'role-t1-owner', permissionCode: 'pos.view' },
      ]);
      memberBranches.find.mockResolvedValue([
        { accountId: 'a1', tenantId: 't1', branchId: 'b1' },
      ]);

      const [membership] = await service.findActiveMemberships('a1');

      expect(membership.permissions).toEqual(['*']);
      expect(membership.branches).toEqual(['*']);
    });

    it('gives a role without permissions none', async () => {
      repository.find.mockResolvedValue([row('t1', 'Alpha', 'custom')]);

      const [membership] = await service.findActiveMemberships('a1');

      expect(membership.permissions).toEqual([]);
    });
  });
});
