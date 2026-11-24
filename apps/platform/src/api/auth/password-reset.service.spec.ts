import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { QueueService } from '@/queue/queue.service';
import { verifyPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import {
  PASSWORD_RESET_TTL_MS,
  PasswordResetService,
} from './password-reset.service';
import { SessionService } from './session.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let store: Map<string, string>;
  let ttls: Map<string, number>;
  let accounts: { findOne: jest.Mock; update: jest.Mock };
  let queue: { enqueuePasswordReset: jest.Mock };
  let sessions: { revokeAll: jest.Mock };

  const account = {
    id: 'acc-1',
    email: 'a@b.vn',
    password: 'hash',
    status: AccountStatus.ACTIVE,
  };

  /** the token inside the last queued link */
  const lastToken = (): string => {
    const calls = queue.enqueuePasswordReset.mock.calls;
    const url = new URL(calls[calls.length - 1][1]);
    return url.searchParams.get('token') as string;
  };

  beforeEach(async () => {
    store = new Map();
    ttls = new Map();
    accounts = { findOne: jest.fn(), update: jest.fn() };
    queue = { enqueuePasswordReset: jest.fn().mockResolvedValue(undefined) };
    sessions = { revokeAll: jest.fn().mockResolvedValue(2) };
    const cache = {
      get: jest.fn(async (k: string) => store.get(k)),
      set: jest.fn(async (k: string, v: string, ttl: number) => {
        store.set(k, v);
        ttls.set(k, ttl);
      }),
      del: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getRepositoryToken(AccountEntity), useValue: accounts },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: QueueService, useValue: queue },
        { provide: SessionService, useValue: sessions },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              key === 'web.appUrl' ? 'http://web.test' : undefined,
          },
        },
      ],
    }).compile();
    service = module.get(PasswordResetService);
  });

  describe('requestReset', () => {
    it('queues the link and stores only the hash of the token, for 60 minutes', async () => {
      accounts.findOne.mockResolvedValue(account);

      await service.requestReset('a@b.vn');

      expect(queue.enqueuePasswordReset).toHaveBeenCalledTimes(1);
      const [email, url] = queue.enqueuePasswordReset.mock.calls[0];
      expect(email).toBe('a@b.vn');
      expect(url).toMatch(
        /^http:\/\/web\.test\/reset-password\?token=[A-Za-z0-9_-]{43}$/,
      );
      const token = lastToken();
      const stored = [...store.entries()];
      expect(stored).toContainEqual([
        `auth:password-reset:${sha256(token)}`,
        'acc-1',
      ]);
      // the raw token is nowhere in the store, keys or values
      expect(JSON.stringify(stored)).not.toContain(token);
      expect([...ttls.values()]).toEqual([
        PASSWORD_RESET_TTL_MS,
        PASSWORD_RESET_TTL_MS,
      ]);
    });

    it.each([
      ['unknown email', null],
      ['disabled account', { ...account, status: AccountStatus.DISABLED }],
      ['account without a password', { ...account, password: null }],
    ])('does nothing for a %s and does not throw', async (_name, row) => {
      accounts.findOne.mockResolvedValue(row);

      await expect(service.requestReset('x@y.vn')).resolves.toBeUndefined();

      expect(queue.enqueuePasswordReset).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('does not throw when the queue fails (the answer must not reveal the account)', async () => {
      accounts.findOne.mockResolvedValue(account);
      queue.enqueuePasswordReset.mockRejectedValue(new Error('sqs down'));

      await expect(service.requestReset('a@b.vn')).resolves.toBeUndefined();
    });

    it('a second request replaces the first token, so the first link stops working', async () => {
      accounts.findOne.mockResolvedValue(account);
      await service.requestReset('a@b.vn');
      const first = lastToken();
      await service.requestReset('a@b.vn');
      const second = lastToken();
      expect(second).not.toBe(first);

      await expect(service.resetPassword(first, 'Passw0rd!x')).rejects.toEqual(
        new ValidationException(ErrorCode.E014),
      );
      await expect(
        service.resetPassword(second, 'Passw0rd!x'),
      ).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    beforeEach(async () => {
      accounts.findOne.mockResolvedValue(account);
      await service.requestReset('a@b.vn');
      accounts.findOne.mockClear();
    });

    it('sets an argon2 password, lifts the lock, revokes every session and spends the token', async () => {
      const token = lastToken();

      await service.resetPassword(token, 'NewPassw0rd!');

      const [where, set] = accounts.update.mock.calls[0];
      expect(where).toEqual({ id: 'acc-1' });
      expect(set.password).toMatch(/^\$argon2/);
      expect(await verifyPassword('NewPassw0rd!', set.password)).toBe(true);
      expect(set).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
      expect(sessions.revokeAll).toHaveBeenCalledWith('acc-1');
      expect(store.size).toBe(0);
    });

    it('refuses a token that was already used', async () => {
      const token = lastToken();
      await service.resetPassword(token, 'NewPassw0rd!');
      accounts.update.mockClear();
      sessions.revokeAll.mockClear();

      await expect(
        service.resetPassword(token, 'Another1!'),
      ).rejects.toMatchObject({ response: { errorCode: ErrorCode.E014 } });
      expect(accounts.update).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('refuses an unknown or expired token (nothing in the store)', async () => {
      await expect(
        service.resetPassword('not-a-token', 'NewPassw0rd!'),
      ).rejects.toMatchObject({ response: { errorCode: ErrorCode.E014 } });
      store.clear(); // the TTL removed it
      await expect(
        service.resetPassword(lastToken(), 'NewPassw0rd!'),
      ).rejects.toMatchObject({ response: { errorCode: ErrorCode.E014 } });
      expect(accounts.update).not.toHaveBeenCalled();
    });

    it('refuses the token of an account disabled meanwhile', async () => {
      accounts.findOne.mockResolvedValue({
        ...account,
        status: AccountStatus.DISABLED,
      });

      await expect(
        service.resetPassword(lastToken(), 'NewPassw0rd!'),
      ).rejects.toMatchObject({ response: { errorCode: ErrorCode.E014 } });
      expect(accounts.update).not.toHaveBeenCalled();
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });
  });
});
