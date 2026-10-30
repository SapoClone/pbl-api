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

describe('Per-service DB role isolation & PostgreSQL RLS (ADR-0011)', () => {
  const inventorySchema = uniqueSchema('inv_rls');
  const salesSchema = uniqueSchema('sales_rls');
  const inventoryRole = `${inventorySchema}_app`;
  const salesRole = `${salesSchema}_app`;
  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';
  let admin: DataSource;
  let inventoryAppDs: DataSource;
  let salesAppDs: DataSource;

  beforeAll(async () => {
    useDatabase(inventorySchema);
    admin = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
    });
    await admin.initialize();

    await admin.query(`CREATE SCHEMA "${inventorySchema}"`);
    await admin.query(`CREATE SCHEMA "${salesSchema}"`);

    await admin.query(`
      CREATE TABLE "${inventorySchema}"."tenant_stock" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "sku" varchar(64) NOT NULL,
        "qty" numeric(18,3) NOT NULL
      )
    `);
    await admin.query(`
      CREATE TABLE "${salesSchema}"."tenant_order" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "code" varchar(64) NOT NULL
      )
    `);

    const { enableTenantRlsPolicy, provisionServiceRole } = await import(
      '../src'
    );
    await enableTenantRlsPolicy(admin, `"${inventorySchema}"."tenant_stock"`);
    await enableTenantRlsPolicy(admin, `"${salesSchema}"."tenant_order"`);

    await provisionServiceRole(admin, inventorySchema, inventoryRole, [
      salesSchema,
    ]);
    await provisionServiceRole(admin, salesSchema, salesRole, [
      inventorySchema,
    ]);

    inventoryAppDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: inventoryRole,
      password: inventoryRole,
      database: 'pbl',
      schema: inventorySchema,
    });
    salesAppDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: salesRole,
      password: salesRole,
      database: 'pbl',
      schema: salesSchema,
    });
    await inventoryAppDs.initialize();
    await salesAppDs.initialize();
  });

  afterAll(async () => {
    await inventoryAppDs?.destroy();
    await salesAppDs?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${inventorySchema}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "${salesSchema}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${inventoryRole}"`);
    await admin.query(`DROP ROLE IF EXISTS "${salesRole}"`);
    await admin.destroy();
  });

  it('denies cross-schema SELECT and UPDATE between sales_app and inventory schema', async () => {
    await expect(
      salesAppDs.query(`SELECT * FROM "${inventorySchema}"."tenant_stock"`),
    ).rejects.toThrow(/permission denied for schema/i);

    await expect(
      salesAppDs.query(
        `UPDATE "${inventorySchema}"."tenant_stock" SET qty = 0`,
      ),
    ).rejects.toThrow(/permission denied for schema/i);

    await expect(
      inventoryAppDs.query(`SELECT * FROM "${salesSchema}"."tenant_order"`),
    ).rejects.toThrow(/permission denied for schema/i);
  });

  it('enforces PostgreSQL FORCE ROW LEVEL SECURITY with transaction-local app.tenant_id and blocks cross-tenant reads and writes', async () => {
    const { runInTenantTransaction, TenantContext } = await import(
      '@pbl/common'
    );
    const rowA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rowB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    // Insert Tenant A row inside Tenant A transaction
    await TenantContext.run(TENANT_A, () =>
      runInTenantTransaction(inventoryAppDs, async (em) => {
        await em.query(
          `INSERT INTO "${inventorySchema}"."tenant_stock" (id, tenant_id, sku, qty) VALUES ($1, $2, 'SKU-A', 10.500)`,
          [rowA, TENANT_A],
        );
      }),
    );

    // Insert Tenant B row inside Tenant B transaction
    await TenantContext.run(TENANT_B, () =>
      runInTenantTransaction(inventoryAppDs, async (em) => {
        await em.query(
          `INSERT INTO "${inventorySchema}"."tenant_stock" (id, tenant_id, sku, qty) VALUES ($1, $2, 'SKU-B', 5.250)`,
          [rowB, TENANT_B],
        );
      }),
    );

    // 1. Without tenant context set, raw SELECT returns 0 rows (fail-closed)
    const unscopedRows = await inventoryAppDs.query(
      `SELECT * FROM "${inventorySchema}"."tenant_stock"`,
    );
    expect(unscopedRows).toEqual([]);

    // 2. Tenant A raw SELECT (with no WHERE clause!) only sees Tenant A's row
    const tenantARows = await TenantContext.run(TENANT_A, () =>
      runInTenantTransaction(inventoryAppDs, (em) =>
        em.query(`SELECT id, sku FROM "${inventorySchema}"."tenant_stock"`),
      ),
    );
    expect(tenantARows).toEqual([{ id: rowA, sku: 'SKU-A' }]);

    // 3. Tenant A cannot UPDATE Tenant B's row even by primary key
    await TenantContext.run(TENANT_A, () =>
      runInTenantTransaction(inventoryAppDs, async (em) => {
        await em.query(
          `UPDATE "${inventorySchema}"."tenant_stock" SET qty = 999 WHERE id = $1`,
          [rowB],
        );
      }),
    );
    const tenantBRows = await TenantContext.run(TENANT_B, () =>
      runInTenantTransaction(inventoryAppDs, (em) =>
        em.query(
          `SELECT id, qty FROM "${inventorySchema}"."tenant_stock" WHERE id = $1`,
          [rowB],
        ),
      ),
    );
    expect(tenantBRows).toEqual([{ id: rowB, qty: '5.250' }]);

    // 4. Tenant A cannot INSERT a row carrying Tenant B's tenant_id (WITH CHECK violation)
    await expect(
      TenantContext.run(TENANT_A, () =>
        runInTenantTransaction(inventoryAppDs, (em) =>
          em.query(
            `INSERT INTO "${inventorySchema}"."tenant_stock" (id, tenant_id, sku, qty) VALUES (gen_random_uuid(), $1, 'FORGED', 1.000)`,
            [TENANT_B],
          ),
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);
  });
});
