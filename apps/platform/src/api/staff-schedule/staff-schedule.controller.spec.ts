import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import request from 'supertest';
import { StaffScheduleController } from './staff-schedule.controller';
import { StaffScheduleService } from './staff-schedule.service';

const auth = createTestAuth();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ID = '44444444-4444-4444-8444-444444444444';

describe('StaffScheduleController', () => {
  let app: INestApplication;
  const service = {
    list: jest.fn(async () => []),
    create: jest.fn(async () => []),
    update: jest.fn(async () => ({ id: ID })),
    remove: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PblAuthModule.forRootAsync({
          useFactory: () => ({ ...auth.options, tenant: 'optional' }),
        }),
      ],
      controllers: [StaffScheduleController],
      providers: [{ provide: StaffScheduleService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const base = '/api/v1/staff-schedules';
  const as = (roles: string[], tid: string | null = TENANT) =>
    auth.bearer(roles, tid ?? undefined);
  const body = {
    accountId: ID,
    branchId: ID,
    weekdays: [1, 2],
    startTime: '08:00',
    endTime: '16:00',
  };

  it('refuses no token (401) and a token without a store (403)', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', as(['owner'], null))
      .expect(403);
  });

  it.each([
    ['cashier', 403],
    ['manager', 200],
    ['owner', 200],
  ])('as %s listing answers %i, wrapped in data', async (role, status) => {
    const res = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', as([role]))
      .expect(status);
    if (status === 200) expect(res.body).toEqual({ data: [] });
  });

  it.each([
    ['cashier', 403],
    ['manager', 201],
    ['owner', 201],
  ])('as %s creating answers %i', async (role, status) => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', as([role]))
      .send(body)
      .expect(status);
    expect(service.create).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
  });

  it('validates the body (422) and the id (400)', async () => {
    const owner = as(['owner']);
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', owner)
      .send({ ...body, weekdays: [9] })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`${base}/nope`)
      .set('Authorization', owner)
      .send({})
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('passes the filters, patches and deletes with 204', async () => {
    const owner = as(['owner']);
    await request(app.getHttpServer())
      .get(`${base}?branchId=${ID}&weekday=2`)
      .set('Authorization', owner)
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: ID, weekday: 2 }),
    );
    await request(app.getHttpServer())
      .patch(`${base}/${ID}`)
      .set('Authorization', owner)
      .send({ startTime: '14:00' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/${ID}`)
      .set('Authorization', owner)
      .expect(204);
    expect(service.remove).toHaveBeenCalledWith(ID);
  });
});
