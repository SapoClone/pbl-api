import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import setupSwagger from './setup-swagger';

describe('setupSwagger', () => {
  let app: INestApplication;
  let configService: ConfigService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'app.name') return 'TestApp';
              if (key === 'app.url') return 'http://localhost:3000';
            }),
            get: jest.fn((key: string) => {
              if (key === 'app.swaggerUser') return undefined;
              if (key === 'app.swaggerPassword') return undefined;
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configService = moduleRef.get<ConfigService>(ConfigService);
    jest.spyOn(app, 'get').mockImplementation((service) => {
      if (service === ConfigService) return configService;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call ConfigService with correct parameters', () => {
    setupSwagger(app);
    expect(configService.getOrThrow).toHaveBeenCalledWith('app.name', {
      infer: true,
    });
    expect(configService.getOrThrow).toHaveBeenCalledWith('app.url', {
      infer: true,
    });
  });

  it('should call SwaggerModule.createDocument with correct parameters', () => {
    const createDocumentSpy = jest.spyOn(SwaggerModule, 'createDocument');
    setupSwagger(app);
    expect(createDocumentSpy).toHaveBeenCalled();
  });

  it('should call SwaggerModule.setup with correct parameters', () => {
    const setupSpy = jest.spyOn(SwaggerModule, 'setup');
    setupSwagger(app);
    expect(setupSpy).toHaveBeenCalledWith('api-docs', app, expect.any(Object), {
      customSiteTitle: 'TestApp',
    });
  });

  it('should not register basic auth when no credentials are configured', () => {
    const useSpy = jest.spyOn(app, 'use');
    setupSwagger(app);
    expect(useSpy).not.toHaveBeenCalled();
  });

  describe('with swagger credentials configured', () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'app.swaggerUser') return 'admin';
        if (key === 'app.swaggerPassword') return 'secret';
      });
    });

    function getMiddleware() {
      const useSpy = jest.spyOn(app, 'use');
      setupSwagger(app);
      expect(useSpy).toHaveBeenCalledWith(
        ['/api-docs', '/api-docs-json'],
        expect.any(Function),
      );
      return useSpy.mock.calls[0][1] as (
        req: any,
        res: any,
        next: jest.Mock,
      ) => void;
    }

    function mockRes() {
      return {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
    }

    it('rejects a request with no Authorization header', () => {
      const middleware = getMiddleware();
      const res = mockRes();
      const next = jest.fn();

      middleware({ headers: {} }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects wrong credentials', () => {
      const middleware = getMiddleware();
      const res = mockRes();
      const next = jest.fn();
      const auth = `Basic ${Buffer.from('admin:wrong').toString('base64')}`;

      middleware({ headers: { authorization: auth } }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('accepts correct credentials', () => {
      const middleware = getMiddleware();
      const res = mockRes();
      const next = jest.fn();
      const auth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

      middleware({ headers: { authorization: auth } }, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
