import { ErrorCode } from '@/constants/error-code.constant';
import { hashPassword } from '@/utils/password.util';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '@pbl/auth';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import { AccessTokenService } from '../auth/access-token.service';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from '../auth/refresh-token.service';
import {
  PlatformAdminEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from './entities/platform-admin.entity';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

const PASSWORD = 'CorrectHorse123!';
const REFRESH_TOKEN = 'r'.repeat(43);

describe('PlatformAdminAuthService', () => {
  let passwordHash: string;
  let admins: {
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilder: Record<string, jest.Mock>;
  let accessTokens: { sign: jest.Mock };
  let refreshTokens: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revokeFamily: jest.Mock;
  };
  let cache: { store: { set: jest.Mock } };
  let service: PlatformAdminAuthService;

  const admin = (overrides: Partial<PlatformAdminEntity> = {}) =>
    ({
      id: 'admin-1',
      email: 'lan@omni.vn',
      name: 'Lan Anh',
      password: passwordHash,
      role: PlatformAdminRole.SUPER_ADMIN,
      status: PlatformAdminStatus.ACTIVE,
      failedLoginCount: 0,
      lockedUntil: null,
      ...overrides,
    }) as PlatformAdminEntity;
  const login = (password = PASSWORD) =>
    service.signIn({ email: 'lan@omni.vn', password });
  const errorCodeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (
        (
          error as { getResponse?: () => { errorCode?: string } }
        ).getResponse?.().errorCode ?? error
      );
    }
    return 'no error';
  };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    queryBuilder = {};
    for (const method of ['update', 'set', 'where', 'setParameters']) {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    queryBuilder.execute = jest.fn().mockResolvedValue(undefined);
    admins = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    accessTokens = { sign: jest.fn().mockResolvedValue('access-token') };
    refreshTokens = {
      issue: jest
        .fn()
        .mockResolvedValue({ token: REFRESH_TOKEN, familyId: 'family-1' }),
      rotate: jest.fn(),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
    };
    cache = { store: { set: jest.fn().mockResolvedValue(undefined) } };
    const values: Record<string, string> = {
      'auth.expires': '15m',
      'app.nodeEnv': 'production',
    };
    service = new PlatformAdminAuthService(
      admins as unknown as Repository<PlatformAdminEntity>,
      accessTokens as unknown as AccessTokenService,
      refreshTokens as unknown as RefreshTokenService,
      { getOrThrow: (key: string) => values[key] } as unknown as ConfigService,
      cache as unknown as Cache,
    );
  });

  describe('signIn', () => {
    it('should return a token pair and the admin, as a platform_admin session without a store', async () => {
      admins.findOne.mockResolvedValue(admin());

      const result = await login();

      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: REFRESH_TOKEN,
        admin: {
          id: 'admin-1',
          name: 'Lan Anh',
          email: 'lan@omni.vn',
          role: 'super_admin',
        },
      });
      expect(result.tokenExpires).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect(result.admin).not.toHaveProperty('password');
      expect(refreshTokens.issue).toHaveBeenCalledWith(
        'admin-1',
        null,
        undefined,
        'platform_admin',
      );
      expect(accessTokens.sign).toHaveBeenCalledWith({
        userId: 'admin-1',
        sessionId: 'family-1',
        subjectType: 'platform_admin',
        roles: ['super_admin'],
      });
      expect(admins.update).toHaveBeenCalledWith(
        { id: 'admin-1' },
        expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      );
    });

    it('should answer A001 for an unknown email', async () => {
      admins.findOne.mockResolvedValue(null);

      expect(await errorCodeOf(login())).toBe(ErrorCode.A001);
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('should answer A001 for a wrong password and count the failure', async () => {
      admins.findOne.mockResolvedValue(admin());

      expect(await errorCodeOf(login('WrongPassword1!'))).toBe(ErrorCode.A001);
      expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('should answer A001, not a different error, for a disabled admin even with the right password', async () => {
      admins.findOne.mockResolvedValue(
        admin({ status: PlatformAdminStatus.DISABLED }),
      );

      expect(await errorCodeOf(login())).toBe(ErrorCode.A001);
      expect(queryBuilder.execute).not.toHaveBeenCalled();
    });

    it('should answer A001 for an admin who has no password yet', async () => {
      admins.findOne.mockResolvedValue(admin({ password: null }));

      expect(await errorCodeOf(login())).toBe(ErrorCode.A001);
    });

    it('should answer A003 while locked, even with the right password, and not extend the lock', async () => {
      admins.findOne.mockResolvedValue(
        admin({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      expect(await errorCodeOf(login())).toBe(ErrorCode.A003);
      expect(queryBuilder.execute).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('should sign in again once the lock has passed', async () => {
      admins.findOne.mockResolvedValue(
        admin({ lockedUntil: new Date(Date.now() - 1000) }),
      );

      await expect(login()).resolves.toMatchObject({
        accessToken: 'access-token',
      });
    });
  });

  describe('refresh', () => {
    it('should rotate on the admin path and return a new pair', async () => {
      refreshTokens.rotate.mockResolvedValue({
        token: 'new-refresh',
        familyId: 'family-1',
        subjectId: 'admin-1',
        tenantId: null,
      });
      admins.findOne.mockResolvedValue(
        admin({ role: PlatformAdminRole.ADMIN }),
      );

      const result = await service.refresh({ refreshToken: REFRESH_TOKEN });

      expect(refreshTokens.rotate).toHaveBeenCalledWith(
        REFRESH_TOKEN,
        'platform_admin',
      );
      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'new-refresh',
      });
      expect(accessTokens.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'family-1',
          subjectType: 'platform_admin',
          roles: ['admin'],
        }),
      );
    });

    it('should end the session of an admin who has been disabled', async () => {
      refreshTokens.rotate.mockResolvedValue({
        token: 'new-refresh',
        familyId: 'family-1',
        subjectId: 'admin-1',
        tenantId: null,
      });
      admins.findOne.mockResolvedValue(
        admin({ status: PlatformAdminStatus.DISABLED }),
      );

      await expect(
        service.refresh({ refreshToken: REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('family-1');
      expect(cache.store.set).toHaveBeenCalled();
    });

    it('should kill the live access tokens of a family whose refresh token was reused', async () => {
      refreshTokens.rotate.mockRejectedValue(
        new RefreshTokenReuseError('family-9' as never),
      );

      await expect(
        service.refresh({ refreshToken: REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(RefreshTokenReuseError);
      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('family-9');
      expect(cache.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-9'),
        true,
        15 * 60_000,
      );
    });

    it('should pass on a refusal of the wrong kind of token', async () => {
      refreshTokens.rotate.mockRejectedValue(new UnauthorizedException());

      await expect(
        service.refresh({ refreshToken: REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should revoke the session and deny its access token until it expires', async () => {
      const user = {
        id: 'admin-1',
        sessionId: 'family-1',
        exp: Math.floor(Date.now() / 1000) + 600,
      } as AuthUser;

      await service.logout(user);

      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('family-1');
      expect(cache.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-1'),
        true,
        expect.any(Number),
      );
    });
  });

  describe('me', () => {
    const user = { id: 'admin-1' } as AuthUser;

    it('should return the admin and the environment', async () => {
      admins.findOne.mockResolvedValue(admin());

      await expect(service.me(user)).resolves.toMatchObject({
        id: 'admin-1',
        email: 'lan@omni.vn',
        role: 'super_admin',
        environment: 'production',
      });
    });

    it('should refuse an admin who no longer exists or has been disabled', async () => {
      admins.findOne.mockResolvedValue(null);
      await expect(service.me(user)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      admins.findOne.mockResolvedValue(
        admin({ status: PlatformAdminStatus.DISABLED }),
      );
      await expect(service.me(user)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
