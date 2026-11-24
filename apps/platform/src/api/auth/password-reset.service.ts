import { AllConfigType } from '@/config/config.type';
import { CacheKey } from '@/constants/cache.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { QueueService } from '@/queue/queue.service';
import { createCacheKey } from '@/utils/cache.util';
import { hashPassword } from '@/utils/password.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  AccountEntity,
  AccountStatus,
} from '../account/entities/account.entity';
import { SessionService } from './session.service';

/** A reset link works for 60 minutes (the email says so too). */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/**
 * Password reset by email. The token is 32 random bytes; only its SHA-256 is
 * stored (Redis, so the TTL is the expiry), next to the account id. A second
 * request replaces the first token, and a token works once.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(AccountEntity)
    private readonly accountRepository: Repository<AccountEntity>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly queueService: QueueService,
    private readonly sessions: SessionService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * Sends a reset link if an active account with a password has this email.
   * It returns the same way for every email, and a failure to queue the mail is
   * logged, not thrown, so the answer never tells whether the account exists.
   */
  async requestReset(email: string): Promise<void> {
    try {
      const account = await this.accountRepository.findOne({
        where: { email },
        select: ['id', 'email', 'password', 'status'],
      });
      if (!account || account.status !== AccountStatus.ACTIVE) return;
      // an owner created by an admin who has not set a password yet cannot reset one this way
      if (!account.password) return;

      const token = randomBytes(32).toString('base64url');
      await this.storeToken(account.id, sha256(token));

      const baseUrl = this.configService.getOrThrow('web.appUrl', {
        infer: true,
      });
      await this.queueService.enqueuePasswordReset(
        account.email,
        `${baseUrl}/reset-password?token=${token}`,
      );
    } catch (error) {
      this.logger.error(
        `Could not send a password reset email: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Sets the new password, ends every session of the account and spends the token. */
  async resetPassword(token: string, password: string): Promise<void> {
    const hash = sha256(token);
    const tokenKey = createCacheKey(CacheKey.PASSWORD_RESET, hash);
    const accountId = await this.cacheManager.get<string>(tokenKey);
    if (!accountId) {
      throw new ValidationException(ErrorCode.E014);
    }
    // single use: spent before anything else, so a failure below asks for a new link
    await this.cacheManager.del(tokenKey);
    await this.cacheManager.del(
      createCacheKey(CacheKey.PASSWORD_RESET_ACCOUNT, accountId),
    );

    const account = await this.accountRepository.findOne({
      where: { id: accountId as AccountEntity['id'] },
      select: ['id', 'status'],
    });
    if (!account || account.status !== AccountStatus.ACTIVE) {
      throw new ValidationException(ErrorCode.E014);
    }

    // `update` skips the entity hooks, so the hash is made here; a reset also lifts a sign-in lock
    await this.accountRepository.update(
      { id: account.id },
      {
        password: await hashPassword(password),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    );
    // every refresh-token family is revoked and its access tokens denied
    await this.sessions.revokeAll(account.id);
  }

  /** One live token per account: the new hash replaces the previous one. */
  private async storeToken(accountId: string, hash: string): Promise<void> {
    const accountKey = createCacheKey(
      CacheKey.PASSWORD_RESET_ACCOUNT,
      accountId,
    );
    const previous = await this.cacheManager.get<string>(accountKey);
    if (previous) {
      await this.cacheManager.del(
        createCacheKey(CacheKey.PASSWORD_RESET, previous),
      );
    }
    await this.cacheManager.set(
      createCacheKey(CacheKey.PASSWORD_RESET, hash),
      accountId,
      PASSWORD_RESET_TTL_MS,
    );
    await this.cacheManager.set(accountKey, hash, PASSWORD_RESET_TTL_MS);
  }
}
