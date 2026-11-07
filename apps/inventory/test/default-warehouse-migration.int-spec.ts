/**
 * The default-warehouse migration under the database role production uses: a role that owns the tables, is not a
 * superuser and does not bypass row-level security. `warehouse` has FORCE ROW LEVEL SECURITY, so an INSERT with no
 * tenant context is refused: that is what crash-looped inventory in production while the same migration passed as a
 * superuser. Run with `pnpm exec jest --config libs/events/test/jest-int.json --maxWorkers=1 <this file>`.
 */
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  provisionServiceRole,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { M2_INVENTORY_ENTITIES } from '../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { AllowReservationExpirySelect1792500000000 } from '../src/migrations/1792500000000-allow-reservation-expiry-select';
import { DefaultBranchWarehouse1792700000000 } from '../src/migrations/1792700000000-default-branch-warehouse';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('default warehouse migration as the production database role (Postgres)', () => {
  const schema = uniqueSchema('inv_dwm_it');
  const role = `${schema}_app`;
  let admin: DataSource;
  let roleDs: DataSource;
  const t = (name: string) => `"${schema}"."${name}"`;

  const branch = (
    tenant: string,
    id: string,
    code: string,
    status = 'active',
  ) =>
    admin.query(
      `INSERT INTO ${t('branch_projection')} (branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at)
       VALUES ($1, $2, $3, $4, true, $5, now())`,
      [id, tenant, code, `Chi nhanh ${code}`, status],
    );
  const warehouse = (
    tenant: string,
    id: string,
    branchId: string | null,
    code: string,
    isDefault: boolean,
    status = 'ACTIVE',
    kind = 'BRANCH',
  ) =>
    admin.query(
      `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [id, tenant, branchId, code, kind, isDefault, status],
    );

  const BRANCH_NEW = randomUUID(); // active, no warehouse yet: gets one
  const BRANCH_NEW_2 = randomUUID(); // another tenant, same code: gets one too
  const BRANCH_OFF = randomUUID(); // inactive: gets none
  const BRANCH_HAS = randomUUID(); // already has a default: untouched
  const BRANCH_DUP = randomUUID(); // two defaults: the oldest keeps it
  const BRANCH_NODEF = randomUUID(); // a warehouse but no default: gets one
  const WH_HAS = randomUUID();
  const WH_DUP_OLD = randomUUID();
  const WH_DUP_NEW = randomUUID();
  const WH_NODEF = randomUUID();

  beforeAll(async () => {
    useDatabase(schema);
    admin = await initializeDatabase(
      databaseOptions({
        entities: [
          StockItemEntity,
          StockReservationEntity,
          StockReservationItemEntity,
          InventoryLedgerEntity,
          ...WAREHOUSE_STOCK_ENTITIES,
          ...M2_INVENTORY_ENTITIES,
          BranchProjectionEntity,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        // everything BEFORE the migration under test
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInventoryTables1791900000000,
          AddWarehouseStockBalances1791900000100,
          CreateM2InventoryCore1791900000200,
          AllowReservationExpirySelect1792500000000,
        ],
      }),
    );

    await branch(T1, BRANCH_NEW, 'CN01');
    await branch(T2, BRANCH_NEW_2, 'CN01');
    await branch(T1, BRANCH_OFF, 'CN09', 'inactive');
    await branch(T1, BRANCH_HAS, 'CN02');
    await branch(T1, BRANCH_DUP, 'CN03');
    await branch(T1, BRANCH_NODEF, 'CN04');
    await warehouse(T1, WH_HAS, BRANCH_HAS, 'WH-HAS', true);
    await warehouse(T1, WH_DUP_OLD, BRANCH_DUP, 'WH-DUP1', true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await warehouse(T1, WH_DUP_NEW, BRANCH_DUP, 'WH-DUP2', true);
    await warehouse(T1, WH_NODEF, BRANCH_NODEF, 'WH-NODEF', false);

    // the production role: not a superuser, no BYPASSRLS, owner of the tables (so it can create the index) and
    // therefore still subject to FORCE ROW LEVEL SECURITY
    await provisionServiceRole(admin, schema, role);
    // in production the service role owns its schema; creating an index needs CREATE on it
    await admin.query(`GRANT CREATE ON SCHEMA ${`"${schema}"`} TO "${role}"`);
    for (const table of ['warehouse', 'branch_projection']) {
      await admin.query(`ALTER TABLE ${t(table)} OWNER TO "${role}"`);
    }
    roleDs = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: role,
      password: role,
      database: 'pbl',
      schema,
    });
    await roleDs.initialize();
  });

  afterAll(async () => {
    await roleDs?.destroy();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.destroy();
  });

  const runUp = async () => {
    const runner = roleDs.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await new DefaultBranchWarehouse1792700000000().up(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  };
  const warehousesOf = (branchId: string) =>
    admin.query(
      `SELECT code, kind, is_default AS "isDefault", status FROM ${t('warehouse')}
       WHERE branch_id = $1 ORDER BY created_at, code`,
      [branchId],
    );

  it('runs as the production role: the role is restricted and the table is under forced RLS', async () => {
    const [{ rolsuper, rolbypassrls }] = await admin.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(rolsuper).toBe(false);
    expect(rolbypassrls).toBe(false);
    const [{ relforcerowsecurity }] = await admin.query(
      `SELECT relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'warehouse'`,
      [schema],
    );
    expect(relforcerowsecurity).toBe(true);
  });

  it('backfills, repairs and indexes without a tenant context', async () => {
    await runUp();

    // an active branch with no warehouse gets exactly one default BRANCH warehouse, in its own tenant
    expect(await warehousesOf(BRANCH_NEW)).toEqual([
      { code: 'CN01', kind: 'BRANCH', isDefault: true, status: 'ACTIVE' },
    ]);
    expect(await warehousesOf(BRANCH_NEW_2)).toEqual([
      { code: 'CN01', kind: 'BRANCH', isDefault: true, status: 'ACTIVE' },
    ]);
    const owners = await admin.query(
      `SELECT branch_id, tenant_id FROM ${t('warehouse')} WHERE branch_id = ANY($1)`,
      [[BRANCH_NEW, BRANCH_NEW_2]],
    );
    expect(
      Object.fromEntries(owners.map((o: any) => [o.branch_id, o.tenant_id])),
    ).toEqual({ [BRANCH_NEW]: T1, [BRANCH_NEW_2]: T2 });

    // an inactive branch gets none
    expect(await warehousesOf(BRANCH_OFF)).toEqual([]);
    // a branch that had a default keeps it, and gets no second warehouse
    expect(await warehousesOf(BRANCH_HAS)).toEqual([
      { code: 'WH-HAS', kind: 'BRANCH', isDefault: true, status: 'ACTIVE' },
    ]);
    // two defaults: the oldest keeps it
    expect(await warehousesOf(BRANCH_DUP)).toEqual([
      { code: 'WH-DUP1', kind: 'BRANCH', isDefault: true, status: 'ACTIVE' },
      { code: 'WH-DUP2', kind: 'BRANCH', isDefault: false, status: 'ACTIVE' },
    ]);
    // a warehouse but no default: it becomes the default
    expect(await warehousesOf(BRANCH_NODEF)).toEqual([
      { code: 'WH-NODEF', kind: 'BRANCH', isDefault: true, status: 'ACTIVE' },
    ]);
    // one default per branch is a database rule now
    const [{ n }] = await admin.query(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = $1 AND indexname = 'UQ_warehouse_default_per_branch'`,
      [schema],
    );
    expect(n).toBe(1);
  });
});
