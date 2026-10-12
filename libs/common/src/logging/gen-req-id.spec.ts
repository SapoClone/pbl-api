import {
  Controller,
  Get,
  INestApplication,
  RequestMethod,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { genReqId } from './gen-req-id';
import { pinoLoggerOptions } from './pino-logger-options';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as any;
}

describe('genReqId', () => {
  it('keeps the incoming header and echoes it', () => {
    const res = fakeRes();
    const id = genReqId({ headers: { 'x-request-id': 'abc-123' } } as any, res);
    expect(id).toBe('abc-123');
    expect(res.headers['X-Request-Id']).toBe('abc-123');
  });

  it.each([
    ['too long', 'a'.repeat(129)],
    ['invalid characters', 'abc 123\r\nX-Evil: 1'],
    ['a slash', 'a/b'],
  ])('replaces an id that is %s with a uuid v4', (_label, value) => {
    const res = fakeRes();
    const id = genReqId({ headers: { 'x-request-id': value } } as any, res);
    expect(String(id)).toMatch(UUID_V4);
    expect(res.headers['X-Request-Id']).toBe(String(id));
  });

  it('accepts the maximum length and the allowed punctuation', () => {
    const value = `${'a'.repeat(100)}.:_-${'b'.repeat(24)}`;
    expect(
      genReqId({ headers: { 'x-request-id': value } } as any, fakeRes()),
    ).toBe(value);
  });

  it('uses the first value of an array header when valid, else a uuid', () => {
    expect(
      genReqId(
        { headers: { 'x-request-id': ['one', 'two'] } } as any,
        fakeRes(),
      ),
    ).toBe('one');
    expect(
      String(
        genReqId({ headers: { 'x-request-id': ['b d'] } } as any, fakeRes()),
      ),
    ).toMatch(UUID_V4);
  });

  it('generates a uuid v4 when absent and echoes it', () => {
    const res = fakeRes();
    const id = genReqId({ headers: {} } as any, res);
    expect(String(id)).toMatch(UUID_V4);
    expect(res.headers['X-Request-Id']).toBe(String(id));
  });
});

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return 'pong';
  }
}

describe('pinoLoggerOptions', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...(pinoLoggerOptions('svc').pinoHttp as object),
            level: 'silent',
          },
        }),
      ],
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('echoes X-Request-Id on every response, including 404', async () => {
    const ok = await request(app.getHttpServer())
      .get('/ping')
      .set('X-Request-Id', 'rid-1')
      .expect(200);
    expect(ok.headers['x-request-id']).toBe('rid-1');
    const missing = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(missing.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('puts the service in the base and redacts credentials', () => {
    const opts = pinoLoggerOptions('catalog').pinoHttp as any;
    expect(opts.base).toEqual({ service: 'catalog' });
    expect(opts.redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
      ]),
    );
  });

  it('echoes X-Request-Id behind a global prefix that excludes "/"', async () => {
    // Nest skips a default wildcard middleware route when the prefix
    // excludes "/" (platform does), so the options must pin their routes.
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          ...pinoLoggerOptions('svc'),
          pinoHttp: {
            ...(pinoLoggerOptions('svc').pinoHttp as object),
            level: 'silent',
          },
        }),
      ],
      controllers: [PingController],
    }).compile();
    const prefixed = moduleRef.createNestApplication();
    prefixed.setGlobalPrefix('api', {
      exclude: [
        { method: RequestMethod.GET, path: '/' },
        { method: RequestMethod.GET, path: 'ping' },
      ],
    });
    await prefixed.init();
    const res = await request(prefixed.getHttpServer())
      .get('/ping')
      .set('X-Request-Id', 'rid-9')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('rid-9');
    const missing = await request(prefixed.getHttpServer())
      .get('/api/nope')
      .expect(404);
    expect(missing.headers['x-request-id']).toBeTruthy();
    await prefixed.close();
  });
});
