import {
  Controller,
  Delete,
  Get,
  INestApplication,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { PblAuthModule } from './pbl-auth.module';
import { createTestAuth } from './testing';

@Controller('things')
class ThingsController {
  @Get() list() {
    return { ok: true };
  }
  @Post() create() {
    throw new Error('the handler must not run');
  }
  @Delete(':id') remove() {
    throw new Error('the handler must not run');
  }
}

/** The read-only rule lives in the global AuthGuard of @pbl/auth, so it holds in every service that imports it. */
describe('read-only tokens through PblAuthModule (ADR-0025)', () => {
  const auth = createTestAuth();
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PblAuthModule.forRootAsync({ useFactory: () => auth.options })],
      controllers: [ThingsController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('lets a support token read', async () => {
    await request(app.getHttpServer())
      .get('/things')
      .set('Authorization', auth.supportBearer('t1'))
      .expect(200);
  });

  it('answers 403 AUTH_READ_ONLY to POST before the handler runs', async () => {
    const res = await request(app.getHttpServer())
      .post('/things')
      .set('Authorization', auth.supportBearer('t1'));
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('AUTH_READ_ONLY');
  });

  it('answers 403 AUTH_READ_ONLY to DELETE before the handler runs', async () => {
    const res = await request(app.getHttpServer())
      .delete('/things/1')
      .set('Authorization', auth.supportBearer('t1'));
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('AUTH_READ_ONLY');
  });

  it('lets an ordinary store token write', async () => {
    // the handler throws, so a 500 proves the guard let the request through
    await request(app.getHttpServer())
      .post('/things')
      .set('Authorization', auth.bearer(['owner'], 't1'))
      .expect(500);
  });
});

const APPS_DIR = join(__dirname, '..', '..', '..', 'apps');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' ? [] : sources(path);
    }
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });

describe('every service app wires the guard', () => {
  const apps = readdirSync(APPS_DIR)
    .filter((name) => statSync(join(APPS_DIR, name)).isDirectory())
    .sort();

  it('finds the eight apps', () => {
    expect(apps).toEqual([
      'catalog',
      'customer',
      'finance',
      'insight',
      'integration',
      'inventory',
      'platform',
      'sales',
    ]);
  });

  it.each(apps)('%s imports PblAuthModule exactly once', (app) => {
    const files = sources(join(APPS_DIR, app, 'src')).filter((f) =>
      /PblAuthModule\.(forRemoteJwks|forRootAsync)\(/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(files).toHaveLength(1);
  });
});
