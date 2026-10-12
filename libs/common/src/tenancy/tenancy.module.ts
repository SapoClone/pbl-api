import { DynamicModule, Inject, Module, Provider } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { EntitySchema, Repository } from 'typeorm';
import { TenantScopedRepository } from './tenant-scoped.repository';

type EntityClassOrSchema = (new (...args: any[]) => any) | EntitySchema;

const entityName = (entity: EntityClassOrSchema) =>
  typeof entity === 'function' ? entity.name : entity.options.name;

/** Injection token of the TenantScopedRepository for `entity` */
export const getTenantScopedRepositoryToken = (entity: EntityClassOrSchema) =>
  `TenantScopedRepository<${entityName(entity)}>`;

/** Injects the TenantScopedRepository registered by TenancyModule.forFeature */
export const InjectTenantScopedRepository = (entity: EntityClassOrSchema) =>
  Inject(getTenantScopedRepositoryToken(entity));

/**
 * `TenancyModule.forFeature([Entity])` next to (or instead of)
 * `TypeOrmModule.forFeature([Entity])`: provides a TenantScopedRepository per
 * entity, injected with @InjectTenantScopedRepository(Entity).
 */
@Module({})
export class TenancyModule {
  static forFeature(entities: EntityClassOrSchema[]): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getTenantScopedRepositoryToken(entity),
      inject: [getRepositoryToken(entity)],
      useFactory: (repository: Repository<any>) =>
        new TenantScopedRepository(repository),
    }));
    return {
      module: TenancyModule,
      imports: [TypeOrmModule.forFeature(entities)],
      providers,
      exports: providers,
    };
  }
}
