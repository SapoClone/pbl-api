import Redis from 'ioredis';
import { sessionDenyListKey } from './auth.constants';
import { AuthUser } from './auth.types';
import { RedisSessionRevocation } from './redis-session-revocation';

jest.mock('ioredis');

const user = { id: 'u1', sessionId: 'sid-1' } as AuthUser;

describe('RedisSessionRevocation', () => {
  const exists = jest.fn();
  const redis = { exists } as unknown as Redis;

  beforeEach(() => jest.clearAllMocks());

  it('should report a session as revoked when its deny-list key exists', async () => {
    exists.mockResolvedValue(1);

    await expect(
      new RedisSessionRevocation(redis).isSessionRevoked(user),
    ).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith(sessionDenyListKey('sid-1'));
    expect(sessionDenyListKey('sid-1')).toBe('auth:session-blacklist:sid-1');
  });

  it('should report a session as not revoked when the key is absent', async () => {
    exists.mockResolvedValue(0);

    await expect(
      new RedisSessionRevocation(redis).isSessionRevoked(user),
    ).resolves.toBe(false);
  });

  it('should propagate store errors instead of treating them as "not revoked"', async () => {
    exists.mockRejectedValue(new Error('redis down'));

    await expect(
      new RedisSessionRevocation(redis).isSessionRevoked(user),
    ).rejects.toThrow('redis down');
  });

  describe('fromEnv', () => {
    it('should return null without a host', () => {
      expect(RedisSessionRevocation.fromEnv({})).toBeNull();
      expect(RedisSessionRevocation.fromEnv({ host: '' })).toBeNull();
    });

    it('should build a client from the env values', () => {
      const revocation = RedisSessionRevocation.fromEnv({
        host: 'r',
        port: '6380',
        password: 'pw',
        tls: 'true',
      });

      expect(revocation).toBeInstanceOf(RedisSessionRevocation);
      expect(Redis).toHaveBeenCalledWith({
        host: 'r',
        port: 6380,
        password: 'pw',
        tls: {},
        lazyConnect: false,
        maxRetriesPerRequest: 1,
      });
    });

    it('should default the port and leave password and tls off', () => {
      RedisSessionRevocation.fromEnv({ host: 'r', password: '' });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 6379,
          password: undefined,
          tls: undefined,
        }),
      );
    });
  });
});
