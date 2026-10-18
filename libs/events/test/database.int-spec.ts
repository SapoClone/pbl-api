/**
 * PblDatabaseModule's start-up against a real Postgres: the schema is created when
 * missing and several replicas starting together migrate one at a time.
 */
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import {
  CONSUMER_MIGRATIONS,
  InboxEventEntity,
  databaseOptions,
  initializeDatabase,
  qualifiedTable,
} from '../src';
import { uniqueSchema, useDatabase } from './it-env';

/** A migration slow enough that two unlocked replicas would collide on it */
class CreateSlowTable1791900000000 implements MigrationInterface {
  name = 'CreateSlowTable1791900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SELECT pg_sleep(0.6)');
    await queryRunner.query(
      `CREATE TABLE ${qualifiedTable(queryRunner, 'slow_table')} ("id" uuid PRIMARY KEY)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'slow_table')}`,
    );
  }
}

describe('PblDatabaseModule start-up (Postgres)', () => {
  const schema = uniqueSchema('db_it');
  let admin: DataSource;

  beforeAll(async () => {
    useDatabase(schema);
    admin = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
    });
    await admin.initialize();
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
  });

  const options = () =>
    databaseOptions({
      entities: [InboxEventEntity],
      migrations: [...CONSUMER_MIGRATIONS, CreateSlowTable1791900000000],
    });
  const schemaExists = async () =>
    (
      await admin.query(
        'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
        [schema],
      )
    ).length === 1;

  it('creates the schema when it is missing and runs the migrations in it', async () => {
    expect(await schemaExists()).toBe(false);

    const ds = await initializeDatabase(options());
    await ds.destroy();

    expect(await schemaExists()).toBe(true);
    const tables = await admin.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1',
      [schema],
    );
    expect(tables.map((t: { table_name: string }) => t.table_name)).toEqual([
      'inbox_event',
      'migrations',
      'slow_table',
    ]);
  });

  it('does nothing on a database that is already migrated', async () => {
    const ds = await initializeDatabase(options());
    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM "${schema}"."migrations"`,
    );
    await ds.destroy();

    expect(rows[0].n).toBe(2);
  });

  it('lets replicas starting together migrate one at a time (advisory lock)', async () => {
    const fresh = uniqueSchema('db_it_race');
    process.env.DATABASE_SCHEMA = fresh;
    try {
      const sources = await Promise.all(
        [1, 2, 3, 4].map(() => initializeDatabase(options())),
      );
      const migrated = await admin.query(
        `SELECT count(*)::int AS n FROM "${fresh}"."migrations"`,
      );
      await Promise.all(sources.map((ds) => ds.destroy()));

      // four replicas, each migration applied exactly once
      expect(migrated[0].n).toBe(2);
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`);
      process.env.DATABASE_SCHEMA = schema;
    }
  });
});
