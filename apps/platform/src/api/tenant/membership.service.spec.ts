import { IsNull, Repository } from 'typeorm';
import {
  AccountTenantEntity,
  MemberStatus,
  TenantRole,
} from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';

const row = (tenantId: string, name: string) =>
  new AccountTenantEntity({
    accountId: 'a1',
    tenantId,
    role: TenantRole.OWNER,
    tenant: new TenantEntity({
      id: tenantId as TenantEntity['id'],
      name,
      subdomain: name.toLowerCase(),
    }),
  });

describe('MembershipService', () => {
  let repository: { find: jest.Mock };
  let service: MembershipService;

  beforeEach(() => {
    repository = { find: jest.fn() };
    service = new MembershipService(
      repository as unknown as Repository<AccountTenantEntity>,
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
      relations: { tenant: true },
      order: { tenant: { name: 'ASC' } },
    });
    expect(memberships).toEqual([
      { tenantId: 't1', name: 'Alpha', subdomain: 'alpha', role: 'owner' },
      { tenantId: 't2', name: 'Beta', subdomain: 'beta', role: 'owner' },
    ]);
  });

  it('finds one membership with the same filters', async () => {
    repository.find.mockResolvedValue([row('t2', 'Beta')]);

    await expect(service.findActiveMembership('a1', 't2')).resolves.toEqual({
      tenantId: 't2',
      name: 'Beta',
      subdomain: 'beta',
      role: 'owner',
    });
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
  });
});
