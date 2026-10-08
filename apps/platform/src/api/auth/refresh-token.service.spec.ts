import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import {
  RefreshTokenReuseError,
  RefreshTokenService,
} from './refresh-token.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('RefreshTokenService', () => {
  let repository: {
    save: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let transactionManager: { update: jest.Mock; save: jest.Mock };
  let service: RefreshTokenService;

  const storedRow = (overrides: Partial<RefreshTokenEntity> = {}) =>
    ({
      id: 'row-1',
      familyId: 'family-1',
      subjectType: 'account',
      subjectId: 'user-1',
      tokenHash: sha256('presented-token'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ...overrides,
    }) as RefreshTokenEntity;

  beforeEach(() => {
    transactionManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (entity) => entity),
    };
    repository = {
      save: jest.fn(async (entity) => entity),
      findOneBy: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn((work) => work(transactionManager)),
      },
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('30d'),
    } as unknown as ConfigService;
    service = new RefreshTokenService(
      repository as unknown as Repository<RefreshTokenEntity>,
      configService,
    );
  });

  describe('issue', () => {
    it('should store only the hash of a random opaque token in a new family', async () => {
      const { token, familyId } = await service.issue('user-1');

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
      const saved: RefreshTokenEntity = repository.save.mock.calls[0][0];
      expect(saved.tokenHash).toBe(sha256(token));
      expect(saved).not.toHaveProperty('token');
      expect(saved).toMatchObject({
        familyId,
        subjectType: 'account',
        subjectId: 'user-1',
        tenantId: null,
        revokedAt: null,
      });
      const ttl = saved.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * 24 * 3600 * 1000);
      expect(ttl).toBeLessThanOrEqual(30 * 24 * 3600 * 1000);
    });

    it('should start a different family for every login', async () => {
      const first = await service.issue('user-1');
      const second = await service.issue('user-1');
      expect(first.familyId).not.toBe(second.familyId);
      expect(first.token).not.toBe(second.token);
    });
  });

  describe('rotate', () => {
    it('should revoke the presented token and issue a new one in the same family', async () => {
      repository.findOneBy.mockResolvedValue(storedRow());

      const rotated = await service.rotate('presented-token');

      expect(repository.findOneBy).toHaveBeenCalledWith({
        tokenHash: sha256('presented-token'),
      });
      expect(transactionManager.update).toHaveBeenCalledWith(
        RefreshTokenEntity,
        { id: 'row-1', revokedAt: IsNull() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      const saved: RefreshTokenEntity =
        transactionManager.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        familyId: 'family-1',
        subjectId: 'user-1',
        tokenHash: sha256(rotated.token),
      });
      expect(rotated).toEqual({
        token: expect.any(String),
        familyId: 'family-1',
        subjectId: 'user-1',
      });
      expect(rotated.token).not.toBe('presented-token');
    });

    it('should reject an unknown token', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.rotate('unknown')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('should reject an expired token without rotating', async () => {
      repository.findOneBy.mockResolvedValue(
        storedRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotate('presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('should treat a revoked token as reuse and revoke the whole family', async () => {
      repository.findOneBy.mockResolvedValue(
        storedRow({ revokedAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotate('presented-token')).rejects.toThrow(
        RefreshTokenReuseError,
      );
      expect(repository.update).toHaveBeenCalledWith(
        { familyId: 'family-1', revokedAt: IsNull() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(repository.manager.transaction).not.toHaveBeenCalled();
    });

    it('should treat losing a concurrent rotation as reuse', async () => {
      repository.findOneBy.mockResolvedValue(storedRow());
      transactionManager.update.mockResolvedValue({ affected: 0 });

      await expect(service.rotate('presented-token')).rejects.toThrow(
        RefreshTokenReuseError,
      );
      expect(transactionManager.save).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { familyId: 'family-1', revokedAt: IsNull() },
        expect.anything(),
      );
    });

    it('should expose the family on a reuse error so its sessions can be killed', async () => {
      repository.findOneBy.mockResolvedValue(
        storedRow({ revokedAt: new Date() }),
      );

      const error = await service.rotate('presented-token').catch((e) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.familyId).toBe('family-1');
    });
  });

  describe('revokeFamily', () => {
    it('should revoke every still-active token of the family', async () => {
      await service.revokeFamily('family-1');

      expect(repository.update).toHaveBeenCalledWith(
        { familyId: 'family-1', revokedAt: IsNull() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });
});
