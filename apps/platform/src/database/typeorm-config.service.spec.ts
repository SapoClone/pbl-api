import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmConfigService } from './typeorm-config.service';

describe('TypeOrmConfigService', () => {
  let service: TypeOrmConfigService;
  let configServiceValue: Partial<Record<keyof ConfigService, jest.Mock>>;

  beforeEach(async () => {
    configServiceValue = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'database.type': 'postgres',
          'database.host': 'localhost',
          'database.port': 5432,
          'database.username': 'postgres',
          'database.password': 'postgres',
          'database.name': 'pbl',
          'database.schema': 'platform',
          'database.synchronize': false,
          'database.logging': false,
          'database.maxConnections': 10,
          'database.sslEnabled': false,
        };
        return values[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TypeOrmConfigService,
        { provide: ConfigService, useValue: configServiceValue },
      ],
    }).compile();

    service = module.get<TypeOrmConfigService>(TypeOrmConfigService);
  });

  it('includes the configured schema in the TypeORM options', () => {
    const options = service.createTypeOrmOptions() as { schema?: string };
    expect(options.schema).toBe('platform');
  });
});
