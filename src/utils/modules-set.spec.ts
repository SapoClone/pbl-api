import { ApiModule } from '@/api/api.module';
import { CloudTasksModule } from '@/cloud-tasks/cloud-tasks.module';
import { ConfigModule } from '@nestjs/config';
import generateModulesSet from './modules-set';

describe('generateModulesSet', () => {
  it('should return the full module set', () => {
    const modules = generateModulesSet();
    expect(modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining(
          Promise.resolve({
            module: ConfigModule,
          }),
        ), // ConfigModule
        ApiModule,
        expect.any(Object), // CacheModule
        expect.any(Object), // TypeOrmModule
        expect.any(Object), // I18nModule
        expect.any(Object), // LoggerModule
        CloudTasksModule,
      ]),
    );
  });
});
