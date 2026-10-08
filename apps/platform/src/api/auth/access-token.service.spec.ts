import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { AccessTokenService } from './access-token.service';

const rsaPem = (modulusLength: number) =>
  generateKeyPairSync('rsa', { modulusLength }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;

describe('AccessTokenService', () => {
  const privateKey = rsaPem(2048);
  const authConfig: Record<string, string> = {
    'auth.privateKey': privateKey,
    'auth.keyId': 'test-key-1',
    'auth.issuer': 'platform',
    'auth.audience': 'pbl6',
    'auth.expires': '15m',
  };
  const jwtService = new JwtService();

  const createService = (overrides: Record<string, string> = {}) => {
    const values = { ...authConfig, ...overrides };
    const configService = {
      getOrThrow: (key: string) => values[key],
    } as unknown as ConfigService;
    return new AccessTokenService(configService, jwtService);
  };

  let service: AccessTokenService;

  beforeAll(() => {
    service = createService();
  });

  describe('constructor', () => {
    it('should reject an RSA key shorter than 2048 bits', () => {
      expect(() => createService({ 'auth.privateKey': rsaPem(1024) })).toThrow(
        /2048/,
      );
    });

    it('should reject a non-RSA key', () => {
      const ecKey = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
      }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      expect(() => createService({ 'auth.privateKey': ecKey })).toThrow(/RSA/);
    });
  });

  describe('getJwks', () => {
    it('should publish only the public part of the signing key with its kid', () => {
      const { keys } = service.getJwks();

      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({
        kty: 'RSA',
        kid: 'test-key-1',
        alg: 'RS256',
        use: 'sig',
      });
      expect(keys[0].n).toBeDefined();
      expect(keys[0].e).toBeDefined();
      for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
        expect(keys[0]).not.toHaveProperty(privateField);
      }
    });
  });

  describe('sign', () => {
    it('should sign an RS256 token with kid, issuer, audience and subject claims', async () => {
      const token = await service.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      const { header, payload } = jwtService.decode(token, { complete: true });
      expect(header).toMatchObject({ alg: 'RS256', kid: 'test-key-1' });
      expect(payload).toMatchObject({
        sub: 'user-1',
        sid: 'session-1',
        sub_type: 'account',
        iss: 'platform',
        aud: 'pbl6',
      });
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });
  });

  describe('verify', () => {
    it('should return the authenticated user for a valid token', async () => {
      const token = await service.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(service.verify(token)).resolves.toEqual({
        id: 'user-1',
        sessionId: 'session-1',
        subjectType: 'account',
        exp: expect.any(Number),
      });
    });

    it('should reject an HS256 token even when signed with a known secret', async () => {
      const token = await jwtService.signAsync(
        { sub: 'user-1', sid: 'session-1', sub_type: 'account' },
        {
          secret: 'secret',
          algorithm: 'HS256',
          keyid: 'test-key-1',
          issuer: 'platform',
          audience: 'pbl6',
        },
      );

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject an unsigned token (alg none)', async () => {
      const encode = (part: object) =>
        Buffer.from(JSON.stringify(part)).toString('base64url');
      const token = `${encode({ alg: 'none', typ: 'JWT', kid: 'test-key-1' })}.${encode(
        {
          sub: 'user-1',
          sid: 'session-1',
          iss: 'platform',
          aud: 'pbl6',
          exp: Math.floor(Date.now() / 1000) + 60,
        },
      )}.`;

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject a token signed by another key', async () => {
      const otherService = createService({ 'auth.privateKey': rsaPem(2048) });
      const token = await otherService.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject a token with an unknown kid', async () => {
      const otherKid = createService({ 'auth.keyId': 'retired-key' });
      const token = await otherKid.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it.each([
      ['issuer', { 'auth.issuer': 'someone-else' }],
      ['audience', { 'auth.audience': 'another-app' }],
    ])('should reject a token with the wrong %s', async (_, overrides) => {
      const token = await createService(overrides).sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject an expired token', async () => {
      const token = await jwtService.signAsync(
        {
          sub: 'user-1',
          sid: 'session-1',
          sub_type: 'account',
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        {
          privateKey,
          algorithm: 'RS256',
          keyid: 'test-key-1',
          issuer: 'platform',
          audience: 'pbl6',
        },
      );

      await expect(service.verify(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject garbage', async () => {
      await expect(service.verify('not-a-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
