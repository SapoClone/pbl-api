import { QueueService } from '@/queue/queue.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { AccessTokenService } from './access-token.service';
import { AuthService } from './auth.service';
import { RegisterReqDto } from './dto/register.req.dto';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from './refresh-token.service';

describe('AuthService', () => {
  let service: AuthService;
  let configServiceValue: Partial<Record<keyof ConfigService, jest.Mock>>;
  let jwtServiceValue: Partial<Record<keyof JwtService, jest.Mock>>;
  let userRepositoryValue: Partial<
    Record<keyof Repository<UserEntity>, jest.Mock>
  >;
  let queueServiceValue: Partial<Record<keyof QueueService, jest.Mock>>;
  let cacheManagerValue: { set: jest.Mock; store: { set: jest.Mock } };
  let refreshTokenServiceValue: Record<
    'issue' | 'rotate' | 'revokeFamily',
    jest.Mock
  >;
  let accessTokenServiceValue: { sign: jest.Mock };

  beforeAll(async () => {
    configServiceValue = {
      get: jest.fn(),
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'auth.confirmEmailExpires': '1d',
          'auth.confirmEmailSecret': 'secret_for_confirm_email',
          'auth.expires': '15m',
        };
        return values[key];
      }),
    };

    jwtServiceValue = {
      sign: jest.fn(),
      verify: jest.fn(),
      signAsync: jest.fn(),
    };

    userRepositoryValue = {
      findOne: jest.fn(),
    };

    queueServiceValue = {
      enqueueEmailVerification: jest.fn(),
    };

    cacheManagerValue = {
      set: jest.fn(),
      store: { set: jest.fn() },
    };

    refreshTokenServiceValue = {
      issue: jest.fn(),
      rotate: jest.fn(),
      revokeFamily: jest.fn(),
    };

    accessTokenServiceValue = { sign: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: configServiceValue,
        },
        {
          provide: JwtService,
          useValue: jwtServiceValue,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepositoryValue,
        },
        {
          provide: QueueService,
          useValue: queueServiceValue,
        },
        {
          provide: RefreshTokenService,
          useValue: refreshTokenServiceValue,
        },
        {
          provide: AccessTokenService,
          useValue: accessTokenServiceValue,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManagerValue,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should enqueue an email-verification Cloud Task with the registered email and generated token', async () => {
      const dto: RegisterReqDto = {
        email: 'newuser@example.com',
        password: 'Password123!',
      };
      const verificationToken = 'signed.jwt.token';

      jest.spyOn(UserEntity, 'exists').mockResolvedValue(false);
      jest
        .spyOn(UserEntity.prototype, 'save')
        .mockImplementation(async function (this: UserEntity) {
          this.id = 'user-id-1' as UserEntity['id'];
          return this;
        });
      (jwtServiceValue.signAsync as jest.Mock).mockResolvedValue(
        verificationToken,
      );

      const result = await service.register(dto);

      expect(UserEntity.exists).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(UserEntity.prototype.save).toHaveBeenCalled();
      expect(cacheManagerValue.set).toHaveBeenCalledWith(
        expect.any(String),
        verificationToken,
        expect.any(Number),
      );
      expect(queueServiceValue.enqueueEmailVerification).toHaveBeenCalledWith(
        dto.email,
        verificationToken,
      );
      expect(result.userId).toBe('user-id-1');

      (UserEntity.exists as jest.Mock).mockRestore();
      (UserEntity.prototype.save as jest.Mock).mockRestore();
    });
  });

  describe('logout', () => {
    it('should deny the session until the access token expires and revoke its refresh tokens', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;

      await service.logout({
        id: 'user-1',
        sessionId: 'family-1',
        subjectType: 'account',
        exp,
      });

      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-1'),
        true,
        expect.any(Number),
      );
      const ttl = cacheManagerValue.store.set.mock.calls[0][2];
      expect(ttl).toBeGreaterThan(590_000);
      expect(ttl).toBeLessThanOrEqual(600_000);
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
    });
  });

  describe('refreshToken', () => {
    it('should rotate the refresh token and sign an access token for the same session', async () => {
      refreshTokenServiceValue.rotate.mockResolvedValue({
        token: 'next-refresh-token',
        familyId: 'family-1',
        subjectId: 'user-1',
      });
      userRepositoryValue.findOne.mockResolvedValue({ id: 'user-1' });
      accessTokenServiceValue.sign.mockResolvedValue('access-token');

      const result = await service.refreshToken({
        refreshToken: 'presented',
      });

      expect(refreshTokenServiceValue.rotate).toHaveBeenCalledWith('presented');
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'family-1',
      });
      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'next-refresh-token',
      });
    });

    it('should kill the live access tokens of a family whose refresh token was reused', async () => {
      refreshTokenServiceValue.rotate.mockRejectedValue(
        new RefreshTokenReuseError('family-1' as never),
      );

      await expect(
        service.refreshToken({ refreshToken: 'stolen' }),
      ).rejects.toThrow(RefreshTokenReuseError);

      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-1'),
        true,
        15 * 60 * 1000,
      );
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
    });

    it('should revoke the family and reject when the user no longer exists', async () => {
      refreshTokenServiceValue.rotate.mockResolvedValue({
        token: 'next',
        familyId: 'family-1',
        subjectId: 'deleted-user',
      });
      userRepositoryValue.findOne.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'presented' }),
      ).rejects.toThrow('Unauthorized');
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
      expect(accessTokenServiceValue.sign).not.toHaveBeenCalled();
    });
  });
});
