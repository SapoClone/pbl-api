import { verifyPassword } from '@/utils/password.util';
import { AccountEntity } from './account.entity';

describe('AccountEntity password hashing', () => {
  it('should hash a new password before insert', async () => {
    const user = new AccountEntity({ password: 'Passw0rd!' });

    await user.hashPassword();

    expect(user.password).not.toBe('Passw0rd!');
    expect(await verifyPassword('Passw0rd!', user.password)).toBe(true);
  });

  it('should not re-hash the stored hash when saving a loaded user', async () => {
    const user = new AccountEntity({ password: 'Passw0rd!' });
    await user.hashPassword();
    const storedHash = user.password;

    // Simulate TypeORM loading the row, then updating an unrelated field
    const loaded = new AccountEntity({ password: storedHash });
    loaded.rememberLoadedPassword();
    loaded.name = 'hello';
    await loaded.hashPassword();

    expect(loaded.password).toBe(storedHash);
    expect(await verifyPassword('Passw0rd!', loaded.password)).toBe(true);
  });

  it('should hash a changed password on a loaded user', async () => {
    const user = new AccountEntity({ password: 'Passw0rd!' });
    await user.hashPassword();

    const loaded = new AccountEntity({ password: user.password });
    loaded.rememberLoadedPassword();
    loaded.password = 'N3wPassw0rd!';
    await loaded.hashPassword();

    expect(await verifyPassword('N3wPassw0rd!', loaded.password)).toBe(true);
  });
});
