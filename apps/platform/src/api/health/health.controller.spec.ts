import { AllConfigType } from '@/config/config.type';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthCheckService;
  let configServiceValue: Partial<
    Record<keyof ConfigService<AllConfigType>, jest.Mock>
  >;
  let healthCheckServiceValue: Partial<
    Record<keyof HealthCheckService, jest.Mock>
  >;
  let httpUseValue: Partial<Record<keyof HttpHealthIndicator, jest.Mock>>;
  let redisPing: jest.Mock;
  let dbUseValue: Partial<Record<keyof TypeOrmHealthIndicator, jest.Mock>>;

  beforeAll(async () => {
    redisPing = jest.fn();
    configServiceValue = {
      get: jest.fn(),
    };

    healthCheckServiceValue = {
      check: jest.fn(),
    };

    httpUseValue = {
      pingCheck: jest.fn(),
    };

    dbUseValue = {
      pingCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          useValue: configServiceValue,
        },
        {
          provide: HealthCheckService,
          useValue: healthCheckServiceValue,
        },
        {
          provide: HttpHealthIndicator,
          useValue: httpUseValue,
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: dbUseValue,
        },
        {
          provide: CACHE_MANAGER,
          useValue: { store: { client: { ping: redisPing } } },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthCheckService>(HealthCheckService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  describe('check', () => {
    it('should return health check result', async () => {
      const healthCheckResult = {
        status: 'ok',
        info: {
          db: {
            status: 'up',
          },
          http: {
            status: 'up',
          },
        },
        error: {},
      };

      healthCheckServiceValue.check.mockReturnValue(healthCheckResult);

      const result = await controller.check();

      expect(result).toEqual(healthCheckResult);
      expect(healthCheckServiceValue.check).toHaveBeenCalledTimes(1);
    });
  });

  describe('ready', () => {
    it('checks the database and redis', async () => {
      dbUseValue.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      redisPing.mockResolvedValue('PONG');
      healthCheckServiceValue.check.mockImplementation(async (checks) => {
        const results = await Promise.all(checks.map((c) => c()));
        return { status: 'ok', info: Object.assign({}, ...results) };
      });

      const result: any = await controller.ready();

      expect(dbUseValue.pingCheck).toHaveBeenCalledWith('database');
      expect(redisPing).toHaveBeenCalledTimes(1);
      expect(result.info).toEqual({
        database: { status: 'up' },
        redis: { status: 'up' },
      });
    });

    it('reports redis down when the ping fails', async () => {
      dbUseValue.pingCheck.mockResolvedValue({ database: { status: 'up' } });
      redisPing.mockRejectedValue(new Error('ECONNREFUSED'));
      healthCheckServiceValue.check.mockImplementation(async (checks) =>
        Promise.all(checks.map((c) => c())),
      );

      await expect(controller.ready()).rejects.toMatchObject({
        causes: { redis: { status: 'down' } },
      });
    });
  });
});
