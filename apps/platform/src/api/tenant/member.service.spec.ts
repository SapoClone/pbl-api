import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import {
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
} from '@pbl/contracts';
import { AccountEntity } from '../account/entities/account.entity';
import { StaffScheduleEntity } from '../staff-schedule/entities/staff-schedule.entity';
import {
  AccountTenantEntity,
  MemberStatus,
  TenantRole,
} from './entities/account-tenant.entity';
import { MemberService, maskPhone } from './member.service';

const cashierAccount = new AccountEntity({
  id: 'a2' as AccountEntity['id'],
  email: 'cashier@example.com',
  name: 'Cashier',
});

describe('MemberService', () => {
  let em: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    query: jest.Mock;
    getRepository: jest.Mock;
  };
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
    em = {
      findOne: jest.fn().mockResolvedValue(null),
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
        entity === AccountTenantEntity ? memberRepo : accounts,
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

  it('adds a registered account with a role and writes the granted event', async () => {
    const member = await service.add(
      't1',
      'owner-1',
      'cashier@example.com',
      TenantRole.CASHIER,
    );

    expect(em.save.mock.calls[0][0]).toMatchObject({
      accountId: 'a2',
      tenantId: 't1',
      role: 'cashier',
      status: 'active',
      code: 'NV004',
    });
    expect(outbox.add).toHaveBeenCalledWith(em, PLATFORM_MEMBERSHIP_GRANTED, {
      accountId: 'a2',
      email: 'cashier@example.com',
      role: 'cashier',
      changedBy: 'owner-1',
    });
    expect(member).toMatchObject({ accountId: 'a2', role: 'cashier' });
  });

  it('answers 404 for an email that has not registered', async () => {
    accounts.findOne.mockResolvedValue(null);

    await expect(
      service.add('t1', 'owner-1', 'nobody@example.com', TenantRole.MANAGER),
    ).rejects.toThrow(NotFoundException);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('rejects an account that already belongs to the store with T002', async () => {
    em.findOne.mockResolvedValue(new AccountTenantEntity());

    await expect(
      errorCodeOf(
        service.add('t1', 'owner-1', 'cashier@example.com', TenantRole.MANAGER),
      ),
    ).resolves.toBe(ErrorCode.T002);
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('changes a role and writes the role_changed event with the previous role', async () => {
    em.findOne.mockResolvedValue(
      new AccountTenantEntity({
        accountId: 'a2',
        tenantId: 't1',
        role: TenantRole.CASHIER,
        account: cashierAccount,
      }),
    );

    const member = await service.changeRole(
      't1',
      'owner-1',
      'a2',
      TenantRole.MANAGER,
    );

    expect(em.update).toHaveBeenCalledWith(
      AccountTenantEntity,
      { accountId: 'a2', tenantId: 't1' },
      { role: 'manager' },
    );
    expect(outbox.add).toHaveBeenCalledWith(
      em,
      PLATFORM_MEMBERSHIP_ROLE_CHANGED,
      {
        accountId: 'a2',
        email: 'cashier@example.com',
        role: 'manager',
        previousRole: 'cashier',
        changedBy: 'owner-1',
      },
    );
    expect(member.role).toBe('manager');
  });

  it('writes no event when the role does not change', async () => {
    em.findOne.mockResolvedValue(
      new AccountTenantEntity({
        accountId: 'a2',
        tenantId: 't1',
        role: TenantRole.CASHIER,
        account: cashierAccount,
      }),
    );

    await service.changeRole('t1', 'owner-1', 'a2', TenantRole.CASHIER);

    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('never changes the owner role (T003)', async () => {
    em.findOne.mockResolvedValue(
      new AccountTenantEntity({
        accountId: 'a1',
        tenantId: 't1',
        role: TenantRole.OWNER,
        account: cashierAccount,
      }),
    );

    await expect(
      errorCodeOf(
        service.changeRole('t1', 'owner-1', 'a1', TenantRole.CASHIER),
      ),
    ).resolves.toBe(ErrorCode.T003);
  });

  it('answers 404 for a member of another store', async () => {
    em.findOne.mockResolvedValue(null);

    await expect(
      service.changeRole('t1', 'owner-1', 'a9', TenantRole.CASHIER),
    ).rejects.toThrow(NotFoundException);
  });

  describe('lock, unlock and remove', () => {
    const membership = (overrides: Partial<AccountTenantEntity> = {}) =>
      new AccountTenantEntity({
        accountId: 'a2',
        tenantId: 't1',
        role: TenantRole.CASHIER,
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
      ['the owner', membership({ role: TenantRole.OWNER }), ErrorCode.T005],
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
      em.findOne.mockResolvedValue(membership());

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
      [
        'the owner',
        membership({ role: TenantRole.OWNER }),
        'owner-1',
        ErrorCode.T005,
      ],
      ['yourself', membership(), 'a2', ErrorCode.T004],
    ])('refuses to remove %s', async (_who, row, actor, code) => {
      em.findOne.mockResolvedValue(row);

      await expect(
        errorCodeOf(service.remove('t1', actor, 'a2')),
      ).resolves.toBe(code);
      expect(em.delete).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('answers 404 when removing a member of another store', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(service.remove('t2', 'o', 'a2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list, detail and summary', () => {
    const row = (
      accountId: string,
      status: MemberStatus,
      role = TenantRole.CASHIER,
    ) =>
      new AccountTenantEntity({
        accountId,
        tenantId: 't1',
        role,
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
        row('a1', MemberStatus.ACTIVE, TenantRole.OWNER),
      ]);
      schedules.today.mockResolvedValue(
        new Map([
          ['a1', [{ branchId: 'b1', label: '08:00–16:00', isOnShift: true }]],
        ]),
      );

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
        roleName: 'Chủ cửa hàng',
        roleId: null,
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
        role: TenantRole.MANAGER,
      });

      expect(listBuilder.andWhere).toHaveBeenCalledWith(
        'member.status = :status',
        {
          status: 'locked',
        },
      );
      expect(listBuilder.andWhere).toHaveBeenCalledWith('member.role = :role', {
        role: 'manager',
      });
      expect(listBuilder.andWhere.mock.calls[2][1]).toEqual({ q: '%a\\_\\%%' });
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
        row('a1', MemberStatus.ACTIVE, TenantRole.OWNER),
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
        defaultRoleCount: 3,
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
