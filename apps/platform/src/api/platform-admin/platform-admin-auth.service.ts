import { AllConfigType } from '@/config/config.type';
import { CacheKey } from '@/constants/cache.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ClientInfo } from '@/decorators/client-info.decorator';
import { ValidationException } from '@/exceptions/validation.exception';
import { createCacheKey } from '@/utils/cache.util';
import { verifyPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from '@pbl/auth';
import { Cache } from 'cache-manager';
import { plainToInstance } from 'class-transformer';
import ms from 'ms';
import { Repository } from 'typeorm';
import { AccessTokenService } from '../auth/access-token.service';
import { RefreshReqDto } from '../auth/dto/refresh.req.dto';
import { RefreshResDto } from '../auth/dto/refresh.res.dto';
import { DUMMY_PASSWORD_HASH } from '../auth/dummy-password-hash.constant';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from '../auth/refresh-token.service';
import { PlatformSettingReader } from '../platform-setting/platform-setting.reader';
import { AdminLoginReqDto } from './dto/admin-login.req.dto';
import { AdminLoginResDto } from './dto/admin-login.res.dto';
import { AdminMeResDto, AdminResDto } from './dto/admin.res.dto';
import {
  PlatformAdminEntity,
  PlatformAdminStatus,
} from './entities/platform-admin.entity';

/**
 * Sign-in, refresh, sign-out and "who am I" of a platform admin (ADR-0022). The tokens are platform's ordinary
 * ones with `sub_type = platform_admin` and no store; the refresh tokens are `refresh_token` rows of the same
 * subject type, which the account refresh refuses and this one alone accepts.
 */
@Injectable()
export class PlatformAdminAuthService {
  constructor(
    @InjectRepository(PlatformAdminEntity)
    private readonly admins: Repository<PlatformAdminEntity>,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly configService: ConfigService<AllConfigType>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly settings: PlatformSettingReader,
  ) {}

  async signIn(
    dto: AdminLoginReqDto,
    client?: Partial<ClientInfo>,
  ): Promise<AdminLoginResDto> {
    const admin = await this.admins.findOne({ where: { email: dto.email } });
    // Always run one argon2 verification, so the response time does not reveal whether the email is known
    const isPasswordValid = await verifyPassword(
      dto.password,
      admin?.password ?? DUMMY_PASSWORD_HASH,
    );
    // Unknown, disabled, or no password set yet: the same answer as a wrong password
    if (
      !admin ||
      !admin.password ||
      admin.status !== PlatformAdminStatus.ACTIVE
    ) {
      throw new ValidationException(ErrorCode.A001);
    }
    // A locked admin is refused even with the right password, and the attempt does not extend the lock
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      throw new ValidationException(ErrorCode.A003);
    }
    if (!isPasswordValid) {
      await this.registerFailedLogin(admin.id);
      throw new ValidationException(ErrorCode.A001);
    }
    await this.admins.update(
      { id: admin.id },
      { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    );

    // One refresh-token family per login; its id is the access token's sid
    const { token: refreshToken, familyId } = await this.refreshTokens.issue(
      admin.id,
      null,
      client,
      'platform_admin',
    );
    const token = await this.createToken(admin, familyId, refreshToken);
    return plainToInstance(AdminLoginResDto, {
      ...token,
      admin: plainToInstance(AdminResDto, admin),
    });
  }

  async refresh(dto: RefreshReqDto): Promise<RefreshResDto> {
    let rotated: Awaited<ReturnType<RefreshTokenService['rotate']>>;
    try {
      rotated = await this.refreshTokens.rotate(
        dto.refreshToken,
        'platform_admin',
      );
    } catch (err) {
      if (err instanceof RefreshTokenReuseError) {
        // The family is already revoked; also kill its live access tokens
        await this.revokeSession(err.familyId, this.accessTokenLifetimeMs());
      }
      throw err;
    }

    const admin = await this.admins.findOne({
      where: { id: rotated.subjectId },
    });
    if (!admin || admin.status !== PlatformAdminStatus.ACTIVE) {
      await this.revokeSession(rotated.familyId, this.accessTokenLifetimeMs());
      throw new UnauthorizedException();
    }
    return plainToInstance(
      RefreshResDto,
      await this.createToken(admin, rotated.familyId, rotated.token),
    );
  }

  async logout(user: AuthUser): Promise<void> {
    await this.revokeSession(user.sessionId, user.exp * 1000 - Date.now());
  }

  async me(user: AuthUser): Promise<AdminMeResDto> {
    const admin = await this.admins.findOne({
      where: { id: user.id as PlatformAdminEntity['id'] },
    });
    if (!admin || admin.status !== PlatformAdminStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    return plainToInstance(AdminMeResDto, {
      ...plainToInstance(AdminResDto, admin),
      environment: this.configService.getOrThrow('app.nodeEnv', {
        infer: true,
      }),
    });
  }

  /**
   * One atomic statement, so parallel guesses cannot slip past the counter: the failure that reaches the limit
   * starts the lock and resets the count. The same rule as accounts, with the numbers of the platform settings.
   */
  private async registerFailedLogin(adminId: string): Promise<void> {
    const reachesLimit = '"failed_login_count" + 1 >= :max';
    const lockout = await this.settings.lockout();
    await this.admins
      .createQueryBuilder()
      .update(PlatformAdminEntity)
      .set({
        failedLoginCount: () =>
          `CASE WHEN ${reachesLimit} THEN 0 ELSE "failed_login_count" + 1 END`,
        lockedUntil: () =>
          `CASE WHEN ${reachesLimit} THEN :lockedUntil ELSE "locked_until" END`,
      })
      .where('id = :id', { id: adminId })
      .setParameters({
        max: lockout.maxAttempts,
        lockedUntil: new Date(Date.now() + lockout.windowMs),
      })
      .execute();
  }

  /** End a login: revoke its refresh tokens and deny its access tokens until they expire (ADR-0004 §7). */
  private async revokeSession(sessionId: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) {
      await this.cacheManager.store.set<boolean>(
        createCacheKey(CacheKey.SESSION_BLACKLIST, sessionId),
        true,
        ttlMs,
      );
    }
    await this.refreshTokens.revokeFamily(sessionId);
  }

  private accessTokenLifetimeMs(): number {
    const lifetime: string = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });
    return ms(lifetime);
  }

  private async createToken(
    admin: PlatformAdminEntity,
    sessionId: string,
    refreshToken: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenExpires: number;
  }> {
    const accessToken = await this.accessTokens.sign({
      userId: admin.id,
      sessionId,
      subjectType: 'platform_admin',
      roles: [admin.role],
    });
    return {
      accessToken,
      refreshToken,
      tokenExpires: Date.now() + this.accessTokenLifetimeMs(),
    };
  }
}
