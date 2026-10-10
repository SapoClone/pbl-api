import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { AccessTokenVerifier } from './access-token.verifier';
import { KeyResolver, PblAuthOptions } from './auth.types';

const newRsaKey = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;

describe('AccessTokenVerifier', () => {
  const jwtService = new JwtService();
  const privateKey = newRsaKey();
  const publicKey = createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem',
  }) as string;
  const keyResolver: KeyResolver = {
    getPublicKey: async (kid) => {
      if (kid !== 'key-1') throw new Error(`unknown kid ${kid}`);
      return publicKey;
    },
  };
  const claims = { sub: 'user-1', sid: 'session-1', sub_type: 'account' };

  const sign = (
    options: {
      key?: string;
      kid?: string;
      issuer?: string;
      audience?: string;
      payload?: object;
    } = {},
  ) =>
    jwtService.signAsync(options.payload ?? claims, {
      privateKey: options.key ?? privateKey,
      algorithm: 'RS256',
      keyid: options.kid ?? 'key-1',
      issuer: options.issuer ?? 'platform',
      audience: options.audience ?? 'pbl6',
      expiresIn: '15m',
    });

  const createVerifier = (overrides: Partial<PblAuthOptions> = {}) =>
    new AccessTokenVerifier({
      issuer: 'platform',
      audience: 'pbl6',
      keyResolver,
      ...overrides,
    });

  const verifier = createVerifier();

  it('should return the caller for a valid token', async () => {
    await expect(verifier.verify(await sign())).resolves.toEqual({
      id: 'user-1',
      sessionId: 'session-1',
      subjectType: 'account',
      exp: expect.any(Number),
    });
  });

  describe('should reject', () => {
    it('an HS256 token, even with a known kid', async () => {
      const token = await jwtService.signAsync(claims, {
        secret: 'secret',
        algorithm: 'HS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
      });
      await expect(verifier.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('an unsigned token (alg none)', async () => {
      const part = (o: object) =>
        Buffer.from(JSON.stringify(o)).toString('base64url');
      const token = `${part({ alg: 'none', kid: 'key-1' })}.${part({
        ...claims,
        iss: 'platform',
        aud: 'pbl6',
        exp: Math.floor(Date.now() / 1000) + 60,
      })}.`;
      await expect(verifier.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a token signed by another key under a known kid', async () => {
      await expect(
        verifier.verify(await sign({ key: newRsaKey() })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a token whose kid cannot be resolved', async () => {
      await expect(
        verifier.verify(await sign({ kid: 'retired' })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a token without kid', async () => {
      const token = await jwtService.signAsync(claims, {
        privateKey,
        algorithm: 'RS256',
        issuer: 'platform',
        audience: 'pbl6',
      });
      await expect(verifier.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it.each([
      ['issuer', { issuer: 'someone-else' }],
      ['audience', { audience: 'another-app' }],
    ])('a token with the wrong %s', async (_, options) => {
      await expect(verifier.verify(await sign(options))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('an expired token', async () => {
      const token = await jwtService.signAsync(
        { ...claims, exp: Math.floor(Date.now() / 1000) - 10 },
        {
          privateKey,
          algorithm: 'RS256',
          keyid: 'key-1',
          issuer: 'platform',
          audience: 'pbl6',
        },
      );
      await expect(verifier.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a token missing the session claim', async () => {
      const token = await sign({
        payload: { sub: 'user-1', sub_type: 'account' },
      });
      await expect(verifier.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('garbage', async () => {
      await expect(verifier.verify('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('session revocation', () => {
    it('should reject a valid token whose session is revoked', async () => {
      const isSessionRevoked = jest.fn().mockResolvedValue(true);
      const revoking = createVerifier({ isSessionRevoked });

      await expect(revoking.verify(await sign())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(isSessionRevoked).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', sessionId: 'session-1' }),
      );
    });

    it('should not check revocation for an invalid token', async () => {
      const isSessionRevoked = jest.fn().mockResolvedValue(false);
      const revoking = createVerifier({ isSessionRevoked });

      await expect(revoking.verify('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(isSessionRevoked).not.toHaveBeenCalled();
    });

    it('should surface a revocation-store failure instead of a 401', async () => {
      const outage = new Error('redis down');
      const revoking = createVerifier({
        isSessionRevoked: jest.fn().mockRejectedValue(outage),
      });

      await expect(revoking.verify(await sign())).rejects.toBe(outage);
    });
  });
});
