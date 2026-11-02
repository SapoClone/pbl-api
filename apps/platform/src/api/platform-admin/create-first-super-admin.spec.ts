import { DataSource } from 'typeorm';
import {
  createFirstSuperAdmin,
  InvalidBootstrapInput,
} from './create-first-super-admin';

const input = {
  email: 'Lan@Omni.vn',
  name: 'Lan Anh',
  password: 'CorrectHorse123!',
};

/** A DataSource whose transaction runs the callback with the given repository */
const dataSource = (exists: boolean) => {
  const save = jest.fn(async (admin: Record<string, unknown>) => ({
    ...admin,
    id: 'admin-1',
  }));
  const query = jest.fn().mockResolvedValue(undefined);
  const em = {
    query,
    getRepository: () => ({
      exists: jest.fn().mockResolvedValue(exists),
      save,
    }),
  };
  return {
    ds: {
      transaction: (work: (e: typeof em) => unknown) => work(em),
    } as unknown as DataSource,
    save,
    query,
  };
};

describe('createFirstSuperAdmin', () => {
  it('should create a super admin with a lower-cased email, under the bootstrap lock', async () => {
    const { ds, save, query } = dataSource(false);

    await expect(createFirstSuperAdmin(ds, input)).resolves.toEqual({
      status: 'created',
      id: 'admin-1',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    expect(save.mock.calls[0][0]).toMatchObject({
      email: 'lan@omni.vn',
      name: 'Lan Anh',
      role: 'super_admin',
      status: 'active',
    });
  });

  it('should change nothing when a super admin already exists', async () => {
    const { ds, save } = dataSource(true);

    await expect(createFirstSuperAdmin(ds, input)).resolves.toEqual({
      status: 'exists',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['an empty name', { name: '   ' }],
    ['a short password', { password: 'Short1!' }],
    [
      'a password the sign-in form would refuse',
      { password: 'has spaces and-dashes-1' },
    ],
  ])(
    'should refuse %s without touching the database',
    async (_what, change) => {
      const { ds, save } = dataSource(false);

      await expect(
        createFirstSuperAdmin(ds, { ...input, ...change }),
      ).rejects.toBeInstanceOf(InvalidBootstrapInput);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('should never put the password in an error message', async () => {
    const { ds } = dataSource(false);

    await expect(
      createFirstSuperAdmin(ds, { ...input, password: 'short pw' }),
    ).rejects.not.toThrow(/short pw/);
  });
});
