import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PLATFORM_BRANCH_CREATED,
  SEEDED_ROLES,
} from '@pbl/contracts';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { BranchEntity, BranchStatus } from '../branch/entities/branch.entity';
import { RoleEntity } from '../role/entities/role.entity';
import { AccountTenantEntity } from './entities/account-tenant.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { MembershipService } from './membership.service';
import { initialsOf, TenantService } from './tenant.service';

describe('TenantService.create', () => {
  const dto = { name: 'My Shop', subdomain: 'my-shop' };
  let tenantRepository: { exists: jest.Mock };
  let saved: unknown[];
  let savedRoles: RoleEntity[];
  let inserted: { roleId: string; permissionCode: string }[];
  let em: { save: jest.Mock; insert: jest.Mock };
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let accountRepository: { findOne: jest.Mock };
  let service: TenantService;
  let outbox: { add: jest.Mock };

  beforeEach(() => {
    saved = [];
    savedRoles = [];
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    tenantRepository = { exists: jest.fn().mockResolvedValue(false) };
    inserted = [];
    em = {
      save: jest.fn(async (entity) => {
        if (Array.isArray(entity)) {
          // the seeded roles are saved as a batch
          entity.forEach((role) => {
            role.id = `role-${role.code}`;
            savedRoles.push(role);
          });
          return entity;
        }
        saved.push(entity);
        if (entity instanceof TenantEntity)
          entity.id = 't1' as TenantEntity['id'];
        return entity;
      }),
      insert: jest.fn(async (_entity, rows) => {
        inserted.push(...rows);
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
      roleId: 'role-owner',
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

  it('seeds the five roles of the store with their default permissions, before the creator joins as owner', async () => {
    await service.create('a1', dto);

    expect(savedRoles.map((r) => r.code)).toEqual(Object.keys(SEEDED_ROLES));
    expect(savedRoles).toEqual(
      savedRoles.map(() =>
        expect.objectContaining({ tenantId: 't1', isSeeded: true }),
      ),
    );
    const permissionsOf = (code: string) =>
      inserted
        .filter((row) => row.roleId === `role-${code}`)
        .map((row) => row.permissionCode)
        .sort();
    // the owner is always every permission: no rows
    expect(permissionsOf('owner')).toEqual([]);
    for (const code of [
      'branch_manager',
      'sales_staff',
      'warehouse_staff',
      'accountant',
    ] as const) {
      expect(permissionsOf(code)).toEqual(
        [...(DEFAULT_ROLE_PERMISSIONS[code] as readonly string[])].sort(),
      );
    }
    expect(permissionsOf('branch_manager')).not.toContain('staff.update');
    // roles come first: the membership references the owner role
    expect(em.save.mock.invocationCallOrder[1]).toBeLessThan(
      em.save.mock.invocationCallOrder[2],
    );
  });

  it('seeds nothing when the subdomain is taken', async () => {
    tenantRepository.exists.mockResolvedValue(true);

    await service.create('a1', dto).catch(() => undefined);

    expect(em.save).not.toHaveBeenCalled();
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
        roleId: 'r1',
        roleName: 'Chủ cửa hàng',
        permissions: ['*'],
        branches: ['*'],
      },
    ]);

    await expect(service.listMine('a1')).resolves.toEqual([
      {
        id: 't1',
        name: 'Shop',
        subdomain: 'shop',
        role: 'owner',
        roleId: 'r1',
        roleName: 'Chủ cửa hàng',
      },
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
  const membership = (code: string, name: string) =>
    new AccountTenantEntity({
      accountId: 'a1',
      tenantId: 't1',
      role: code,
      roleId: `role-${code}`,
      memberRole: new RoleEntity({ id: `role-${code}`, code, name }),
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
      findOne: jest.fn().mockResolvedValue(membership('owner', 'Chủ cửa hàng')),
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
        roleId: 'role-owner',
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

  it('lists the token’s permissions, and every code for the owner’s wildcard', async () => {
    const staff = await service.getContext('t1', 'a1', {
      permissions: ['orders.view', 'pos.create'],
      branches: null,
    });
    expect(staff.permissions).toEqual(['orders.view', 'pos.create']);

    const owner = await service.getContext('t1', 'a1', {
      permissions: ['*'],
      branches: null,
    });
    expect(owner.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it('lists only the branches the caller may act in, and counts those', async () => {
    await service.getContext('t1', 'a1', {
      permissions: [],
      branches: ['b1', 'b2'],
    });

    expect(branchRepo.find.mock.calls[0][0].where).toMatchObject({
      tenantId: 't1',
      status: 'active',
      id: expect.objectContaining({ _type: 'in', _value: ['b1', 'b2'] }),
    });
  });

  it('adds no branch filter for a caller with every branch', async () => {
    await service.getContext('t1', 'a1', { permissions: [], branches: null });

    expect(branchRepo.find.mock.calls[0][0].where).not.toHaveProperty('id');
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

  it('knows a sales member is not the owner', async () => {
    membershipRepo.findOne.mockResolvedValue(
      membership('sales_staff', 'Nhân viên bán hàng'),
    );

    const { me } = await service.getContext('t1', 'a1');

    expect(me).toMatchObject({
      isOwner: false,
      role: 'sales_staff',
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
