import { Branded } from '@/common/types/types';
import { AllConfigType } from '@/config/config.type';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { CacheKey } from '@/constants/cache.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { QueueService } from '@/queue/queue.service';
import { createCacheKey } from '@/utils/cache.util';
import { verifyPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from '@pbl/auth';
import { Cache } from 'cache-manager';
import { plainToInstance } from 'class-transformer';
import ms from 'ms';
import { Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { Membership, MembershipService } from '../tenant/membership.service';
import { AccessTokenService } from './access-token.service';
import { LoginReqDto } from './dto/login.req.dto';
import { LoginResDto } from './dto/login.res.dto';
import { RefreshReqDto } from './dto/refresh.req.dto';
import { RefreshResDto } from './dto/refresh.res.dto';
import { RegisterReqDto } from './dto/register.req.dto';
import { RegisterResDto } from './dto/register.res.dto';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from './refresh-token.service';

type Token = Branded<
  {
    accessToken: string;
    refreshToken: string;
    tokenExpires: number;
  },
  'token'
>;

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly jwtService: JwtService,
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
    private readonly queueService: QueueService,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly membershipService: MembershipService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Sign in user
   * @param dto LoginReqDto
   * @returns LoginResDto
   */
  async signIn(dto: LoginReqDto): Promise<LoginResDto> {
    const account = await this.accountRepository.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'password', 'status'],
    });
    const isValid =
      account?.status === AccountStatus.ACTIVE &&
      (await verifyPassword(dto.password, account.password));
    if (!isValid) {
      throw new UnauthorizedException();
    }

    const memberships = await this.membershipService.findActiveMemberships(
      account.id,
    );
    let selected: Membership | null = null;
    if (dto.tenantId) {
      selected = memberships.find((m) => m.tenantId === dto.tenantId) ?? null;
      if (!selected) throw new NotFoundException();
    } else if (memberships.length === 1) {
      selected = memberships[0];
    }
    return this.startSession(account.id, selected, memberships);
  }

  /**
   * Select another store: end the current session (its access tokens stop
   * working immediately) and start one bound to the store (P0 spec, flow 4).
   */
  async switchTenant(user: AuthUser, tenantId: string): Promise<LoginResDto> {
    const memberships = await this.membershipService.findActiveMemberships(
      user.id,
    );
    const selected = memberships.find((m) => m.tenantId === tenantId);
    if (!selected) {
      throw new NotFoundException();
    }
    await this.revokeSession(user.sessionId, user.exp * 1000 - Date.now());
    return this.startSession(user.id, selected, memberships);
  }

  private async startSession(
    accountId: string,
    selected: Membership | null,
    memberships: Membership[],
  ): Promise<LoginResDto> {
    // One refresh-token family per login; its id is the access token's sid
    const { token: refreshToken, familyId } =
      await this.refreshTokenService.issue(
        accountId,
        selected?.tenantId ?? null,
      );
    const token = await this.createToken({
      id: accountId,
      sessionId: familyId,
      refreshToken,
      membership: selected,
    });
    return plainToInstance(LoginResDto, {
      userId: accountId,
      ...token,
      tenantId: selected?.tenantId ?? null,
      tenants: memberships.map((m) => ({
        id: m.tenantId,
        name: m.name,
        subdomain: m.subdomain,
        role: m.role,
      })),
    });
  }

  async register(dto: RegisterReqDto): Promise<RegisterResDto> {
    // Check if the user already exists
    const isExistUser = await AccountEntity.exists({
      where: { email: dto.email },
    });

    if (isExistUser) {
      throw new ValidationException(ErrorCode.E003);
    }

    // Register user
    const user = new AccountEntity({
      email: dto.email,
      password: dto.password,
      name: dto.name ?? '',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    await user.save();

    // Send email verification
    const token = await this.createVerificationToken({ id: user.id });
    const tokenExpiresIn = this.configService.getOrThrow(
      'auth.confirmEmailExpires',
      {
        infer: true,
      },
    );
    await this.cacheManager.set(
      createCacheKey(CacheKey.EMAIL_VERIFICATION, user.id),
      token,
      ms(tokenExpiresIn),
    );
    await this.queueService.enqueueEmailVerification(dto.email, token);

    return plainToInstance(RegisterResDto, {
      userId: user.id,
    });
  }

  async logout(userToken: AuthUser): Promise<void> {
    await this.revokeSession(
      userToken.sessionId,
      userToken.exp * 1000 - Date.now(),
    );
  }

  async refreshToken(dto: RefreshReqDto): Promise<RefreshResDto> {
    let rotated: Awaited<ReturnType<RefreshTokenService['rotate']>>;
    try {
      rotated = await this.refreshTokenService.rotate(dto.refreshToken);
    } catch (err) {
      if (err instanceof RefreshTokenReuseError) {
        // The family is already revoked; also kill its live access tokens
        const accessTokenLifetime: string = this.configService.getOrThrow(
          'auth.expires',
          { infer: true },
        );
        await this.revokeSession(err.familyId, ms(accessTokenLifetime));
      }
      throw err;
    }

    const account = await this.accountRepository.findOne({
      where: { id: rotated.subjectId },
      select: ['id', 'status'],
    });
    if (!account || account.status !== AccountStatus.ACTIVE) {
      await this.refreshTokenService.revokeFamily(rotated.familyId);
      throw new UnauthorizedException();
    }

    let membership: Membership | null = null;
    if (rotated.tenantId) {
      membership = await this.membershipService.findActiveMembership(
        account.id,
        rotated.tenantId,
      );
      if (!membership) {
        // Removed from the store, or the store was suspended: end the session
        const accessTokenLifetime: string = this.configService.getOrThrow(
          'auth.expires',
          { infer: true },
        );
        await this.revokeSession(rotated.familyId, ms(accessTokenLifetime));
        throw new UnauthorizedException();
      }
    }

    return await this.createToken({
      id: account.id,
      sessionId: rotated.familyId,
      refreshToken: rotated.token,
      membership,
    });
  }

  /**
   * End a login: revoke its refresh tokens and deny its access tokens until
   * they expire (instant revocation, ADR-0004 §7).
   */
  private async revokeSession(sessionId: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) {
      await this.cacheManager.store.set<boolean>(
        createCacheKey(CacheKey.SESSION_BLACKLIST, sessionId),
        true,
        ttlMs,
      );
    }
    await this.refreshTokenService.revokeFamily(sessionId);
  }

  private async createVerificationToken(data: { id: string }): Promise<string> {
    return await this.jwtService.signAsync(
      {
        id: data.id,
      },
      {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
          infer: true,
        }),
      },
    );
  }

  private async createToken(data: {
    id: string;
    sessionId: string;
    refreshToken: string;
    membership: Membership | null;
  }): Promise<Token> {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });
    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const accessToken = await this.accessTokenService.sign({
      userId: data.id,
      sessionId: data.sessionId,
      tenantId: data.membership?.tenantId,
      roles: data.membership ? [data.membership.role] : [],
    });
    return {
      accessToken,
      refreshToken: data.refreshToken,
      tokenExpires,
    } as Token;
  }
}
