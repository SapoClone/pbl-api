import { JwtService } from '@nestjs/jwt';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { AccessTokenVerifier } from './access-token.verifier';
import { JwksKeyResolver } from './jwks-key-resolver';

describe('JwksKeyResolver', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...createPublicKey(privateKey).export({ format: 'jwk' }),
    kid: 'key-1',
    alg: 'RS256',
    use: 'sig',
  };
  let server: Server;
  let jwksUri: string;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/jwks.json`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('should resolve the published key for a kid and cache it', async () => {
    const resolver = new JwksKeyResolver(jwksUri);
    const before = requests;

    const pem = await resolver.getPublicKey('key-1');
    await resolver.getPublicKey('key-1');

    expect(pem).toContain('BEGIN PUBLIC KEY');
    expect(requests - before).toBe(1);
  });

  it('should reject an unknown kid', async () => {
    await expect(
      new JwksKeyResolver(jwksUri).getPublicKey('nope'),
    ).rejects.toThrow();
  });

  it('should let the verifier accept a token signed by the published key', async () => {
    const token = await new JwtService().signAsync(
      { sub: 'user-1', sid: 'session-1', sub_type: 'account' },
      {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );
    const verifier = new AccessTokenVerifier({
      issuer: 'platform',
      audience: 'pbl6',
      keyResolver: new JwksKeyResolver(jwksUri),
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      id: 'user-1',
      sessionId: 'session-1',
    });
  });
});
