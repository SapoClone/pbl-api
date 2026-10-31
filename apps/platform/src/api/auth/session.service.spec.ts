import { NotFoundException } from '@nestjs/common';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { SessionService } from './session.service';

const row = (overrides: Record<string, unknown>) =>
  ({
    familyId: 'f1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    ip: '14.161.0.1',
    createdAt: new Date('2026-10-20T07:28:00Z'),
    ...overrides,
  }) as RefreshTokenEntity;

describe('SessionService', () => {
  let refreshTokens: {
    listActive: jest.Mock;
    revokeFamily: jest.Mock;
    revokeActiveFamilies: jest.Mock;
  };
  let cache: { store: { set: jest.Mock } };
  let service: SessionService;

  beforeEach(() => {
    refreshTokens = {
      listActive: jest
        .fn()
        .mockResolvedValue([
          row({ familyId: 'f1' }),
          row({ familyId: 'f2', userAgent: null, ip: null }),
        ]),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      revokeActiveFamilies: jest.fn().mockResolvedValue(['f1', 'f2']),
    };
    cache = { store: { set: jest.fn().mockResolvedValue(undefined) } };
    const config = { getOrThrow: jest.fn().mockReturnValue('15m') };
    service = new SessionService(
      refreshTokens as never,
      config as never,
      cache as never,
    );
  });

  it('lists the live logins, marking the current one', async () => {
    const sessions = await service.list('a1', 'f2');

    expect(refreshTokens.listActive).toHaveBeenCalledWith('a1');
    expect(sessions).toEqual([
      {
        id: 'f1',
        device: 'Chrome · Windows',
        ip: '14.161.0.1',
        lastUsedAt: new Date('2026-10-20T07:28:00Z'),
        isCurrent: false,
      },
      {
        id: 'f2',
        device: null,
        ip: null,
        lastUsedAt: new Date('2026-10-20T07:28:00Z'),
        isCurrent: true,
      },
    ]);
  });

  it('ends one session: revokes its family and denies its access tokens', async () => {
    await service.revokeOne('a1', 'f1');

    expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('f1');
    expect(cache.store.set).toHaveBeenCalledWith(
      expect.stringContaining('f1'),
      true,
      15 * 60 * 1000,
    );
  });

  it('answers 404 for a session that is not the caller’s or is already over', async () => {
    await expect(service.revokeOne('a1', 'other')).rejects.toThrow(
      NotFoundException,
    );
    expect(refreshTokens.revokeFamily).not.toHaveBeenCalled();
    expect(cache.store.set).not.toHaveBeenCalled();
  });

  it('ends all sessions, passing the store and the exception through, and denies each', async () => {
    const ended = await service.revokeAll('a1', {
      tenantId: 't1',
      exceptSessionId: 'f9',
    });

    expect(ended).toBe(2);
    expect(refreshTokens.revokeActiveFamilies).toHaveBeenCalledWith('a1', {
      tenantId: 't1',
      exceptFamilyId: 'f9',
    });
    expect(cache.store.set).toHaveBeenCalledTimes(2);
  });
});
