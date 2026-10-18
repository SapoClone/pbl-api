import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

export interface PblDatabaseOptions {
  /** Entity classes of the service, including the outbox and inbox ones it needs */
  entities: NonNullable<DataSourceOptions['entities']>;
  /** Migration classes, including the outbox and inbox ones it needs */
  migrations: NonNullable<DataSourceOptions['migrations']>;
}

const env = (name: string) => process.env[name] || undefined;

/**
 * Database connection of a service that has no TypeORM set up of its own
 * (every service except platform). Connects with the `DATABASE_*` variables to
 * the service's own schema (`DATABASE_SCHEMA`), creates the schema when it is
 * missing and runs the pending migrations at start. `synchronize` is never on.
 */
@Module({})
export class PblDatabaseModule {
  static forRoot(options: PblDatabaseOptions): DynamicModule {
    const schema = env('DATABASE_SCHEMA');
    const ssl = process.env.DATABASE_SSL_ENABLED === 'true';
    const config = {
      type: 'postgres',
      host: env('DATABASE_HOST'),
      port: Number(env('DATABASE_PORT')) || 5432,
      username: env('DATABASE_USERNAME'),
      password: env('DATABASE_PASSWORD'),
      database: env('DATABASE_NAME'),
      schema,
      entities: options.entities,
      migrations: options.migrations,
      migrationsTableName: 'migrations',
      migrationsRun: true,
      synchronize: false,
      poolSize: Number(env('DATABASE_MAX_CONNECTIONS')) || 10,
      ssl: ssl
        ? {
            rejectUnauthorized:
              process.env.DATABASE_REJECT_UNAUTHORIZED === 'true',
          }
        : undefined,
    } as DataSourceOptions;

    return {
      module: PblDatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => config,
          dataSourceFactory: async (resolved?: DataSourceOptions) => {
            if (schema) {
              // the migrations table lives in the schema, so it must exist first
              const bootstrap = new DataSource({
                ...resolved,
                entities: [],
                migrations: [],
                migrationsRun: false,
              } as DataSourceOptions);
              await bootstrap.initialize();
              await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
              await bootstrap.destroy();
            }
            return new DataSource(resolved!).initialize();
          },
        }),
      ],
    };
  }
}
