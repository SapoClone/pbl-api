import { ErrorCode } from '@/constants/error-code.constant';
import { NotFoundException } from '@nestjs/common';
import {
  PLATFORM_MEMBERSHIP_GRANTED,
  PLATFORM_MEMBERSHIP_ROLE_CHANGED,
} from '@pbl/contracts';
import { AccountEntity } from '../account/entities/account.entity';
import {
  AccountTenantEntity,
  TenantRole,
} from './entities/account-tenant.entity';
import { MemberService } from './member.service';

const cashierAccount = new AccountEntity({
  id: 'a2' as AccountEntity['id'],
  email: 'cashier@example.com',
  name: 'Cashier',
});

describe('MemberService', () => {
  let em: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
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
    };
    accounts = { findOne: jest.fn().mockResolvedValue(cashierAccount) };
    outbox = { add: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      getRepository: jest.fn(() => accounts),
      transaction: jest.fn((work) => work(em)),
    };
    service = new MemberService(dataSource as never, outbox as never);
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
});
