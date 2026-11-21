import { diffFields, isSecretKey, loadAdminActor } from './admin-actor';

describe('diffFields', () => {
  it('lists only what changed, before and after', () => {
    expect(
      diffFields({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: 2 }),
    ).toEqual({ b: { from: 'x', to: 'y' }, c: { from: null, to: 2 } });
    expect(diffFields({ a: 1 }, { a: 1 })).toEqual({});
  });

  it('never carries a secret-looking key', () => {
    expect(
      diffFields(
        { password: 'old', 'email.apiKey': 'k1', name: 'a' },
        { password: 'new', 'email.apiKey': 'k2', name: 'b' },
      ),
    ).toEqual({ name: { from: 'a', to: 'b' } });
    expect(isSecretKey('security.lockoutMaxAttempts')).toBe(false);
    expect(isSecretKey('smtp.password')).toBe(true);
  });
});

describe('loadAdminActor', () => {
  it('reads the name and role of the admin', async () => {
    const em = {
      findOne: jest.fn(async () => ({ name: 'Lan Anh', role: 'super_admin' })),
    };
    await expect(loadAdminActor(em as never, 'a1')).resolves.toEqual({
      type: 'platform_admin',
      id: 'a1',
      name: 'Lan Anh',
      role: 'super_admin',
    });
  });
});
