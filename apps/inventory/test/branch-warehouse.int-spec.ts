/**
 * Workstream A (D1, D2, D13, D14) against a real Postgres: a branch gets its
 * default warehouse from the branch event, the warehouse rules, and the warehouse
 * a sale uses.
 */
import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { BranchProjectionEntity } from '../src/branches/branch-projection.entity';
import { BranchProjectionHandler } from '../src/branches/branch-projection.handler';
import { resolveBranchWarehouse } from '../src/branches/branch-warehouse';
import { M2_INVENTORY_ENTITIES } from '../src/infrastructure/persistence/inventory.entities';
import { CreateInventoryTables1791900000000 } from '../src/migrations/1791900000000-create-inventory-tables';
import { AddWarehouseStockBalances1791900000100 } from '../src/migrations/1791900000100-add-warehouse-stock-balances';
import { CreateM2InventoryCore1791900000200 } from '../src/migrations/1791900000200-create-m2-inventory-core';
import { AllowReservationExpirySelect1792500000000 } from '../src/migrations/1792500000000-allow-reservation-expiry-select';
import { DefaultBranchWarehouse1792700000000 } from '../src/migrations/1792700000000-default-branch-warehouse';
import { StockViewsService } from '../src/modules/stock-views/stock-views.service';
import { WarehousesController } from '../src/modules/warehouses/warehouses.controller';
import { WarehousesService } from '../src/modules/warehouses/warehouses.service';
import { WarehouseScopeService } from '../src/scope/warehouse-scope';
import {
  InventoryLedgerEntity,
  StockItemEntity,
  StockReservationEntity,
  StockReservationItemEntity,
  WAREHOUSE_STOCK_ENTITIES,
} from '../src/stock/entities/stock.entities';
import { ReservationsService } from '../src/stock/reservations.service';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SKU = '11111111-1111-4111-8111-111111111111';

describe('branch default warehouse (Postgres)', () => {
  const schema = uniqueSchema('inventory_bw_it');
  let ds: DataSource;
  let handler: BranchProjectionHandler;
  let warehouses: WarehousesService;
  let controller: WarehousesController;
  let reservations: ReservationsService;
  let views: StockViewsService;
  const t = (name: string) => `"${schema}"."${name}"`;
  const as = <T>(work: () => Promise<T>, tenantId = TENANT) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);

  const event = (
    branchId: string,
    over: Partial<{
      code: string;
      name: string;
      status: string;
      updatedAt: string;
    }> = {},
    tenantId = TENANT,
  ) =>
    ({
      id: randomUUID(),
      type: 'platform.branch.updated',
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId,
      actor: null,
      traceId: 'it',
      payload: {
        id: branchId,
        code: over.code ?? 'CN01',
        name: over.name ?? 'Chi nhanh 1',
        isWarehouse: false,
        status: over.status ?? 'active',
        updatedAt: over.updatedAt ?? new Date().toISOString(),
      },
    }) as never;
  const deliver = (e: never, tenantId = TENANT) =>
    as(
      () =>
        ds.transaction((manager) =>
          handler.onUpdated(e, manager as never),
        ) as Promise<void>,
      tenantId,
    );
  const warehousesOf = (branchId: string) =>
    ds.query(
      `SELECT id, code, name, kind, is_default AS "isDefault", status
       FROM ${t('warehouse')} WHERE branch_id = $1 ORDER BY created_at, code`,
      [branchId],
    );
  const at = (iso: string) => new Date(iso).toISOString();

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase(
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
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateInventoryTables1791900000000,
          AddWarehouseStockBalances1791900000100,
          CreateM2InventoryCore1791900000200,
          AllowReservationExpirySelect1792500000000,
          DefaultBranchWarehouse1792700000000,
        ],
      }),
    );
    handler = new BranchProjectionHandler();
    warehouses = new WarehousesService(ds);
    controller = new WarehousesController(
      warehouses,
      new WarehouseScopeService(ds),
    );
    reservations = new ReservationsService(ds, 15);
    views = new StockViewsService(ds);
  });

  afterAll(async () => {
    await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.destroy();
  });

  describe('the branch event creates the default warehouse (D1)', () => {
    it('creates exactly one default BRANCH warehouse for an active branch, and is idempotent', async () => {
      const branch = randomUUID();
      await deliver(event(branch, { code: 'Hn 01', name: 'Chi nhanh Ha Noi' }));
      await deliver(event(branch, { code: 'Hn 01', name: 'Chi nhanh Ha Noi' }));
      await deliver(event(branch, { name: 'Renamed' }));
      const rows = await warehousesOf(branch);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        code: 'HN-01',
        name: 'Chi nhanh Ha Noi',
        kind: 'BRANCH',
        isDefault: true,
        status: 'ACTIVE',
      });
    });

    it('creates one warehouse under concurrent delivery of several events', async () => {
      const branch = randomUUID();
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          deliver(event(branch, { code: 'CONC', name: `n${i}` })),
        ),
      );
      expect(await warehousesOf(branch)).toHaveLength(1);
    });

    it('makes the code unique in the tenant when it clashes', async () => {
      const a = randomUUID();
      const b = randomUUID();
      await deliver(event(a, { code: 'DUP' }));
      await deliver(event(b, { code: 'DUP' }));
      expect((await warehousesOf(a))[0].code).toBe('DUP');
      expect((await warehousesOf(b))[0].code).toBe('DUP-2');
    });

    it('creates nothing for a branch that is not active', async () => {
      const branch = randomUUID();
      await deliver(event(branch, { status: 'inactive' }));
      await deliver(event(branch, { status: 'deleted' }));
      expect(await warehousesOf(branch)).toHaveLength(0);
    });

    it('ignores a stale event', async () => {
      const branch = randomUUID();
      await deliver(event(branch, { updatedAt: at('2026-02-01') }));
      await deliver(
        event(branch, { status: 'inactive', updatedAt: at('2026-01-01') }),
      );
      expect((await warehousesOf(branch))[0].status).toBe('ACTIVE');
    });

    it('switches off the empty warehouses of an inactive branch, keeps one with stock, and re-activates on return', async () => {
      const branch = randomUUID();
      await deliver(
        event(branch, { code: 'LIFE', updatedAt: at('2026-03-01') }),
      );
      const extra = await as(() =>
        warehouses.create({
          code: 'LIFE-2',
          name: 'Second',
          branchId: branch,
        }),
      );
      await ds.query(
        `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
         VALUES ($1, $2, $3, $4, 5, 0)`,
        [randomUUID(), TENANT, extra.id, SKU],
      );
      await deliver(
        event(branch, { status: 'inactive', updatedAt: at('2026-03-02') }),
      );
      const rows = await warehousesOf(branch);
      expect(rows.find((r: any) => r.code === 'LIFE').status).toBe('INACTIVE');
      expect(rows.find((r: any) => r.code === 'LIFE-2').status).toBe('ACTIVE');

      await deliver(
        event(branch, { code: 'LIFE', updatedAt: at('2026-03-03') }),
      );
      const after = await warehousesOf(branch);
      expect(after).toHaveLength(2);
      expect(after.find((r: any) => r.code === 'LIFE')).toMatchObject({
        status: 'ACTIVE',
        isDefault: true,
      });
    });

    it('keeps tenants apart', async () => {
      const branch = randomUUID();
      await deliver(event(branch, { code: 'TEN' }, OTHER_TENANT), OTHER_TENANT);
      const rows = await ds.query(
        `SELECT tenant_id FROM ${t('warehouse')} WHERE branch_id = $1`,
        [branch],
      );
      expect(rows.map((r: any) => r.tenant_id)).toEqual([OTHER_TENANT]);
    });
  });

  describe('backfill migration', () => {
    it('gives every active branch without a BRANCH warehouse one, repairs defaults, and reverses', async () => {
      const bare = randomUUID();
      const inactive = randomUUID();
      const noDefault = randomUUID();
      const twoDefaults = randomUUID();
      for (const [id, code, status] of [
        [bare, 'BARE', 'active'],
        [inactive, 'OFF', 'inactive'],
        [noDefault, 'NODEF', 'active'],
        [twoDefaults, 'TWODEF', 'active'],
      ]) {
        await ds.query(
          `INSERT INTO ${t('branch_projection')} (branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at)
           VALUES ($1, $2, $3, $3, false, $4, now())`,
          [id, TENANT, code, status],
        );
      }
      // a taken code forces the suffix
      await ds.query(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status, created_at)
         VALUES ($1, $2, NULL, 'BARE', 'taken', 'CENTRAL', false, 'ACTIVE', now())`,
        [randomUUID(), TENANT],
      );
      await ds.query(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status, created_at)
         VALUES ($1, $2, $3, 'ND-1', 'n1', 'BRANCH', false, 'INACTIVE', now() - interval '2 day'),
                ($4, $2, $3, 'ND-2', 'n2', 'BRANCH', false, 'ACTIVE', now() - interval '1 day')`,
        [randomUUID(), TENANT, noDefault, randomUUID()],
      );
      // old data may hold two defaults in one branch: drop the index to plant them
      await ds.query(`DROP INDEX ${t('UQ_warehouse_default_per_branch')}`);
      await ds.query(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status, created_at)
         VALUES ($1, $2, $3, 'TD-1', 'a', 'BRANCH', true, 'ACTIVE', now() - interval '2 day'),
                ($4, $2, $3, 'TD-2', 'b', 'BRANCH', true, 'ACTIVE', now() - interval '1 day')`,
        [randomUUID(), TENANT, twoDefaults, randomUUID()],
      );

      const runner = ds.createQueryRunner();
      try {
        const migration = new DefaultBranchWarehouse1792700000000();
        await migration.up(runner);

        const b = await warehousesOf(bare);
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({
          code: expect.stringMatching(/^BARE-[0-9a-f]{8}$/),
          kind: 'BRANCH',
          isDefault: true,
          status: 'ACTIVE',
        });
        expect(await warehousesOf(inactive)).toHaveLength(0);
        const nd = await warehousesOf(noDefault);
        expect(
          nd.filter((r: any) => r.isDefault).map((r: any) => r.code),
        ).toEqual(['ND-2']);
        const td = await warehousesOf(twoDefaults);
        expect(
          td.filter((r: any) => r.isDefault).map((r: any) => r.code),
        ).toEqual(['TD-1']);
        // the rule is now a database rule
        await expect(
          ds.query(
            `UPDATE ${t('warehouse')} SET is_default = true WHERE code = 'TD-2'`,
          ),
        ).rejects.toThrow(/UQ_warehouse_default_per_branch/);

        await migration.down(runner);
        await ds.query(
          `UPDATE ${t('warehouse')} SET is_default = true WHERE code = 'TD-2'`,
        );
        await ds.query(
          `UPDATE ${t('warehouse')} SET is_default = false WHERE code = 'TD-2'`,
        );
        await migration.up(runner);
        expect(await warehousesOf(bare)).toHaveLength(1);
      } finally {
        await runner.release();
      }
    });
  });

  describe('warehouse rules (D13, D14)', () => {
    let branchA: string;
    let branchB: string;
    let whA: { id: string };
    let whB: { id: string };

    beforeAll(async () => {
      branchA = randomUUID();
      branchB = randomUUID();
      await deliver(event(branchA, { code: 'RA' }));
      await deliver(event(branchB, { code: 'RB' }));
      whA = (await warehousesOf(branchA))[0];
      whB = (await warehousesOf(branchB))[0];
    });

    it('POST with a code that exists is a 409 and overwrites nothing', async () => {
      const created = await as(() =>
        warehouses.create({
          code: 'KEEP',
          name: 'Original',
          branchId: branchB,
        }),
      );
      await expect(
        as(() =>
          warehouses.create({
            code: 'keep',
            name: 'Takeover',
            branchId: branchA,
          }),
        ),
      ).rejects.toMatchObject({
        code: 'WAREHOUSE_CODE_CONFLICT',
        httpStatus: 409,
      });
      const after = await as(() => warehouses.getById(created.id));
      expect(after).toMatchObject({ name: 'Original', branchId: branchB });
    });

    it('a manager scoped to branch A cannot create, read, move or detach a warehouse of branch B', async () => {
      const scoped = [branchA];
      await expect(
        as(() =>
          controller.create(
            { code: 'NEW-B', name: 'x', branchId: branchB },
            scoped,
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(() => controller.update(whB.id, { name: 'hijack' }, scoped)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(() => controller.update(whA.id, { branchId: branchB }, scoped)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(() => controller.update(whA.id, { branchId: null }, scoped)),
      ).rejects.toMatchObject({ status: 404 });
      // nor a branch-less warehouse
      await expect(
        as(() =>
          controller.create(
            { code: 'CEN-X', name: 'x', kind: 'CENTRAL' },
            scoped,
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect((await as(() => warehouses.getById(whB.id))).branchId).toBe(
        branchB,
      );
    });

    it('a BRANCH warehouse needs an active branch; CENTRAL and QUARANTINE have none', async () => {
      const inactive = randomUUID();
      await deliver(event(inactive, { code: 'GONE', status: 'inactive' }));
      await expect(
        as(() =>
          warehouses.create({ code: 'W1', name: 'x', branchId: inactive }),
        ),
      ).rejects.toMatchObject({ code: 'BRANCH_NOT_ACTIVE' });
      await expect(
        as(() =>
          warehouses.create({ code: 'W2', name: 'x', branchId: randomUUID() }),
        ),
      ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
      await expect(
        as(() => warehouses.create({ code: 'W3', name: 'x' })),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_BRANCH_INVALID' });
      for (const kind of ['CENTRAL', 'QUARANTINE'] as const) {
        await expect(
          as(() =>
            warehouses.create({
              code: `K-${kind}`,
              name: 'x',
              kind,
              branchId: branchA,
            }),
          ),
        ).rejects.toMatchObject({ code: 'WAREHOUSE_BRANCH_INVALID' });
      }
      const central = await as(() =>
        warehouses.create({ code: 'CEN-1', name: 'Central', kind: 'CENTRAL' }),
      );
      expect(central).toMatchObject({ branchId: null, isDefault: false });
    });

    it('the first warehouse of a branch is its default; isDefault moves it; the only default cannot be unset', async () => {
      const b = randomUUID();
      // no event: the branch is known to inventory but has no warehouse yet
      await ds.query(
        `INSERT INTO ${t('branch_projection')} (branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at)
         VALUES ($1, $2, 'FIRST', 'First', false, 'active', now())`,
        [b, TENANT],
      );
      const first = await as(() =>
        warehouses.create({ code: 'F-1', name: 'one', branchId: b }),
      );
      expect(first.isDefault).toBe(true);
      const second = await as(() =>
        warehouses.create({ code: 'F-2', name: 'two', branchId: b }),
      );
      expect(second.isDefault).toBe(false);

      await expect(
        as(() => warehouses.update(first.id, { isDefault: false })),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_IS_DEFAULT' });
      await expect(
        as(() => warehouses.update(first.id, { status: 'INACTIVE' })),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_IS_DEFAULT' });

      await as(() => warehouses.update(second.id, { isDefault: true }));
      const rows = await warehousesOf(b);
      expect(
        rows.filter((r: any) => r.isDefault).map((r: any) => r.code),
      ).toEqual(['F-2']);
      // now the old default can go
      await as(() => warehouses.update(first.id, { status: 'INACTIVE' }));
    });

    it('PATCH cannot move or re-kind a warehouse that holds stock, holds or transfers, and cannot detach a BRANCH warehouse', async () => {
      const mover = await as(() =>
        warehouses.create({ code: 'MOVER', name: 'm', branchId: branchA }),
      );
      await ds.query(
        `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
         VALUES ($1, $2, $3, $4, 3, 0)`,
        [randomUUID(), TENANT, mover.id, SKU],
      );
      await ds.query(
        `INSERT INTO ${t('stock_transfer')} (id, tenant_id, code, from_warehouse_id, to_warehouse_id, status)
         VALUES ($1, $2, 'T-MOVER', $3, $4, 'DRAFT')`,
        [randomUUID(), TENANT, mover.id, whA.id],
      );
      await expect(
        as(() => warehouses.update(mover.id, { branchId: branchB })),
      ).rejects.toMatchObject({
        code: 'WAREHOUSE_BRANCH_LOCKED',
        httpStatus: 409,
        details: {
          reasons: expect.arrayContaining([
            'NON_ZERO_STOCK_BALANCE',
            'PENDING_TRANSFERS',
          ]),
        },
      });
      await expect(
        as(() => warehouses.update(mover.id, { branchId: null })),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_BRANCH_LOCKED' });
      await expect(
        as(() => warehouses.update(mover.id, { kind: 'CENTRAL' })),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_BRANCH_LOCKED' });
      expect((await as(() => warehouses.getById(mover.id))).branchId).toBe(
        branchA,
      );

      // an empty one may change branch, and is not made the default there
      const empty = await as(() =>
        warehouses.create({ code: 'EMPTY', name: 'e', branchId: branchA }),
      );
      const moved = await as(() =>
        warehouses.update(empty.id, { branchId: branchB }),
      );
      expect(moved).toMatchObject({ branchId: branchB, isDefault: false });
      // the default of a branch cannot be moved away
      await expect(
        as(() => warehouses.update(whA.id, { branchId: branchB })),
      ).rejects.toMatchObject({
        details: { reasons: expect.arrayContaining(['DEFAULT_WAREHOUSE']) },
      });
    });
  });

  describe('branch stock counts BRANCH warehouses only (D14)', () => {
    it('a CENTRAL or QUARANTINE warehouse does not count, even with a branch_id left on it', async () => {
      const branch = randomUUID();
      await deliver(event(branch, { code: 'VIEW' }));
      const own = (await warehousesOf(branch))[0];
      const legacyCentral = randomUUID();
      const legacyQuarantine = randomUUID();
      await ds.query(
        `INSERT INTO ${t('warehouse')} (id, tenant_id, branch_id, code, name, kind, is_default, status)
         VALUES ($1, $3, $4, 'LEG-C', 'c', 'CENTRAL', false, 'ACTIVE'),
                ($2, $3, $4, 'LEG-Q', 'q', 'QUARANTINE', false, 'ACTIVE')`,
        [legacyCentral, legacyQuarantine, TENANT, branch],
      );
      for (const [wh, qty] of [
        [own.id, 4],
        [legacyCentral, 100],
        [legacyQuarantine, 7],
      ] as const) {
        await ds.query(
          `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
           VALUES ($1, $2, $3, $4, $5, 0)`,
          [randomUUID(), TENANT, wh, SKU, qty],
        );
      }
      const list = await as(() =>
        views.list({ branchId: branch, page: 1, limit: 20 } as never, null),
      );
      expect(list.data).toHaveLength(1);
      expect(Number((list.data[0] as { onHand: number }).onHand)).toBe(4);
    });
  });

  describe('the warehouse a sale uses (D2)', () => {
    let branch: string;
    let other: string;
    let own: { id: string };
    let foreign: { id: string };
    let central: { id: string };
    let quarantine: { id: string };

    const reserve = (over: Record<string, unknown>, key = randomUUID()) =>
      as(() =>
        reservations.reserveWarehouseStock(key, {
          callerService: 'sales',
          sourceRefType: 'ORDER',
          sourceRefId: randomUUID(),
          branchId: branch,
          lines: [{ skuId: SKU, qty: '1.000' }],
          ...over,
        } as never),
      );

    beforeAll(async () => {
      branch = randomUUID();
      other = randomUUID();
      await deliver(event(branch, { code: 'SALE' }));
      await deliver(event(other, { code: 'SALE2' }));
      own = (await warehousesOf(branch))[0];
      foreign = (await warehousesOf(other))[0];
      central = await as(() =>
        warehouses.create({ code: 'SALE-C', name: 'c', kind: 'CENTRAL' }),
      );
      quarantine = await as(() =>
        warehouses.create({ code: 'SALE-Q', name: 'q', kind: 'QUARANTINE' }),
      );
      for (const wh of [own, foreign, central, quarantine]) {
        await ds.query(
          `INSERT INTO ${t('stock_balance')} (id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty)
           VALUES ($1, $2, $3, $4, 50, 0)`,
          [randomUUID(), TENANT, wh.id, SKU],
        );
      }
    });

    it('resolves the branch default warehouse when no warehouse is named', async () => {
      const r = await reserve({});
      expect(r.reservation.lines[0].warehouseId).toBe(own.id);
    });

    it('replays by key without the resolved warehouse changing the hash', async () => {
      const key = randomUUID();
      const sourceRefId = randomUUID();
      const first = await reserve({ sourceRefId }, key);
      const again = await reserve({ sourceRefId }, key);
      expect(again.replayed).toBe(true);
      expect(again.reservation.reservationId).toBe(
        first.reservation.reservationId,
      );
    });

    it('accepts the branch own warehouse when it is named', async () => {
      const r = await reserve({
        lines: [{ skuId: SKU, warehouseId: own.id, qty: '1.000' }],
      });
      expect(r.reservation.lines[0].warehouseId).toBe(own.id);
    });

    it('refuses another branch, central and quarantine warehouses with WAREHOUSE_NOT_IN_BRANCH', async () => {
      for (const wh of [foreign, central, quarantine]) {
        await expect(
          reserve({
            lines: [{ skuId: SKU, warehouseId: wh.id, qty: '1.000' }],
          }),
        ).rejects.toMatchObject({
          code: 'WAREHOUSE_NOT_IN_BRANCH',
          httpStatus: 409,
        });
      }
    });

    it('answers BRANCH_HAS_NO_WAREHOUSE for a branch without one, and requires the branch for a sale', async () => {
      await expect(reserve({ branchId: randomUUID() })).rejects.toMatchObject({
        code: 'BRANCH_HAS_NO_WAREHOUSE',
        httpStatus: 409,
      });
      await expect(reserve({ branchId: undefined })).rejects.toMatchObject({
        response: { errorCode: 'BRANCH_REQUIRED' },
      });
    });

    it('resolveBranchWarehouse answers the same way for the sales pre-check', async () => {
      const resolved = await as(() =>
        ds.transaction((em) => resolveBranchWarehouse(em, TENANT, branch)),
      );
      expect(resolved.id).toBe(own.id);
      await expect(
        as(() =>
          ds.transaction((em) =>
            resolveBranchWarehouse(em, TENANT, branch, central.id),
          ),
        ),
      ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_IN_BRANCH' });
    });
  });
});
