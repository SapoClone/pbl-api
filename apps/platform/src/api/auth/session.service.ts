import { AllConfigType } from '@/config/config.type';
import { CacheKey } from '@/constants/cache.constant';
import { describeDevice } from '@/decorators/client-info.decorator';
import { createCacheKey } from '@/utils/cache.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import ms from 'ms';
import { SessionResDto } from './dto/session.res.dto';
import { RefreshTokenService } from './refresh-token.service';

/**
 * The logins ("sessions") of an account: list them and end them. Ending a
 * session revokes its refresh tokens and denies its access tokens until they
 * would have expired (ADR-0004 §7).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly refreshTokens: RefreshTokenService,
    private readonly configService: ConfigService<AllConfigType>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async list(
    accountId: string,
    currentSessionId: string,
  ): Promise<SessionResDto[]> {
    const rows = await this.refreshTokens.listActive(accountId);
    return rows.map((row) => ({
      id: row.familyId,
      device: describeDevice(row.userAgent),
      ip: row.ip,
      lastUsedAt: row.createdAt,
      isCurrent: row.familyId === currentSessionId,
    }));
  }

  /** Ends one of the caller's sessions; a session of someone else is a 404. */
  async revokeOne(accountId: string, sessionId: string): Promise<void> {
    const rows = await this.refreshTokens.listActive(accountId);
    if (!rows.some((row) => row.familyId === sessionId)) {
      throw new NotFoundException();
    }
    await this.refreshTokens.revokeFamily(sessionId);
    await this.deny([sessionId]);
  }

  /**
   * Ends every live session of the account (all, or the ones bound to one
   * store), except an optional one; returns how many were ended.
   */
  async revokeAll(
    accountId: string,
    options: { tenantId?: string; exceptSessionId?: string } = {},
  ): Promise<number> {
    const familyIds = await this.refreshTokens.revokeActiveFamilies(accountId, {
      tenantId: options.tenantId,
      exceptFamilyId: options.exceptSessionId,
    });
    await this.deny(familyIds);
    return familyIds.length;
  }

  private async deny(sessionIds: string[]): Promise<void> {
    const ttl = ms(
      this.configService.getOrThrow<string>('auth.expires', { infer: true }),
    );
    await Promise.all(
      sessionIds.map((id) =>
        this.cacheManager.store.set<boolean>(
          createCacheKey(CacheKey.SESSION_BLACKLIST, id),
          true,
          ttl,
        ),
      ),
    );
  }
}
