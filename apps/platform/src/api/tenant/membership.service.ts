import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import {
  AccountTenantEntity,
  TenantRole,
} from './entities/account-tenant.entity';
import { TenantStatus } from './entities/tenant.entity';

export type Membership = {
  tenantId: string;
  name: string;
  subdomain: string;
  role: TenantRole;
};

/**
 * The stores an account can act in. Suspended and deleted stores are
 * excluded, so callers treat them exactly like non-members (404).
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(AccountTenantEntity)
    private readonly repository: Repository<AccountTenantEntity>,
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
        tenant: { status: TenantStatus.ACTIVE, deletedAt: IsNull() },
      },
      relations: { tenant: true },
      order: { tenant: { name: 'ASC' } },
    });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      name: row.tenant.name,
      subdomain: row.tenant.subdomain,
      role: row.role,
    }));
  }
}
