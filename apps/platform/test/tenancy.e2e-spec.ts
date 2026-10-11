/**
 * Review Focus 2 against a real Postgres: the tenant-scoped repository filters
 * every read and write, also inside transactions, and refuses to run outside
 * a tenant context.
 *
 * Uses the stack's `pbl` database with a throwaway schema created and dropped
 * here, so no real table is touched. Run (Git Bash, stack up):
 *   docker compose run --rm -v "$(pwd -W):/work" -w /work platform sh -c \
 *     'ln -sf /app/node_modules node_modules; pnpm test:e2e tenancy; rm -f node_modules'
 */
import {
  MissingTenantContextError,
  TenantContext,
  TenantMismatchError,
  TenantScopedRepository,
} from '@pbl/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  Column,
  DataSource,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';

@Entity({ name: 'tenancy_item' })
class TenancyItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;
}

const schema = `tenancy_test_${randomBytes(4).toString('hex')}`;
const connection = {
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST ?? 'postgres',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USERNAME ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'pbl',
};

describe('TenantScopedRepository on Postgres (e2e)', () => {
  let admin: DataSource;
  let dataSource: DataSource;
  /** Unscoped access, only to seed and to check what really happened */
  let raw: Repository<TenancyItem>;
  let items: TenantScopedRepository<TenancyItem>;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let a1: TenancyItem;
  let a2: TenancyItem;
  let b1: TenancyItem;

  const inA = <T>(fn: () => Promise<T>) => TenantContext.run(tenantA, fn);
  const reloadB1 = () =>
    raw.findOne({ where: { id: b1.id }, withDeleted: true });

  beforeAll(async () => {
    admin = await new DataSource(connection).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    dataSource = await new DataSource({
      ...connection,
      schema,
      entities: [TenancyItem],
      synchronize: true,
    }).initialize();
    raw = dataSource.getRepository(TenancyItem);
    items = new TenantScopedRepository(raw);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.destroy();
  });

  beforeEach(async () => {
    await raw.clear();
    [a1, a2, b1] = await raw.save([
      raw.create({ tenantId: tenantA, name: 'a1' }),
      raw.create({ tenantId: tenantA, name: 'a2' }),
      raw.create({ tenantId: tenantB, name: 'b1' }),
    ]);
  });

  describe("inside tenant A's context", () => {
    it("find/findOne/findOneBy/count/exists/findAndCount see only A's rows", async () => {
      await inA(async () => {
        const all = await items.find({ order: { name: 'ASC' } });
        expect(all.map((item) => item.name)).toEqual(['a1', 'a2']);
        await expect(
          items.findOne({ where: { id: b1.id } }),
        ).resolves.toBeNull();
        await expect(items.findOneBy({ id: b1.id })).resolves.toBeNull();
        await expect(items.findOneBy({ id: a1.id })).resolves.toMatchObject({
          name: 'a1',
        });
        await expect(items.count()).resolves.toBe(2);
        await expect(items.count({ where: { name: 'b1' } })).resolves.toBe(0);
        await expect(items.exists({ where: { id: b1.id } })).resolves.toBe(
          false,
        );
        const [rows, total] = await items.findAndCount();
        expect(total).toBe(2);
        expect(rows).toHaveLength(2);
      });
    });

    it('an OR where cannot reach B through any branch', async () => {
      await inA(async () => {
        const found = await items.find({
          where: [{ id: b1.id }, { name: 'b1' }, { id: a2.id }],
        });
        expect(found.map((item) => item.id)).toEqual([a2.id]);
      });
    });

    it("update, softDelete and delete of B's row affect nothing", async () => {
      await inA(async () => {
        expect(
          (await items.update({ id: b1.id }, { name: 'hacked' })).affected,
        ).toBe(0);
        expect((await items.update(b1.id, { name: 'hacked' })).affected).toBe(
          0,
        );
        expect((await items.softDelete({ id: b1.id })).affected).toBe(0);
        expect((await items.softDelete([b1.id])).affected).toBe(0);
        expect((await items.delete(b1.id)).affected).toBe(0);
        expect((await items.delete({ name: 'b1' })).affected).toBe(0);
        // OR criteria: no branch reaches B's row
        expect(
          (await items.softDelete([{ id: b1.id }, { name: 'b1' }])).affected,
        ).toBe(0);
        expect(
          (await items.update([{ id: b1.id }, { name: 'b1' }], { name: 'x' }))
            .affected,
        ).toBe(0);
      });

      const b1Now = await reloadB1();
      expect(b1Now).toMatchObject({ name: 'b1', tenantId: tenantB });
      expect(b1Now?.deletedAt).toBeNull();
    });

    it("update and softDelete do affect A's own rows", async () => {
      await inA(async () => {
        expect((await items.update(a1.id, { name: 'a1x' })).affected).toBe(1);
        expect(
          (await items.update([{ id: b1.id }, { id: a1.id }], { name: 'a1y' }))
            .affected,
        ).toBe(1);
        expect((await items.softDelete({ id: a2.id })).affected).toBe(1);
        await expect(items.count()).resolves.toBe(1);
      });
      await expect(raw.findOneBy({ id: a1.id })).resolves.toMatchObject({
        name: 'a1y',
      });
    });

    it('save sets the tenant on a new row and refuses a foreign tenant or row', async () => {
      await inA(async () => {
        const created = await items.save({ name: 'new' });
        expect(created.tenantId).toBe(tenantA);

        await expect(
          items.save({ name: 'x', tenantId: tenantB }),
        ).rejects.toThrow(TenantMismatchError);
        // B's id with A's tenant would otherwise UPDATE B's row into tenant A
        await expect(items.save({ id: b1.id, name: 'hijack' })).rejects.toThrow(
          TenantMismatchError,
        );
      });

      await expect(raw.countBy({ tenantId: tenantA })).resolves.toBe(3);
      await expect(reloadB1()).resolves.toMatchObject({
        name: 'b1',
        tenantId: tenantB,
      });
    });

    it("a query builder only returns A's rows, whatever where/orWhere the caller adds", async () => {
      await inA(async () => {
        const names = async (
          build: (
            qb: ReturnType<typeof items.createQueryBuilder>,
          ) => ReturnType<typeof items.createQueryBuilder>,
        ) =>
          (await build(items.createQueryBuilder('item')).getMany())
            .map((item) => item.name)
            .sort();

        expect(await names((qb) => qb)).toEqual(['a1', 'a2']);
        // where() replaces earlier wheres; the tenant condition survives
        expect(await names((qb) => qb.where('1 = 1'))).toEqual(['a1', 'a2']);
        expect(
          await names((qb) =>
            qb.where('item.name = :n', { n: 'a1' }).orWhere('item.name = :m', {
              m: 'b1',
            }),
          ),
        ).toEqual(['a1']);
        // the same parameter name as a typical caller does not collide
        expect(
          await names((qb) =>
            qb.andWhere('item.tenantId = :tenantId', { tenantId: tenantB }),
          ),
        ).toEqual([]);
        const [, count] = await items
          .createQueryBuilder('item')
          .skip(0)
          .take(1)
          .getManyAndCount();
        expect(count).toBe(2);
      });
    });

    it('is scoped inside a transaction too (withManager)', async () => {
      await inA(() =>
        dataSource.transaction(async (em) => {
          const tx = items.withManager(em);
          await expect(tx.count()).resolves.toBe(2);
          await expect(tx.findOneBy({ id: b1.id })).resolves.toBeNull();
          expect((await tx.update({ id: b1.id }, { name: 'x' })).affected).toBe(
            0,
          );
          expect((await tx.softDelete({ id: b1.id })).affected).toBe(0);
          // refused before any write, so the transaction stays usable
          await expect(tx.save({ id: b1.id, name: 'x' })).rejects.toThrow(
            TenantMismatchError,
          );
          const created = await tx.save({ name: 'in-tx' });
          expect(created.tenantId).toBe(tenantA);
          expect(
            (await tx.createQueryBuilder('item').getMany()).map((i) => i.name),
          ).not.toContain('b1');
        }),
      );

      await expect(reloadB1()).resolves.toMatchObject({ name: 'b1' });
    });
  });

  describe('outside any tenant context', () => {
    it('every method throws and nothing is read or written', async () => {
      const calls: Array<() => unknown> = [
        () => items.find(),
        () => items.findOne({ where: { id: b1.id } }),
        () => items.findOneBy({ id: b1.id }),
        () => items.count(),
        () => items.exists(),
        () => items.findAndCount(),
        () => items.save({ name: 'x', tenantId: tenantA }),
        () => items.update({ id: b1.id }, { name: 'x' }),
        () => items.update(b1.id, { name: 'x' }),
        () => items.softDelete({ id: b1.id }),
        () => items.delete({ id: b1.id }),
        () => items.createQueryBuilder('item').getMany(),
      ];
      for (const call of calls) {
        await expect((async () => call())()).rejects.toThrow(
          MissingTenantContextError,
        );
        await expect(
          TenantContext.run(null, async () => call()),
        ).rejects.toThrow(MissingTenantContextError);
      }

      await expect(raw.count({ withDeleted: true })).resolves.toBe(3);
      await expect(raw.countBy({ name: 'x' })).resolves.toBe(0);
    });
  });
});
