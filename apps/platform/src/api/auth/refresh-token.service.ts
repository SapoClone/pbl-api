import { Uuid } from '@/common/types/common.type';
import { AllConfigType } from '@/config/config.type';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import ms from 'ms';
import { IsNull, Repository } from 'typeorm';
import { RefreshTokenEntity } from './entities/refresh-token.entity';

/** A refresh token was presented after it had already been used/revoked. */
export class RefreshTokenReuseError extends UnauthorizedException {
  constructor(readonly familyId: Uuid) {
    super();
  }
}

/**
 * Opaque, rotating refresh tokens with reuse detection (ADR-0004 §6). The
 * token is 32 random bytes (base64url); only its SHA-256 is stored. Each use
 * revokes it and issues a successor in the same family; presenting a revoked
 * token revokes the whole family, since one of the two holders is an
 * attacker.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly repository: Repository<RefreshTokenEntity>,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** Start a new family (one per login). */
  async issue(
    subjectId: Uuid | string,
  ): Promise<{ token: string; familyId: Uuid }> {
    const familyId = randomUUID() as Uuid;
    const token = await this.store(this.repository, familyId, subjectId);
    return { token, familyId };
  }

  async rotate(
    presentedToken: string,
  ): Promise<{ token: string; familyId: Uuid; subjectId: Uuid }> {
    const current = await this.repository.findOneBy({
      tokenHash: hashToken(presentedToken),
    });

    if (!current) {
      throw new UnauthorizedException();
    }
    if (current.revokedAt) {
      await this.handleReuse(current);
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }

    const token = await this.repository.manager.transaction(async (em) => {
      // Conditional update: of two concurrent rotations only one wins
      const { affected } = await em.update(
        RefreshTokenEntity,
        { id: current.id, revokedAt: IsNull() },
        { revokedAt: new Date(), updatedBy: current.subjectId },
      );
      if (affected !== 1) {
        return null;
      }
      return this.store(em, current.familyId, current.subjectId);
    });

    if (!token) {
      await this.handleReuse(current);
    }

    return { token, familyId: current.familyId, subjectId: current.subjectId };
  }

  async revokeFamily(familyId: Uuid | string): Promise<void> {
    await this.repository.update(
      { familyId: familyId as Uuid, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async handleReuse(row: RefreshTokenEntity): Promise<never> {
    this.logger.warn(
      `Refresh token reuse detected (family ${row.familyId}); revoking the family`,
    );
    await this.revokeFamily(row.familyId);
    throw new RefreshTokenReuseError(row.familyId);
  }

  private async store(
    repository: Pick<Repository<RefreshTokenEntity>, 'save'>,
    familyId: Uuid,
    subjectId: Uuid | string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const lifetime = this.configService.getOrThrow('auth.refreshExpires', {
      infer: true,
    });

    await repository.save(
      new RefreshTokenEntity({
        familyId,
        subjectType: 'account',
        subjectId: subjectId as Uuid,
        tenantId: null,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ms(lifetime)),
        revokedAt: null,
        createdBy: subjectId,
        updatedBy: subjectId,
      }),
    );
    return token;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
