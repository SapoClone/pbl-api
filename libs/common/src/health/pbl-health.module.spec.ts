import { INestApplication } from '@nestjs/common';
import { HealthCheckError } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import Redis from 'ioredis';
import request from 'supertest';
import { PblHealthModule } from './pbl-health.module';

describe('PblHealthModule', () => {
  let app: INestApplication;
  const savedRedis = process.env.REDIS_HOST;

  async function boot(options: Parameters<typeof PblHealthModule.forRoot>[0]) {
    const moduleRef = await Test.createTestingModule({
      imports: [PblHealthModule.forRoot(options)],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
    if (savedRedis === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = savedRedis;
  });

  it('GET /health and GET /health/live are liveness checks naming the service', async () => {
    await boot({ service: 'catalog' });
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'catalog' });
    const live = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(live.body).toEqual({ status: 'ok', service: 'catalog' });
  });

  it('GET /health/ready is 200 when every check is up', async () => {
    await boot({
      service: 'catalog',
      readiness: [async () => ({ db: { status: 'up' } })],
    });
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.db.status).toBe('up');
  });

  it('GET /health/ready is 503 when a check fails', async () => {
    await boot({
      service: 'catalog',
      readiness: [
        async () => {
          throw new HealthCheckError('down', { db: { status: 'down' } });
        },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body.status).toBe('error');
    expect(res.body.error.db.status).toBe('down');
  });

  it('checks Redis when redisFromEnv is on and REDIS_HOST is set', async () => {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '1'; // nothing listens here
    await boot({ service: 'catalog', redisFromEnv: true });
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body.error.redis.status).toBe('down');
    delete process.env.REDIS_PORT;
  });

  it('reports Redis down when the ping never resolves (timeout)', async () => {
    jest
      .spyOn(Redis.prototype, 'ping')
      .mockImplementation(() => new Promise(() => undefined) as any);
    process.env.REDIS_HOST = '127.0.0.1';
    await boot({ service: 'catalog', redisFromEnv: true, redisTimeoutMs: 50 });
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body.error.redis.status).toBe('down');
    expect(res.body.error.redis.message).toMatch(/timed out/);
    jest.restoreAllMocks();
  });

  it('is public: reachable with the auth guard installed', async () => {
    process.env.AUTH_JWKS_URL = 'http://127.0.0.1:1/jwks.json';
    delete process.env.REDIS_HOST;
    const moduleRef = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRemoteJwks(),
        PblHealthModule.forRoot({ service: 'catalog' }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
});
