import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PLATFORM_BRANCH_CREATED } from '@pbl/contracts';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { BranchEntity, BranchStatus } from '../branch/entities/branch.entity';
import {
  AccountTenantEntity,
  TenantRole,
} from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';
import { initialsOf, TenantService } from './tenant.service';

describe('TenantService.create', () => {
  const dto = { name: 'My Shop', subdomain: 'my-shop' };
  let tenantRepository: { exists: jest.Mock };
  let saved: unknown[];
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let accountRepository: { findOne: jest.Mock };
  let service: TenantService;
  let outbox: { add: jest.Mock };

  beforeEach(() => {
    saved = [];
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    tenantRepository = { exists: jest.fn().mockResolvedValue(false) };
    const em = {
      save: jest.fn(async (entity) => {
        saved.push(entity);
        if (entity instanceof TenantEntity)
          entity.id = 't1' as TenantEntity['id'];
        return entity;
      }),
    };
    accountRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'a1', status: AccountStatus.ACTIVE }),
    };
    dataSource = {
      transaction: jest.fn((work) => work(em)),
      getRepository: jest.fn(() => accountRepository),
    };
    service = new TenantService(
      tenantRepository as unknown as Repository<TenantEntity>,
      dataSource as unknown as DataSource,
      {} as MembershipService,
      outbox as never,
    );
  });

  it('creates the store, the owner membership and the default branch in one transaction', async () => {
    const tenant = await service.create('a1', dto);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(tenant.id).toBe('t1');
    expect(saved[0]).toBeInstanceOf(TenantEntity);
    expect(saved[0]).toMatchObject({
      name: 'My Shop',
      subdomain: 'my-shop',
      status: 'active',
      createdBy: 'a1',
    });
    expect(saved[1]).toBeInstanceOf(AccountTenantEntity);
    expect(saved[1]).toMatchObject({
      accountId: 'a1',
      tenantId: 't1',
      role: 'owner',
      status: 'active',
      code: 'NV001',
    });
    expect(saved[2]).toBeInstanceOf(BranchEntity);
    expect(saved[2]).toMatchObject({
      tenantId: 't1',
      code: 'CN01',
      name: 'Chi nhánh chính',
      isWarehouse: true,
      status: 'active',
    });
  });

  it('writes the branch.created event of the default branch in the same transaction, for the new store', async () => {
    await service.create('a1', dto);

    expect(outbox.add).toHaveBeenCalledTimes(1);
    expect(outbox.add).toHaveBeenCalledWith(
      expect.anything(),
      PLATFORM_BRANCH_CREATED,
      expect.objectContaining({ code: 'CN01', status: 'active' }),
      { tenantId: 't1' },
    );
  });

  it.each([
    ['disabled', { id: 'a1', status: AccountStatus.DISABLED }],
    ['missing', null],
  ])(
    'answers 401 and creates nothing for a %s account',
    async (_l, account) => {
      accountRepository.findOne.mockResolvedValue(account);

      await expect(service.create('a1', dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a taken subdomain with T001', async () => {
    tenantRepository.exists.mockResolvedValue(true);

    const error = await service.create('a1', dto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationException);
    expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.T001 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate (unique index) to T001, not a 500', async () => {
    dataSource.transaction.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('dup'), {
          code: '23505',
          constraint: 'UQ_tenant_subdomain',
        }),
      ),
    );

    const error = await service.create('a1', dto).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationException);
    expect(error.getResponse()).toMatchObject({ errorCode: ErrorCode.T001 });
  });

  it('rethrows other database errors', async () => {
    dataSource.transaction.mockRejectedValue(new Error('connection lost'));

    await expect(service.create('a1', dto)).rejects.toThrow('connection lost');
  });
});

describe('TenantService (read and update)', () => {
  let tenantRepository: { findOneByOrFail: jest.Mock; save: jest.Mock };
  let membershipService: { findActiveMemberships: jest.Mock };
  let service: TenantService;
  const existing = () =>
    new TenantEntity({
      id: 't1' as TenantEntity['id'],
      name: 'Old',
      subdomain: 'old',
      phone: '0900000000',
      email: 'a@b.co',
      address: 'Street',
    });

  beforeEach(() => {
    tenantRepository = {
      findOneByOrFail: jest.fn(),
      save: jest.fn(async (e) => e),
    };
    membershipService = { findActiveMemberships: jest.fn() };
    service = new TenantService(
      tenantRepository as unknown as Repository<TenantEntity>,
      {} as DataSource,
      membershipService as unknown as MembershipService,
      { add: jest.fn() } as never,
    );
  });

  it('listMine maps memberships to id, name, subdomain and role', async () => {
    membershipService.findActiveMemberships.mockResolvedValue([
      {
        tenantId: 't1',
        name: 'Shop',
        subdomain: 'shop',
        role: 'owner',
        extra: 'dropped',
      },
    ]);

    await expect(service.listMine('a1')).resolves.toEqual([
      { id: 't1', name: 'Shop', subdomain: 'shop', role: 'owner' },
    ]);
    expect(membershipService.findActiveMemberships).toHaveBeenCalledWith('a1');
  });

  it('getCurrent loads the store by id', async () => {
    tenantRepository.findOneByOrFail.mockResolvedValue(existing());

    const result = await service.getCurrent('t1');

    expect(tenantRepository.findOneByOrFail).toHaveBeenCalledWith({
      id: 't1',
    });
    expect(result).toMatchObject({ name: 'Old' });
  });

  it('updateCurrent assigns only the fields sent and sets updatedBy', async () => {
    tenantRepository.findOneByOrFail.mockResolvedValue(existing());

    await service.updateCurrent('t1', 'a1', { name: 'New', phone: undefined });

    expect(tenantRepository.save.mock.calls[0][0]).toMatchObject({
      name: 'New',
      phone: '0900000000',
      email: 'a@b.co',
      address: 'Street',
      subdomain: 'old',
      updatedBy: 'a1',
    });
  });

  it('updateCurrent stores null for phone, email and address sent as null', async () => {
    tenantRepository.findOneByOrFail.mockResolvedValue(existing());

    await service.updateCurrent('t1', 'a1', {
      phone: null,
      email: null,
      address: null,
    });

    const saved: TenantEntity = tenantRepository.save.mock.calls[0][0];
    expect(saved.phone).toBeNull();
    expect(saved.email).toBeNull();
    expect(saved.address).toBeNull();
    expect(saved.name).toBe('Old');
  });
});

describe('TenantService.getContext', () => {
  const tenant = new TenantEntity({
    id: 't1' as TenantEntity['id'],
    name: 'Mộc Store',
    subdomain: 'mocstore',
    status: TenantStatus.ACTIVE,
  });
  const membership = (role: TenantRole) =>
    new AccountTenantEntity({
      accountId: 'a1',
      tenantId: 't1',
      role,
      account: new AccountEntity({
        id: 'a1' as AccountEntity['id'],
        name: 'Minh Anh',
        email: 'minhanh@mocstore.vn',
      }),
    });
  let membershipRepo: { findOne: jest.Mock };
  let branchRepo: { find: jest.Mock };
  let service: TenantService;

  beforeEach(() => {
    membershipRepo = {
      findOne: jest.fn().mockResolvedValue(membership(TenantRole.OWNER)),
    };
    branchRepo = {
      find: jest.fn().mockResolvedValue([
        new BranchEntity({
          id: 'b1' as BranchEntity['id'],
          name: 'Chi nhánh Quận 3',
          code: 'CN01',
          address: 'Q3',
          isWarehouse: false,
          status: BranchStatus.ACTIVE,
        }),
      ]),
    };
    const dataSource = {
      getRepository: jest.fn((entity) =>
        entity === AccountTenantEntity ? membershipRepo : branchRepo,
      ),
    };
    service = new TenantService(
      { findOneByOrFail: jest.fn().mockResolvedValue(tenant) } as never,
      dataSource as never,
      {} as MembershipService,
      {} as never,
    );
  });

  it('returns the store card, the free plan placeholder, my role and the branches', async () => {
    const context = await service.getContext('t1', 'a1');

    expect(context).toEqual({
      tenant: {
        id: 't1',
        name: 'Mộc Store',
        subdomain: 'mocstore',
        status: 'active',
      },
      plan: {
        code: 'free',
        name: 'Free',
        isExpiringSoon: false,
        expiresAt: null,
      },
      branchCount: 1,
      me: {
        accountId: 'a1',
        name: 'Minh Anh',
        initials: 'MA',
        email: 'minhanh@mocstore.vn',
        role: 'owner',
        roleId: null,
        roleName: 'Chủ cửa hàng',
        isOwner: true,
      },
      branches: [
        {
          id: 'b1',
          name: 'Chi nhánh Quận 3',
          code: 'CN01',
          address: 'Q3',
          isWarehouse: false,
        },
      ],
      permissions: [],
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  it('lists only the active branches of the token’s store', async () => {
    await service.getContext('t1', 'a1');

    expect(branchRepo.find.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      status: 'active',
    });
    expect(membershipRepo.findOne.mock.calls[0][0].where).toEqual({
      accountId: 'a1',
      tenantId: 't1',
    });
  });

  it('knows a cashier is not the owner', async () => {
    membershipRepo.findOne.mockResolvedValue(membership(TenantRole.CASHIER));

    const { me } = await service.getContext('t1', 'a1');

    expect(me).toMatchObject({
      isOwner: false,
      roleName: 'Nhân viên bán hàng',
    });
  });

  it('answers 404 when the caller is no longer a member of the store', async () => {
    membershipRepo.findOne.mockResolvedValue(null);

    await expect(service.getContext('t1', 'a1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    ['Minh Anh', 'MA'],
    ['  nguyen van an ', 'NA'],
    ['Cher', 'C'],
    ['', ''],
  ])('derives the initials of "%s" as "%s"', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
