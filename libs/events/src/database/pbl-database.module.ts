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

/** The connection options of a service, from the `DATABASE_*` variables */
export function databaseOptions(
  options: PblDatabaseOptions,
): DataSourceOptions {
  const ssl = process.env.DATABASE_SSL_ENABLED === 'true';
  return {
    type: 'postgres',
    host: env('DATABASE_HOST'),
    port: Number(env('DATABASE_PORT')) || 5432,
    username: env('DATABASE_USERNAME'),
    password: env('DATABASE_PASSWORD'),
    database: env('DATABASE_NAME'),
    schema: env('DATABASE_SCHEMA'),
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
}

/**
 * Opens the connection and runs the pending migrations, one instance at a time:
 * replicas of a service starting together queue on a Postgres advisory lock
 * instead of racing on the same `CREATE TABLE`. The schema is created only when
 * it is missing, so a database role without `CREATE` on the database works once
 * the schema exists.
 */
export async function initializeDatabase(
  resolved: DataSourceOptions,
): Promise<DataSource> {
  const schema = (resolved as { schema?: string }).schema;
  const guard = new DataSource({
    ...resolved,
    entities: [],
    migrations: [],
    migrationsRun: false,
    poolSize: 1,
  } as DataSourceOptions);
  await guard.initialize();
  const runner = guard.createQueryRunner();
  await runner.connect();
  const lockName = `pbl:migrate:${schema ?? 'public'}`;
  try {
    // held by this one connection until it is released below
    await runner.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
    if (schema) {
      const exists = await runner.query(
        'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
        [schema],
      );
      if (exists.length === 0) {
        await runner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      }
    }
    return await new DataSource(resolved).initialize();
  } finally {
    await runner
      .query('SELECT pg_advisory_unlock(hashtext($1))', [lockName])
      .catch(() => undefined);
    await runner.release();
    await guard.destroy();
  }
}

/**
 * Database connection of a service that has no TypeORM set up of its own
 * (every service except platform). Connects with the `DATABASE_*` variables to
 * the service's own schema (`DATABASE_SCHEMA`) and runs the pending migrations at
 * start (see initializeDatabase). `synchronize` is never on.
 */
@Module({})
export class PblDatabaseModule {
  static forRoot(options: PblDatabaseOptions): DynamicModule {
    return {
      module: PblDatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: () => databaseOptions(options),
          dataSourceFactory: async (resolved?: DataSourceOptions) =>
            initializeDatabase(resolved!),
        }),
      ],
    };
  }
}
