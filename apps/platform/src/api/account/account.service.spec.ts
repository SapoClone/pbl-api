import { ErrorCode } from '@/constants/error-code.constant';
import { verifyPassword } from '@/utils/password.util';
import { Repository } from 'typeorm';
import { AccountService } from './account.service';
import { AccountEntity, AccountStatus } from './entities/account.entity';

jest.mock('@/utils/password.util', () => ({
  ...jest.requireActual('@/utils/password.util'),
  verifyPassword: jest.fn(),
}));

describe('AccountService', () => {
  const stored = () =>
    new AccountEntity({
      id: 'a1' as AccountEntity['id'],
      email: 'me@example.com',
      password: '$argon2id$stored',
      name: 'Old',
      phone: '0900000000',
      status: AccountStatus.ACTIVE,
      createdAt: new Date('2026-10-10T00:00:00Z'),
    });
  let repository: {
    findOneByOrFail: jest.Mock;
    findOneOrFail: jest.Mock;
    save: jest.Mock;
  };
  let sessions: { revokeAll: jest.Mock; list: jest.Mock; revokeOne: jest.Mock };
  let service: AccountService;

  beforeEach(() => {
    repository = {
      findOneByOrFail: jest.fn().mockImplementation(async () => stored()),
      findOneOrFail: jest.fn().mockImplementation(async () => stored()),
      save: jest.fn(async (e) => e),
    };
    sessions = {
      revokeAll: jest.fn().mockResolvedValue(2),
      list: jest.fn().mockResolvedValue([{ id: 's1' }]),
      revokeOne: jest.fn().mockResolvedValue(undefined),
    };
    service = new AccountService(
      repository as unknown as Repository<AccountEntity>,
      sessions as never,
    );
  });

  it('returns the caller without the password', async () => {
    const me = await service.getMe('a1');

    expect(repository.findOneByOrFail).toHaveBeenCalledWith({ id: 'a1' });
    expect(me).toMatchObject({
      id: 'a1',
      email: 'me@example.com',
      name: 'Old',
      phone: '0900000000',
      status: 'active',
    });
    expect(me).not.toHaveProperty('password');
  });

  it('updates only the fields sent and records the actor', async () => {
    const me = await service.updateMe('a1', { name: 'New' });

    const saved: AccountEntity = repository.save.mock.calls[0][0];
    expect(saved.name).toBe('New');
    expect(saved.phone).toBe('0900000000');
    expect(saved.updatedBy).toBe('a1');
    expect(me.name).toBe('New');
  });

  it('clears the phone when null is sent', async () => {
    await service.updateMe('a1', { phone: null });

    expect(repository.save.mock.calls[0][0].phone).toBeNull();
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'old-pass', newPassword: 'new-pass-1' };

    it('verifies the current password, sets the new one and ends the other sessions', async () => {
      (verifyPassword as jest.Mock).mockResolvedValue(true);

      await service.changePassword('a1', 'sid-current', dto);

      expect(verifyPassword).toHaveBeenCalledWith(
        'old-pass',
        '$argon2id$stored',
      );
      const saved: AccountEntity = repository.save.mock.calls[0][0];
      // the plain value is hashed by the entity's BeforeUpdate hook on save
      expect(saved.password).toBe('new-pass-1');
      expect(saved.updatedBy).toBe('a1');
      expect(sessions.revokeAll).toHaveBeenCalledWith('a1', {
        exceptSessionId: 'sid-current',
      });
    });

    it('rejects a wrong current password with E015 and changes nothing', async () => {
      (verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        service
          .changePassword('a1', 'sid-current', dto)
          .catch((e) => e.getResponse().errorCode),
      ).resolves.toBe(ErrorCode.E015);
      expect(repository.save).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });
  });

  it('lists and revokes sessions through the session service', async () => {
    await expect(service.listSessions('a1', 'sid')).resolves.toEqual([
      { id: 's1' },
    ]);
    await service.revokeSession('a1', 's1');

    expect(sessions.list).toHaveBeenCalledWith('a1', 'sid');
    expect(sessions.revokeOne).toHaveBeenCalledWith('a1', 's1');
  });
});
