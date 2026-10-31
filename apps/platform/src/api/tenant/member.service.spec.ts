import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import {
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
} from '@pbl/contracts';
import { AccountEntity } from '../account/entities/account.entity';
import { BranchEntity } from '../branch/entities/branch.entity';
import { RoleEntity } from '../role/entities/role.entity';
import { StaffScheduleEntity } from '../staff-schedule/entities/staff-schedule.entity';
import { AccountTenantBranchEntity } from './entities/account-tenant-branch.entity';
import {
  AccountTenantEntity,
  MemberStatus,
} from './entities/account-tenant.entity';
import { MemberService, maskPhone } from './member.service';

const role = (code: string, name = `Name of ${code}`, isSeeded = true) =>
  new RoleEntity({ id: `role-${code}`, tenantId: 't1', code, name, isSeeded });
const SALES = role('sales_staff');
const MANAGER = role('branch_manager');
const OWNER = role('owner');
const CUSTOM = role('thu_ngan_ca_toi', 'Thu ngân ca tối', false);
const ROLES = [SALES, MANAGER, OWNER, CUSTOM];

const cashierAccount = new AccountEntity({
  id: 'a2' as AccountEntity['id'],
  email: 'cashier@example.com',
  name: 'Cashier',
});

describe('MemberService', () => {
  let em: {
    findOne: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let memberBranches: { find: jest.Mock };
  /** what em.findOne returns for a membership (null: not a member) */
  let memberRow: AccountTenantEntity | null;
  let sessions: { revokeAll: jest.Mock };
  let schedules: { today: jest.Mock; listFor: jest.Mock };
  let memberRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let listBuilder: Record<string, jest.Mock>;
  let accounts: { findOne: jest.Mock };
  let outbox: { add: jest.Mock };
  let service: MemberService;
  const errorCodeOf = (promise: Promise<unknown>) =>
    promise.catch((e) => e.getResponse().errorCode);

  beforeEach(() => {
    memberRow = null;
    em = {
      findOne: jest.fn(async (entity, options) => {
        if (entity === RoleEntity) {
          const { id, code } = options.where;
          return (
            ROLES.find(
              (r) =>
                options.where.tenantId === 't1' &&
                (id ? r.id === id : r.code === code),
            ) ?? null
          );
        }
        return memberRow;
      }),
      count: jest.fn().mockResolvedValue(0),
      insert: jest.fn(),
      save: jest.fn(async (e) => Object.assign(e, { createdAt: new Date() })),
      update: jest.fn(),
      delete: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ next: 4 }]),
      getRepository: jest.fn(() => ({
        metadata: {
          tableName: 'account_tenant',
          tablePath: 'platform.account_tenant',
        },
      })),
    };
    sessions = { revokeAll: jest.fn().mockResolvedValue(1) };
    schedules = {
      today: jest.fn().mockResolvedValue(new Map()),
      listFor: jest.fn().mockResolvedValue([]),
    };
    listBuilder = {};
    for (const name of [
      'innerJoinAndSelect',
      'where',
      'orderBy',
      'addOrderBy',
      'andWhere',
    ]) {
      listBuilder[name] = jest.fn(() => listBuilder);
    }
    listBuilder.getMany = jest.fn().mockResolvedValue([]);
    memberBranches = { find: jest.fn().mockResolvedValue([]) };
    memberRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => listBuilder),
    };
    accounts = { findOne: jest.fn().mockResolvedValue(cashierAccount) };
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: jest.fn((entity) =>
        entity === AccountTenantEntity
          ? memberRepo
          : entity === AccountTenantBranchEntity
            ? memberBranches
            : accounts,
      ),
      transaction: jest.fn((work) => work(em)),
    };
    service = new MemberService(
      dataSource as never,
      outbox as never,
      sessions as never,
      schedules as never,
    );
  });

  it('adds a registered account with a role id and writes the granted event', async () => {
    const member = await service.add('t1', 'owner-1', 'cashier@example.com', {
      roleId: 'role-sales_staff',
    });

    expect(em.save.mock.calls[0][0]).toMatchObject({
      accountId: 'a2',
      tenantId: 't1',
      role: 'sales_staff',
      roleId: 'role-sales_staff',
      status: 'active',
      code: 'NV004',
    });
    expect(outbox.add).toHaveBeenCalledWith(em, PLATFORM_MEMBERSHIP_GRANTED, {
      accountId: 'a2',
      email: 'cashier@example.com',
      role: 'sales_staff',
      changedBy: 'owner-1',
    });
    expect(member).toMatchObject({
      accountId: 'a2',
      role: 'sales_staff',
      roleId: 'role-sales_staff',
      roleName: 'Name of sales_staff',
      roleCode: 'sales_staff',
      branchIds: [],
    });
  });

  it.each([
    ['cashier', 'sales_staff'],
    ['manager', 'branch_manager'],
    ['branch_manager', 'branch_manager'],
  ])('accepts the legacy role %s and stores %s', async (legacy, code) => {
    await service.add('t1', 'owner-1', 'cashier@example.com', { role: legacy });

    expect(em.save.mock.calls[0][0]).toMatchObject({ role: code });
    expect(outbox.add).toHaveBeenCalledWith(
      em,
      PLATFORM_MEMBERSHIP_GRANTED,
      expect.objectContaining({ role: code }),
    );
  });

  it('gives a custom role by id and reports its code in the event', async () => {
    await service.add('t1', 'owner-1', 'cashier@example.com', {
      roleId: 'role-thu_ngan_ca_toi',
    });

    expect(outbox.add).toHaveBeenCalledWith(
      em,
      PLATFORM_MEMBERSHIP_GRANTED,
      expect.objectContaining({ role: 'thu_ngan_ca_toi' }),
    );
  });

  it('prefers roleId over the legacy role when both are sent', async () => {
    await service.add('t1', 'owner-1', 'cashier@example.com', {
      roleId: 'role-branch_manager',
      role: 'cashier',
    });

    expect(em.save.mock.calls[0][0]).toMatchObject({ role: 'branch_manager' });
  });

  it.each([
    ['an unknown role id', { roleId: 'role-nope' }, ErrorCode.R007],
    ['an unknown role name', { role: 'janitor' }, ErrorCode.R007],
    ['no role at all', {}, ErrorCode.R007],
    ['the owner role by id', { roleId: 'role-owner' }, ErrorCode.R008],
  ])('refuses %s', async (_what, input, code) => {
    await expect(
      errorCodeOf(service.add('t1', 'owner-1', 'cashier@example.com', input)),
    ).resolves.toBe(code);
    expect(em.save).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('refuses a role of another store (cross-tenant)', async () => {
    await expect(
      errorCodeOf(
        service.add('t2', 'owner-2', 'cashier@example.com', {
          roleId: 'role-sales_staff',
        }),
      ),
    ).resolves.toBe(ErrorCode.R007);
  });

  it('stores the branches of the member, distinct, when they all belong to the store', async () => {
    em.count.mockResolvedValue(2);

    await service.add(
      't1',
      'owner-1',
      'cashier@example.com',
      { role: 'cashier' },
      ['b1', 'b2', 'b1'],
    );

    expect(em.count).toHaveBeenCalledWith(BranchEntity, {
      where: { tenantId: 't1', id: expect.anything() },
    });
    expect(em.delete).toHaveBeenCalledWith(AccountTenantBranchEntity, {
      accountId: 'a2',
      tenantId: 't1',
    });
    expect(em.insert).toHaveBeenCalledWith(AccountTenantBranchEntity, [
      { accountId: 'a2', tenantId: 't1', branchId: 'b1' },
      { accountId: 'a2', tenantId: 't1', branchId: 'b2' },
    ]);
  });

  it('refuses a branch that is not in the store with T023', async () => {
    em.count.mockResolvedValue(1);

    await expect(
      errorCodeOf(
        service.add(
          't1',
          'owner-1',
          'cashier@example.com',
          { role: 'cashier' },
          ['b1', 'other-store-branch'],
        ),
      ),
    ).resolves.toBe(ErrorCode.T023);
    expect(em.save).not.toHaveBeenCalled();
  });

  it('inserts no branch rows when none is given (every branch)', async () => {
    await service.add('t1', 'owner-1', 'cashier@example.com', {
      role: 'cashier',
    });

    expect(em.insert).not.toHaveBeenCalled();
  });

  it('answers 404 for an email that has not registered', async () => {
    accounts.findOne.mockResolvedValue(null);

    await expect(
      service.add('t1', 'owner-1', 'nobody@example.com', { role: 'manager' }),
    ).rejects.toThrow(NotFoundException);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('rejects an account that already belongs to the store with T002', async () => {
    memberRow = new AccountTenantEntity();

    await expect(
      errorCodeOf(
        service.add('t1', 'owner-1', 'cashier@example.com', {
          role: 'manager',
        }),
      ),
    ).resolves.toBe(ErrorCode.T002);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  describe('update', () => {
    const salesMember = () =>
      new AccountTenantEntity({
        accountId: 'a2',
        tenantId: 't1',
        role: 'sales_staff',
        roleId: 'role-sales_staff',
        memberRole: SALES,
        account: cashierAccount,
      });

    it('changes a role and writes the role_changed event with the previous role code', async () => {
      memberRow = salesMember();

      const member = await service.update('t1', 'owner-1', 'a2', {
        roleId: 'role-branch_manager',
      });

      expect(em.update).toHaveBeenCalledWith(
        AccountTenantEntity,
        { accountId: 'a2', tenantId: 't1' },
        { role: 'branch_manager', roleId: 'role-branch_manager' },
      );
      expect(outbox.add).toHaveBeenCalledWith(
        em,
        PLATFORM_MEMBERSHIP_ROLE_CHANGED,
        {
          accountId: 'a2',
          email: 'cashier@example.com',
          role: 'branch_manager',
          previousRole: 'sales_staff',
          changedBy: 'owner-1',
        },
      );
      expect(member).toMatchObject({
        role: 'branch_manager',
        roleId: 'role-branch_manager',
        roleName: 'Name of branch_manager',
      });
    });

    it('accepts the legacy role name', async () => {
      memberRow = salesMember();

      await service.update('t1', 'owner-1', 'a2', { role: 'manager' });

      expect(em.update).toHaveBeenCalledWith(
        AccountTenantEntity,
        expect.anything(),
        { role: 'branch_manager', roleId: 'role-branch_manager' },
      );
    });

    it('writes no event when the role does not change', async () => {
      memberRow = salesMember();

      await service.update('t1', 'owner-1', 'a2', { role: 'cashier' });

      expect(em.update).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it('replaces the branches without touching the role or the events', async () => {
      memberRow = salesMember();
      em.count.mockResolvedValue(1);
      memberBranches.find.mockResolvedValue([
        { accountId: 'a2', tenantId: 't1', branchId: 'b1' },
      ]);

      const member = await service.update('t1', 'owner-1', 'a2', {}, ['b1']);

      expect(em.update).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
      expect(em.insert).toHaveBeenCalledWith(AccountTenantBranchEntity, [
        { accountId: 'a2', tenantId: 't1', branchId: 'b1' },
      ]);
      expect(member.branchIds).toEqual(['b1']);
    });

    it('an empty branch list gives every branch back (rows removed, none inserted)', async () => {
      memberRow = salesMember();

      await service.update('t1', 'owner-1', 'a2', {}, []);

      expect(em.delete).toHaveBeenCalledWith(AccountTenantBranchEntity, {
        accountId: 'a2',
        tenantId: 't1',
      });
      expect(em.insert).not.toHaveBeenCalled();
    });

    it('leaves the branches alone when branchIds is absent', async () => {
      memberRow = salesMember();

      await service.update('t1', 'owner-1', 'a2', { role: 'manager' });

      expect(em.delete).not.toHaveBeenCalled();
    });

    it('refuses a branch outside the store with T023', async () => {
      memberRow = salesMember();
      em.count.mockResolvedValue(0);

      await expect(
        errorCodeOf(service.update('t1', 'owner-1', 'a2', {}, ['nope'])),
      ).resolves.toBe(ErrorCode.T023);
    });

    it('refuses an unknown role id (R007) and the owner role (R008)', async () => {
      memberRow = salesMember();

      await expect(
        errorCodeOf(
          service.update('t1', 'owner-1', 'a2', { roleId: 'role-nope' }),
        ),
      ).resolves.toBe(ErrorCode.R007);
      await expect(
        errorCodeOf(
          service.update('t1', 'owner-1', 'a2', { roleId: 'role-owner' }),
        ),
      ).resolves.toBe(ErrorCode.R008);
      expect(em.update).not.toHaveBeenCalled();
    });

    it.each([
      ['a role', { role: 'cashier' }, undefined],
      ['branches', {}, ['b1']],
    ])(
      'never changes %s of the owner (T003)',
      async (_what, input, branches) => {
        memberRow = new AccountTenantEntity({
          accountId: 'a1',
          tenantId: 't1',
          role: 'owner',
          roleId: 'role-owner',
          memberRole: OWNER,
          account: cashierAccount,
        });

        await expect(
          errorCodeOf(service.update('t1', 'owner-1', 'a1', input, branches)),
        ).resolves.toBe(ErrorCode.T003);
        expect(em.update).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for a member of another store', async () => {
      memberRow = null;

      await expect(
        service.update('t1', 'owner-1', 'a9', { role: 'cashier' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lock, unlock and remove', () => {
    const membership = (overrides: Partial<AccountTenantEntity> = {}) =>
      new AccountTenantEntity({
        accountId: 'a2',
        tenantId: 't1',
        role: 'sales_staff',
        roleId: 'role-sales_staff',
        memberRole: SALES,
        status: MemberStatus.ACTIVE,
        code: 'NV002',
        account: cashierAccount,
        ...overrides,
      });

    it('locks a member and ends their sessions in this store only', async () => {
      memberRepo.findOne.mockResolvedValue(membership());

      const member = await service.lock('t1', 'owner-1', 'a2');

      expect(memberRepo.update).toHaveBeenCalledWith(
        { accountId: 'a2', tenantId: 't1' },
        { status: 'locked' },
      );
      expect(sessions.revokeAll).toHaveBeenCalledWith('a2', { tenantId: 't1' });
      expect(member).toMatchObject({ status: 'locked', code: 'NV002' });
      expect(outbox.add).not.toHaveBeenCalled();
    });

    it.each([
      ['the owner', membership({ role: 'owner' }), ErrorCode.T005],
      ['yourself', membership(), ErrorCode.T004, 'a2'],
    ])('refuses to lock %s', async (_who, row, code, actor = 'owner-1') => {
      memberRepo.findOne.mockResolvedValue(row);

      await expect(errorCodeOf(service.lock('t1', actor, 'a2'))).resolves.toBe(
        code,
      );
      expect(memberRepo.update).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('answers 404 for a member of another store (cross-tenant)', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(service.lock('t2', 'owner-2', 'a2')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.unlock('t2', 'a2')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get('t2', 'a2')).rejects.toThrow(NotFoundException);
      expect(memberRepo.findOne.mock.calls[0][0].where).toEqual({
        accountId: 'a2',
        tenantId: 't2',
      });
    });

    it('unlocks a member', async () => {
      memberRepo.findOne.mockResolvedValue(
        membership({ status: MemberStatus.LOCKED }),
      );

      const member = await service.unlock('t1', 'a2');

      expect(memberRepo.update).toHaveBeenCalledWith(
        { accountId: 'a2', tenantId: 't1' },
        { status: 'active' },
      );
      expect(member.status).toBe('active');
    });

    it('removes the membership and its shifts, then ends the sessions', async () => {
      memberRow = membership();

      await service.remove('t1', 'owner-1', 'a2');

      expect(em.delete).toHaveBeenCalledWith(StaffScheduleEntity, {
        accountId: 'a2',
        tenantId: 't1',
      });
      expect(em.delete).toHaveBeenCalledWith(AccountTenantEntity, {
        accountId: 'a2',
        tenantId: 't1',
      });
      expect(sessions.revokeAll).toHaveBeenCalledWith('a2', { tenantId: 't1' });
    });

    it.each([
      ['the owner', membership({ role: 'owner' }), 'owner-1', ErrorCode.T005],
      ['yourself', membership(), 'a2', ErrorCode.T004],
    ])('refuses to remove %s', async (_who, row, actor, code) => {
      memberRow = row;

      await expect(
        errorCodeOf(service.remove('t1', actor, 'a2')),
      ).resolves.toBe(code);
      expect(em.delete).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('answers 404 when removing a member of another store', async () => {
      memberRow = null;

      await expect(service.remove('t2', 'o', 'a2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list, detail and summary', () => {
    const row = (
      accountId: string,
      status: MemberStatus,
      code = 'sales_staff',
    ) =>
      new AccountTenantEntity({
        accountId,
        tenantId: 't1',
        role: code,
        roleId: `role-${code}`,
        memberRole: ROLES.find((r) => r.code === code),
        status,
        code: `NV00${accountId.slice(1)}`,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        account: new AccountEntity({
          id: accountId as AccountEntity['id'],
          email: `${accountId}@x.vn`,
          name: accountId,
          phone: '0901234567',
          lastLoginAt: new Date('2026-10-20T01:00:00Z'),
        }),
      });

    it('lists the store with the new fields, masking the phone and adding today’s shift', async () => {
      listBuilder.getMany.mockResolvedValue([
        row('a1', MemberStatus.ACTIVE, 'owner'),
      ]);
      schedules.today.mockResolvedValue(
        new Map([
          ['a1', [{ branchId: 'b1', label: '08:00–16:00', isOnShift: true }]],
        ]),
      );
      memberBranches.find.mockResolvedValue([
        { accountId: 'a1', tenantId: 't1', branchId: 'b2' },
        { accountId: 'a1', tenantId: 't1', branchId: 'b1' },
      ]);

      const [member] = await service.list('t1');

      expect(listBuilder.where).toHaveBeenCalledWith(
        'member.tenantId = :tenantId',
        {
          tenantId: 't1',
        },
      );
      expect(member).toMatchObject({
        accountId: 'a1',
        code: 'NV001',
        status: 'active',
        role: 'owner',
        roleName: 'Name of owner',
        roleId: 'role-owner',
        roleCode: 'owner',
        branchIds: ['b1', 'b2'],
        isOwner: true,
        phone: '090•••••67',
        isOnShift: true,
        scheduleLabel: '08:00–16:00',
        lastLoginAt: new Date('2026-10-20T01:00:00Z'),
      });
    });

    it('adds filters only when given, escaping the search text', async () => {
      await service.list('t1', {
        q: 'a_%',
        status: MemberStatus.LOCKED,
        role: 'manager',
        roleId: 'role-uuid',
      });

      expect(listBuilder.andWhere).toHaveBeenCalledWith(
        'member.status = :status',
        {
          status: 'locked',
        },
      );
      // the legacy name is read as the role it became
      expect(listBuilder.andWhere).toHaveBeenCalledWith(
        'memberRole.code = :role',
        { role: 'branch_manager' },
      );
      expect(listBuilder.andWhere).toHaveBeenCalledWith(
        'member.roleId = :roleId',
        { roleId: 'role-uuid' },
      );
      expect(listBuilder.andWhere.mock.calls[3][1]).toEqual({ q: '%a\\_\\%%' });
      listBuilder.andWhere.mockClear();
      await service.list('t1');
      expect(listBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('returns the detail with the member’s shifts', async () => {
      memberRepo.findOne.mockResolvedValue(row('a2', MemberStatus.LOCKED));
      schedules.listFor.mockResolvedValue([{ id: 's1' }]);

      const member = await service.get('t1', 'a2');

      expect(member).toMatchObject({
        accountId: 'a2',
        status: 'locked',
        schedules: [{ id: 's1' }],
      });
    });

    it('summarises counts, who is on shift now and per branch', async () => {
      memberRepo.find.mockResolvedValue([
        row('a1', MemberStatus.ACTIVE, 'owner'),
        row('a2', MemberStatus.ACTIVE),
        row('a3', MemberStatus.LOCKED),
      ]);
      schedules.today.mockResolvedValue(
        new Map([
          ['a1', [{ branchId: 'b1', label: 'x', isOnShift: true }]],
          [
            'a2',
            [
              { branchId: 'b1', label: 'x', isOnShift: true },
              { branchId: 'b2', label: 'y', isOnShift: false },
            ],
          ],
          // a locked member never counts as on shift
          ['a3', [{ branchId: 'b2', label: 'x', isOnShift: true }]],
        ]),
      );
      // tenant lookup and branch lookup both go through the data source
      const repos = new Map<
        unknown,
        { findOneByOrFail?: jest.Mock; find?: jest.Mock }
      >();
      const dataSource = {
        getRepository: jest.fn((entity: { name: string }) => {
          if (entity === AccountTenantEntity) return memberRepo;
          if (!repos.has(entity.name))
            repos.set(entity.name, {
              findOneByOrFail: jest
                .fn()
                .mockResolvedValue({ name: 'Mộc Store' }),
              find: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Quận 3' }]),
            });
          return repos.get(entity.name);
        }),
        transaction: jest.fn(),
      };
      const summaryService = new MemberService(
        dataSource as never,
        outbox as never,
        sessions as never,
        schedules as never,
      );

      const summary = await summaryService.summary('t1');

      expect(summary).toEqual({
        total: 3,
        active: 2,
        locked: 1,
        onShift: 2,
        onShiftByBranch: [{ branchId: 'b1', branchName: 'Quận 3', count: 2 }],
        defaultRoleCount: 5,
        dataScope: 'Mộc Store',
      });
    });
  });

  it.each([
    ['0901234567', '090•••••67'],
    ['12345', '•••••'],
    [null, null],
  ])('masks the phone %s as %s', (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });
});
