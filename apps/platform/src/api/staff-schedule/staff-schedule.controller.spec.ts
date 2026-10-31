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
  const as = (
    permissions: string[],
    branches?: string[],
    tid: string | null = TENANT,
  ) =>
    auth.bearerWithPermissions(
      'custom',
      permissions,
      tid ?? undefined,
      branches,
    );
  const owner = () => auth.bearer(['owner'], TENANT);
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
      .set('Authorization', as(['staff.view'], undefined, null))
      .expect(403);
  });

  describe('permission matrix', () => {
    const routes: [string, string, (a: request.Agent) => request.Test][] = [
      ['staff.view', 'GET /', (a) => a.get(base)],
      ['staff.update', 'POST /', (a) => a.post(base).send(body)],
      [
        'staff.update',
        'PATCH /:id',
        (a) => a.patch(`${base}/${ID}`).send({ startTime: '14:00' }),
      ],
      ['staff.update', 'DELETE /:id', (a) => a.delete(`${base}/${ID}`)],
    ];

    it.each(routes)(
      '%s opens %s, other permissions do not',
      async (code, _r, send) => {
        const agent = request(app.getHttpServer());
        const allowed = await send(agent).set('Authorization', as([code]));
        expect(allowed.status).toBeLessThan(300);
        const wrongOnes = [
          'staff.create',
          'staff.delete',
          'orders.view',
          'settings.update',
        ];
        for (const wrong of wrongOnes) {
          await send(request(app.getHttpServer()))
            .set('Authorization', as([wrong]))
            .expect(403);
        }
        await send(request(app.getHttpServer()))
          .set('Authorization', as([]))
          .expect(403);
        // the other staff permission does not stand in: view cannot write, update cannot read
        const other = code === 'staff.view' ? 'staff.update' : 'staff.view';
        await send(request(app.getHttpServer()))
          .set('Authorization', as([other]))
          .expect(403);
      },
    );

    it('lets the owner do everything', async () => {
      await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner())
        .expect(200);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner())
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .delete(`${base}/${ID}`)
        .set('Authorization', owner())
        .expect(204);
    });

    it('wraps the list in data', async () => {
      const res = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', as(['staff.view']))
        .expect(200);
      expect(res.body).toEqual({ data: [] });
    });
  });

  it('validates the body (422) and the id (400)', async () => {
    await request(app.getHttpServer())
      .post(base)
      .set('Authorization', owner())
      .send({ ...body, weekdays: [9] })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`${base}/nope`)
      .set('Authorization', owner())
      .send({})
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('passes the filters, patches and deletes with 204', async () => {
    await request(app.getHttpServer())
      .get(`${base}?branchId=${ID}&weekday=2`)
      .set('Authorization', owner())
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: ID, weekday: 2 }),
      null,
    );
    await request(app.getHttpServer())
      .patch(`${base}/${ID}`)
      .set('Authorization', owner())
      .send({ startTime: '14:00' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/${ID}`)
      .set('Authorization', owner())
      .expect(204);
    expect(service.remove).toHaveBeenCalledWith(ID, null);
  });

  describe('branch scope', () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';

    it('hands the allowed branches to the service (null for every branch)', async () => {
      await request(app.getHttpServer())
        .get(base)
        .set('Authorization', as(['staff.view'], [ID]))
        .expect(200);
      expect(service.list).toHaveBeenLastCalledWith(expect.anything(), [ID]);
      await request(app.getHttpServer())
        .patch(`${base}/${OTHER}`)
        .set('Authorization', as(['staff.update'], [ID]))
        .send({ startTime: '14:00' })
        .expect(200);
      expect(service.update).toHaveBeenLastCalledWith(
        'account-1',
        OTHER,
        expect.anything(),
        [ID],
      );
      await request(app.getHttpServer())
        .delete(`${base}/${OTHER}`)
        .set('Authorization', as(['staff.update'], [ID]))
        .expect(204);
      expect(service.remove).toHaveBeenLastCalledWith(OTHER, [ID]);
    });

    it('answers 404 (not 403) when creating a shift in a branch outside the scope', async () => {
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', as(['staff.update'], [OTHER]))
        .send(body)
        .expect(404);
      expect(service.create).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', as(['staff.update'], [ID]))
        .send(body)
        .expect(201);
    });
  });
});
