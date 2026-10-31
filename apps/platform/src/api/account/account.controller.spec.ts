import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

const auth = createTestAuth();
const SESSION = '55555555-5555-4555-8555-555555555555';

describe('AccountController sessions and password', () => {
  let app: INestApplication;
  const service = {
    changePassword: jest.fn(async () => undefined),
    listSessions: jest.fn(async () => [{ id: SESSION, isCurrent: true }]),
    revokeSession: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [AccountController],
      providers: [{ provide: AccountService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, errorHttpStatusCode: 422 }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const base = '/api/v1/accounts/me';

  it('needs a token', async () => {
    await request(app.getHttpServer()).get(`${base}/sessions`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/change-password`)
      .send({})
      .expect(401);
  });

  it('changes the password with 204 and passes the current session', async () => {
    await request(app.getHttpServer())
      .post(`${base}/change-password`)
      .set('Authorization', auth.bearer([]))
      .send({ currentPassword: 'old-pass', newPassword: 'NewPass123' })
      .expect(204);

    expect(service.changePassword).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { currentPassword: 'old-pass', newPassword: 'NewPass123' },
    );
  });

  it('rejects a missing or too short new password (422)', async () => {
    await request(app.getHttpServer())
      .post(`${base}/change-password`)
      .set('Authorization', auth.bearer([]))
      .send({ currentPassword: 'old-pass', newPassword: '123' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`${base}/change-password`)
      .set('Authorization', auth.bearer([]))
      .send({ newPassword: 'NewPass123' })
      .expect(422);
    expect(service.changePassword).not.toHaveBeenCalled();
  });

  it('lists sessions wrapped in data', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/sessions`)
      .set('Authorization', auth.bearer([]))
      .expect(200);

    expect(res.body).toEqual({ data: [{ id: SESSION, isCurrent: true }] });
  });

  it('deletes a session with 204 and rejects a malformed id (400)', async () => {
    await request(app.getHttpServer())
      .delete(`${base}/sessions/${SESSION}`)
      .set('Authorization', auth.bearer([]))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`${base}/sessions/nope`)
      .set('Authorization', auth.bearer([]))
      .expect(400);
    expect(service.revokeSession).toHaveBeenCalledTimes(1);
  });
});
