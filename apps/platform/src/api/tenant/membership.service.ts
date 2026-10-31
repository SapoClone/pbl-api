import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ROLE_CODES, WILDCARD_PERMISSION } from '@pbl/contracts';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { RolePermissionEntity } from '../role/entities/role-permission.entity';
import { AccountTenantBranchEntity } from './entities/account-tenant-branch.entity';
import {
  AccountTenantEntity,
  MemberStatus,
} from './entities/account-tenant.entity';
import { TenantStatus } from './entities/tenant.entity';

export type Membership = {
  tenantId: string;
  name: string;
  subdomain: string;
  /** The role code (`owner`, `branch_manager`, a custom slug, ...) */
  role: string;
  roleId: string;
  roleName: string;
  /** Permission codes for the token's `perms`; `['*']` for the owner */
  permissions: string[];
  /** Branch ids for the token's `branches`; `['*']` = every branch */
  branches: string[];
};

/**
 * The stores an account can act in, with the role, permissions and branches
 * the access token carries for each (ADR-0020). Suspended and deleted stores
 * are excluded, and so are locked members, so callers treat them exactly like
 * non-members (404). A member with no branch assignment, and the owner, may
 * use every branch.
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(AccountTenantEntity)
    private readonly repository: Repository<AccountTenantEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissions: Repository<RolePermissionEntity>,
    @InjectRepository(AccountTenantBranchEntity)
    private readonly memberBranches: Repository<AccountTenantBranchEntity>,
  ) {}

  findActiveMemberships(accountId: string): Promise<Membership[]> {
    return this.find({ accountId });
  }

  async findActiveMembership(
    accountId: string,
    tenantId: string,
  ): Promise<Membership | null> {
    const [membership] = await this.find({ accountId, tenantId });
    return membership ?? null;
  }

  private async find(
    where: FindOptionsWhere<AccountTenantEntity>,
  ): Promise<Membership[]> {
    const rows = await this.repository.find({
      where: {
        ...where,
        // a locked member cannot sign in to or switch into the store
        status: MemberStatus.ACTIVE,
        tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() },
      },
      relations: { tenant: true, memberRole: true },
      order: { tenant: { name: 'ASC' } },
    });
    if (rows.length === 0) return [];
    const roleIds = [...new Set(rows.map((row) => row.roleId))];
    const [permissionRows, branchRows] = await Promise.all([
      this.rolePermissions.find({ where: { roleId: In(roleIds) } }),
      this.memberBranches.find({
        where: { accountId: In([...new Set(rows.map((r) => r.accountId))]) },
      }),
    ]);
    const permissionsOf = new Map<string, string[]>();
    for (const { roleId, permissionCode } of permissionRows) {
      permissionsOf.set(roleId, [
        ...(permissionsOf.get(roleId) ?? []),
        permissionCode,
      ]);
    }
    const branchesOf = new Map<string, string[]>();
    for (const { accountId, tenantId, branchId } of branchRows) {
      const key = `${accountId}:${tenantId}`;
      branchesOf.set(key, [...(branchesOf.get(key) ?? []), branchId]);
    }
    return rows.map((row) => {
      const isOwner = row.memberRole.code === ROLE_CODES.OWNER;
      const assigned = branchesOf.get(`${row.accountId}:${row.tenantId}`) ?? [];
      return {
        tenantId: row.tenantId,
        name: row.tenant.name,
        subdomain: row.tenant.subdomain,
        role: row.memberRole.code,
        roleId: row.roleId,
        roleName: row.memberRole.name,
        permissions: isOwner
          ? [WILDCARD_PERMISSION]
          : [...(permissionsOf.get(row.roleId) ?? [])].sort(),
        branches:
          isOwner || assigned.length === 0
            ? [WILDCARD_PERMISSION]
            : [...assigned].sort(),
      };
    });
  }
}
