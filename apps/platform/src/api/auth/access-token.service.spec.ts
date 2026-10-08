import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenVerifier } from '@pbl/auth';
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

  describe("getPublicKey (platform's KeyResolver)", () => {
    it('should return the public key for the current kid', async () => {
      await expect(service.getPublicKey('test-key-1')).resolves.toContain(
        'BEGIN PUBLIC KEY',
      );
    });

    it('should reject an unknown kid', async () => {
      await expect(service.getPublicKey('retired-key')).rejects.toThrow();
    });
  });

  // Rejection cases (HS256, alg none, wrong key/iss/aud, expiry) are covered
  // by @pbl/auth's AccessTokenVerifier spec.
  describe('round trip with @pbl/auth', () => {
    it('should produce tokens the shared verifier accepts', async () => {
      const verifier = new AccessTokenVerifier({
        issuer: 'platform',
        audience: 'pbl6',
        keyResolver: service,
      });
      const token = await service.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(verifier.verify(token)).resolves.toEqual({
        id: 'user-1',
        sessionId: 'session-1',
        subjectType: 'account',
        exp: expect.any(Number),
      });
    });

    it('should not be accepted by a verifier expecting another issuer', async () => {
      const verifier = new AccessTokenVerifier({
        issuer: 'someone-else',
        audience: 'pbl6',
        keyResolver: service,
      });
      const token = await service.sign({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(verifier.verify(token)).rejects.toThrow();
    });
  });
});
