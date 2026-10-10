import { Repository } from 'typeorm';
import { AccountService } from './account.service';
import { AccountEntity, AccountStatus } from './entities/account.entity';

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
  let repository: { findOneByOrFail: jest.Mock; save: jest.Mock };
  let service: AccountService;

  beforeEach(() => {
    repository = {
      findOneByOrFail: jest.fn().mockImplementation(async () => stored()),
      save: jest.fn(async (e) => e),
    };
    service = new AccountService(
      repository as unknown as Repository<AccountEntity>,
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
});
