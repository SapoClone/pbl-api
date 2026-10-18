import { QueueService } from '@/queue/queue.service';
import { verifyPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { PLATFORM_ACCOUNT_LOGGED_IN } from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { MembershipService } from '../tenant/membership.service';
import { AccessTokenService } from './access-token.service';
import { AuthService } from './auth.service';
import { RegisterReqDto } from './dto/register.req.dto';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from './refresh-token.service';

jest.mock('@/utils/password.util', () => ({ verifyPassword: jest.fn() }));

describe('AuthService', () => {
  let service: AuthService;
  let configServiceValue: Partial<Record<keyof ConfigService, jest.Mock>>;
  let jwtServiceValue: Partial<Record<keyof JwtService, jest.Mock>>;
  let accountRepositoryValue: Partial<
    Record<keyof Repository<AccountEntity>, jest.Mock>
  >;
  let queueServiceValue: Partial<Record<keyof QueueService, jest.Mock>>;
  let cacheManagerValue: { set: jest.Mock; store: { set: jest.Mock } };
  let refreshTokenServiceValue: Record<
    'issue' | 'rotate' | 'revokeFamily',
    jest.Mock
  >;
  let accessTokenServiceValue: { sign: jest.Mock };
  let outboxValue: { add: jest.Mock };
  let dataSourceValue: { transaction: jest.Mock };
  let membershipServiceValue: {
    findActiveMemberships: jest.Mock;
    findActiveMembership: jest.Mock;
  };

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

    accountRepositoryValue = {
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
    outboxValue = { add: jest.fn().mockResolvedValue(undefined) };
    dataSourceValue = {
      transaction: jest.fn(async (work: (em: object) => unknown) => work({})),
    };
    membershipServiceValue = {
      findActiveMemberships: jest.fn(),
      findActiveMembership: jest.fn(),
    };

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
          provide: getRepositoryToken(AccountEntity),
          useValue: accountRepositoryValue,
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
        { provide: MembershipService, useValue: membershipServiceValue },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManagerValue,
        },
        { provide: getDataSourceToken(), useValue: dataSourceValue },
        { provide: EventOutbox, useValue: outboxValue },
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

      jest.spyOn(AccountEntity, 'exists').mockResolvedValue(false);
      jest
        .spyOn(AccountEntity.prototype, 'save')
        .mockImplementation(async function (this: AccountEntity) {
          this.id = 'user-id-1' as AccountEntity['id'];
          return this;
        });
      (jwtServiceValue.signAsync as jest.Mock).mockResolvedValue(
        verificationToken,
      );

      const result = await service.register(dto);

      expect(AccountEntity.exists).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(AccountEntity.prototype.save).toHaveBeenCalled();
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

      (AccountEntity.exists as jest.Mock).mockRestore();
      (AccountEntity.prototype.save as jest.Mock).mockRestore();
    });
  });

  describe('logout', () => {
    it('should deny the session until the access token expires and revoke its refresh tokens', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;

      await service.logout({
        id: 'user-1',
        sessionId: 'family-1',
        subjectType: 'account',
        roles: [],
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
        tenantId: null,
      });
      accountRepositoryValue.findOne.mockResolvedValue({
        id: 'user-1',
        status: AccountStatus.ACTIVE,
      });
      accessTokenServiceValue.sign.mockResolvedValue('access-token');

      const result = await service.refreshToken({
        refreshToken: 'presented',
      });

      expect(refreshTokenServiceValue.rotate).toHaveBeenCalledWith('presented');
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({
        userId: 'user-1',
        sessionId: 'family-1',
        tenantId: undefined,
        roles: [],
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

    it('should revoke the family and reject when the account no longer exists', async () => {
      refreshTokenServiceValue.rotate.mockResolvedValue({
        token: 'next',
        familyId: 'family-1',
        subjectId: 'deleted-user',
        tenantId: null,
      });
      accountRepositoryValue.findOne.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'presented' }),
      ).rejects.toThrow('Unauthorized');
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
      expect(accessTokenServiceValue.sign).not.toHaveBeenCalled();
    });
  });

  const alpha = {
    tenantId: 't1',
    name: 'Alpha',
    subdomain: 'alpha',
    role: 'owner',
  };
  const beta = {
    tenantId: 't2',
    name: 'Beta',
    subdomain: 'beta',
    role: 'owner',
  };
  const caller = {
    id: 'a1',
    sessionId: 'family-old',
    subjectType: 'account' as const,
    roles: [],
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  describe('signIn', () => {
    const login = (tenantId?: string) =>
      service.signIn({
        email: 'me@example.com',
        password: 'Passw0rd!',
        tenantId,
      });

    beforeEach(() => {
      accountRepositoryValue.findOne = jest.fn().mockResolvedValue({
        id: 'a1',
        password: 'hash',
        status: AccountStatus.ACTIVE,
      });
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      refreshTokenServiceValue.issue.mockResolvedValue({
        token: 'rt',
        familyId: 'family-1',
      });
      accessTokenServiceValue.sign.mockResolvedValue('at');
    });

    it('selects the only store automatically', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      const res = await login();

      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', 't1');
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({
        userId: 'a1',
        sessionId: 'family-1',
        tenantId: 't1',
        roles: ['owner'],
      });
      expect(res).toMatchObject({
        userId: 'a1',
        accessToken: 'at',
        refreshToken: 'rt',
        tenantId: 't1',
      });
      expect(res.tenants).toEqual([
        { id: 't1', name: 'Alpha', subdomain: 'alpha', role: 'owner' },
      ]);
    });

    it('writes a login event for the selected store, with the store as its tenant', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      await login();

      expect(outboxValue.add).toHaveBeenCalledWith(
        expect.anything(),
        PLATFORM_ACCOUNT_LOGGED_IN,
        {
          accountId: 'a1',
          sessionId: 'family-1',
          role: 'owner',
          method: 'password',
        },
        { tenantId: 't1' },
      );
    });

    it('writes no login event when no store is selected', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([
        alpha,
        beta,
      ]);

      await login();

      expect(outboxValue.add).not.toHaveBeenCalled();
    });

    it('still signs in when the login event cannot be written', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);
      outboxValue.add.mockRejectedValueOnce(new Error('db down'));

      await expect(login()).resolves.toMatchObject({ accessToken: 'at' });
    });

    it('selects none with several stores and returns the list', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([
        alpha,
        beta,
      ]);

      const res = await login();

      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', null);
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({
        userId: 'a1',
        sessionId: 'family-1',
        tenantId: undefined,
        roles: [],
      });
      expect(res.tenantId).toBeNull();
      expect(res.tenants).toHaveLength(2);
    });

    it('selects none without stores', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([]);

      await expect(login()).resolves.toMatchObject({
        tenantId: null,
        tenants: [],
      });
    });

    it('selects the requested store', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([
        alpha,
        beta,
      ]);

      await expect(login('t2')).resolves.toMatchObject({ tenantId: 't2' });
    });

    it('answers 404 for a store the account cannot use (non-member, suspended or deleted)', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      await expect(login('t9')).rejects.toThrow(NotFoundException);
      expect(refreshTokenServiceValue.issue).not.toHaveBeenCalled();
    });

    it('rejects a disabled account like a wrong password', async () => {
      accountRepositoryValue.findOne = jest.fn().mockResolvedValue({
        id: 'a1',
        password: 'hash',
        status: AccountStatus.DISABLED,
      });

      await expect(login()).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenServiceValue.issue).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown email', null],
      [
        'a disabled account',
        { id: 'a1', password: 'hash', status: AccountStatus.DISABLED },
      ],
    ])(
      'still verifies a password once for %s so timing does not leak',
      async (_label, account) => {
        accountRepositoryValue.findOne = jest.fn().mockResolvedValue(account);
        (verifyPassword as jest.Mock).mockClear();

        await expect(login()).rejects.toThrow(UnauthorizedException);
        expect(verifyPassword).toHaveBeenCalledTimes(1);
        expect(refreshTokenServiceValue.issue).not.toHaveBeenCalled();
      },
    );
  });

  describe('switchTenant', () => {
    beforeEach(() => {
      accountRepositoryValue.findOne = jest
        .fn()
        .mockResolvedValue({ id: 'a1', status: AccountStatus.ACTIVE });
      refreshTokenServiceValue.issue.mockResolvedValue({
        token: 'rt2',
        familyId: 'family-2',
      });
      accessTokenServiceValue.sign.mockResolvedValue('at2');
    });

    it('revokes the current session and starts one in the requested store', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([
        alpha,
        beta,
      ]);

      const res = await service.switchTenant(caller, 't2');

      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-old'),
        true,
        expect.any(Number),
      );
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-old',
      );
      expect(refreshTokenServiceValue.issue).toHaveBeenCalledWith('a1', 't2');
      expect(res).toMatchObject({ accessToken: 'at2', tenantId: 't2' });
    });

    it('answers 404 for a store the caller cannot use, and keeps the current session', async () => {
      membershipServiceValue.findActiveMemberships.mockResolvedValue([alpha]);

      await expect(service.switchTenant(caller, 't9')).rejects.toThrow(
        NotFoundException,
      );
      expect(refreshTokenServiceValue.revokeFamily).not.toHaveBeenCalled();
    });

    it.each([
      ['disabled', { id: 'a1', status: AccountStatus.DISABLED }],
      ['missing', null],
    ])(
      'answers 401 and ends the session for a %s account',
      async (_label, account) => {
        accountRepositoryValue.findOne = jest.fn().mockResolvedValue(account);
        membershipServiceValue.findActiveMemberships.mockResolvedValue([
          alpha,
          beta,
        ]);

        await expect(service.switchTenant(caller, 't2')).rejects.toThrow(
          UnauthorizedException,
        );
        expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
          expect.stringContaining('family-old'),
          true,
          expect.any(Number),
        );
        expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
          'family-old',
        );
        expect(refreshTokenServiceValue.issue).not.toHaveBeenCalled();
      },
    );
  });

  describe('refreshToken with a store', () => {
    beforeEach(() => {
      refreshTokenServiceValue.rotate.mockResolvedValue({
        token: 'next',
        familyId: 'family-1',
        subjectId: 'a1',
        tenantId: 't1',
      });
      accountRepositoryValue.findOne = jest
        .fn()
        .mockResolvedValue({ id: 'a1', status: AccountStatus.ACTIVE });
      accessTokenServiceValue.sign.mockResolvedValue('at');
    });

    it('keeps the store and re-reads the role', async () => {
      membershipServiceValue.findActiveMembership.mockResolvedValue(alpha);

      await service.refreshToken({ refreshToken: 'presented' });

      expect(membershipServiceValue.findActiveMembership).toHaveBeenCalledWith(
        'a1',
        't1',
      );
      expect(accessTokenServiceValue.sign).toHaveBeenCalledWith({
        userId: 'a1',
        sessionId: 'family-1',
        tenantId: 't1',
        roles: ['owner'],
      });
    });

    it('ends the session when the membership is gone', async () => {
      membershipServiceValue.findActiveMembership.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'presented' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-1'),
        true,
        expect.any(Number),
      );
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
      expect(accessTokenServiceValue.sign).not.toHaveBeenCalled();
    });

    it('ends the session for a disabled account', async () => {
      accountRepositoryValue.findOne = jest
        .fn()
        .mockResolvedValue({ id: 'a1', status: AccountStatus.DISABLED });

      await expect(
        service.refreshToken({ refreshToken: 'presented' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(cacheManagerValue.store.set).toHaveBeenCalledWith(
        expect.stringContaining('family-1'),
        true,
        expect.any(Number),
      );
      expect(refreshTokenServiceValue.revokeFamily).toHaveBeenCalledWith(
        'family-1',
      );
    });
  });
});
