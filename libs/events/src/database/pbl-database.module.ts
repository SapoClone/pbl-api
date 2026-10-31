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

/**
 * Idempotently provisions a non-superuser, NOBYPASSRLS runtime role restricted
 * to a single service schema (ADR-0002, ADR-0011).
 */
export async function provisionServiceRole(
  queryable: { query: DataSource['query'] },
  schema: string,
  roleName = `${schema}_app`,
  otherSchemas: string[] = [],
): Promise<string> {
  await queryable.query(
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(roleName)}) THEN
        EXECUTE format(
          'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
          ${quoteLiteral(roleName)},
          ${quoteLiteral(roleName)}
        );
      ELSE
        EXECUTE format(
          'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
          ${quoteLiteral(roleName)},
          ${quoteLiteral(roleName)}
        );
      END IF;
    END
    $$;
    `,
  );
  await queryable.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`);
  for (const other of otherSchemas) {
    if (other !== schema) {
      await queryable.query(
        `REVOKE ALL ON SCHEMA "${other}" FROM "${roleName}"`,
      );
    }
  }
  await queryable.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${roleName}"`);
  await queryable.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${roleName}"`,
  );
  await queryable.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${roleName}"`,
  );
  await queryable.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${roleName}"`,
  );
  await queryable.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${roleName}"`,
  );
  return roleName;
}

/**
 * Enables and forces PostgreSQL Row-Level Security on a tenant-owned table using
 * the fail-closed `app.tenant_id` transaction-local setting (ADR-0011).
 */
export async function enableTenantRlsPolicy(
  queryable: { query: DataSource['query'] },
  qualifiedTableName: string,
  policyName = 'tenant_isolation_policy',
): Promise<void> {
  await queryable.query(
    `ALTER TABLE ${qualifiedTableName} ENABLE ROW LEVEL SECURITY`,
  );
  await queryable.query(
    `ALTER TABLE ${qualifiedTableName} FORCE ROW LEVEL SECURITY`,
  );
  await queryable.query(
    `DROP POLICY IF EXISTS "${policyName}" ON ${qualifiedTableName}`,
  );
  await queryable.query(
    `
    CREATE POLICY "${policyName}" ON ${qualifiedTableName}
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    `,
  );
}

function quoteLiteral(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}
