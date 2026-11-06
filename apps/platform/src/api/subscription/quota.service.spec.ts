import { ErrorCode } from '@/constants/error-code.constant';
import { BranchEntity } from '../branch/entities/branch.entity';
import { AccountTenantEntity } from '../tenant/entities/account-tenant.entity';
import { QuotaService } from './quota.service';

/** D6: a locked member does not use a seat; an inactive branch still does */
describe('QuotaService.assertCanAdd', () => {
  const plan = {
    code: 'basic',
    name: 'Basic',
    quotaBranches: 2,
    quotaUsers: 3,
  };
  let counts: Map<unknown, number>;
  let em: { query: jest.Mock; count: jest.Mock; [key: string]: jest.Mock };
  const service = new QuotaService();

  beforeEach(() => {
    counts = new Map();
    const builder: Record<string, jest.Mock> = {};
    for (const name of ['innerJoinAndSelect', 'where', 'andWhere']) {
      builder[name] = jest.fn(() => builder);
    }
    builder.getOne = jest.fn().mockResolvedValue({ plan });
    em = {
      query: jest.fn().mockResolvedValue([]),
      count: jest.fn(async (entity) => counts.get(entity) ?? 0),
      getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
    };
  });

  it('counts only ACTIVE members against the user limit', async () => {
    counts.set(AccountTenantEntity, 3);

    // the store has 5 memberships, 2 locked: the mock answers what the query asks for
    await service.assertCanAdd(em as never, 't1', 'users').catch(() => null);

    expect(em.count).toHaveBeenCalledWith(AccountTenantEntity, {
      where: { tenantId: 't1', status: 'active' },
    });
  });

  it('lets a store with locked members add one more when active members are under the limit', async () => {
    counts.set(AccountTenantEntity, 2); // 2 active (a locked one is not counted)

    await expect(
      service.assertCanAdd(em as never, 't1', 'users'),
    ).resolves.toBeUndefined();
  });

  it('refuses with Q001 when active members are at the limit', async () => {
    counts.set(AccountTenantEntity, 3);

    const error = await service
      .assertCanAdd(em as never, 't1', 'users')
      .catch((e) => e);

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse().errorCode).toBe(ErrorCode.Q001);
  });

  it('counts every branch row, inactive ones included', async () => {
    counts.set(BranchEntity, 2);

    await expect(
      service.assertCanAdd(em as never, 't1', 'branches'),
    ).rejects.toMatchObject({ status: 409 });
    expect(em.count).toHaveBeenCalledWith(BranchEntity, {
      where: { tenantId: 't1' },
    });
  });
});
