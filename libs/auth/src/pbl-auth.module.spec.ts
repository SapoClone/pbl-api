import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { AuthOptional, CurrentUser, Public } from './auth.decorators';
import { AuthUser } from './auth.types';
import { PblAuthModule } from './pbl-auth.module';

@Controller()
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('closed')
  closed(@CurrentUser() user: AuthUser) {
    return user;
  }

  @AuthOptional()
  @Get('maybe')
  maybe(@CurrentUser('id') id?: string) {
    return { id: id ?? null };
  }
}

/** How a non-platform service uses the library: PblAuthModule.forRemoteJwks() */
describe('PblAuthModule.forRemoteJwks', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwtService = new JwtService();
  let jwks: Server;
  let app: INestApplication;
  const originalEnv = { ...process.env };

  const sign = (key = privateKey) =>
    jwtService.signAsync(
      { sub: 'user-1', sid: 'session-1', sub_type: 'account' },
      {
        privateKey: key.export({ type: 'pkcs8', format: 'pem' }),
        algorithm: 'RS256',
        keyid: 'key-1',
        issuer: 'platform',
        audience: 'pbl6',
        expiresIn: '5m',
      },
    );

  beforeAll(async () => {
    const jwk = {
      ...createPublicKey(privateKey).export({ format: 'jwk' }),
      kid: 'key-1',
      alg: 'RS256',
      use: 'sig',
    };
    jwks = createServer((_, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, resolve));
    process.env.AUTH_JWKS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/.well-known/jwks.json`;

    const moduleRef = await Test.createTestingModule({
      imports: [PblAuthModule.forRemoteJwks()],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await app.close();
    await new Promise((resolve) => jwks.close(resolve));
  });

  it('should leave @Public() routes open', async () => {
    await request(app.getHttpServer()).get('/open').expect(200);
  });

  it('should reject protected routes without a token', async () => {
    await request(app.getHttpServer()).get('/closed').expect(401);
  });

  it('should accept a token signed with the published key and expose the caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign()}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: 'user-1',
      sessionId: 'session-1',
      subjectType: 'account',
    });
  });

  it('should reject a token signed with a key that is not published', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await request(app.getHttpServer())
      .get('/closed')
      .set('Authorization', `Bearer ${await sign(stranger.privateKey)}`)
      .expect(401);
  });

  it('should allow anonymous callers on @AuthOptional() routes', async () => {
    const res = await request(app.getHttpServer()).get('/maybe').expect(200);
    expect(res.body).toEqual({ id: null });
  });
});
