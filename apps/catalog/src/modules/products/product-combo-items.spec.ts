import { HttpException } from '@nestjs/common';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import { DataSource } from 'typeorm';
import {
  ComboItemEntity,
  ProductEntity,
  ProductVariantEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { ProductComboItemsService } from './product-combo-items';

/**
 * ProductComboItemsService against an in-memory store whose repositories behave like TenantScopedRepository: every
 * read and write is limited to the tenant of the context. That is what the cross-tenant cases rely on; the real
 * thing (SQL, RLS, the composite foreign keys) is covered by apps/catalog/test/combo-items.int-spec.ts.
 */

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = Record<string, unknown> & { id: string; tenantId: string };
type Operator = { _type: string; _value: unknown };

const matches = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && '_type' in expected) {
      const op = expected as Operator;
      if (op._type === 'isNull') return actual === null || actual === undefined;
      if (op._type === 'in') return (op._value as unknown[]).includes(actual);
      throw new Error(`operator ${op._type} not supported by the fake`);
    }
    return actual === expected;
  });

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

class Store {
  tables = new Map<unknown, Row[]>();

  rows(entity: unknown): Row[] {
    if (!this.tables.has(entity)) this.tables.set(entity, []);
    return this.tables.get(entity) as Row[];
  }

  repo(entity: unknown) {
    const tenant = () => TenantContext.require();
    const scoped = (where: Record<string, unknown> = {}) =>
      this.rows(entity).filter(
        (r) => r.tenantId === tenant() && matches(r, where),
      );
    return {
      find: async (opts: { where?: Record<string, unknown> } = {}) =>
        scoped(opts.where),
      findOne: async (opts: { where?: Record<string, unknown> } = {}) =>
        scoped(opts.where)[0] ?? null,
      delete: async (where: Record<string, unknown>) => {
        const doomed = new Set(scoped(where));
        this.tables.set(
          entity,
          this.rows(entity).filter((r) => !doomed.has(r)),
        );
      },
      save: async (input: Partial<Row> | Partial<Row>[]) => {
        const out = (Array.isArray(input) ? input : [input]).map((i) => {
          const row = { id: uuid(), ...i, tenantId: tenant() } as Row;
          this.rows(entity).push(row);
          return row;
        });
        return Array.isArray(input) ? out : out[0];
      },
    };
  }

  add(entity: unknown, tenantId: string, data: Record<string, unknown>): Row {
    const row = { id: uuid(), tenantId, ...data } as Row;
    this.rows(entity).push(row);
    return row;
  }
}

describe('ProductComboItemsService', () => {
  let store: Store;
  let service: ProductComboItemsService;

  const dataSource = {
    transaction: async (work: (em: unknown) => unknown) =>
      work({ query: async () => undefined }),
  } as unknown as DataSource;

  /** a simple product with one default variant, in `tenant` */
  const simple = (tenant: string, sku: string, price = 100_000) => {
    const product = store.add(ProductEntity, tenant, {
      name: sku,
      isCombo: false,
      deletedAt: null,
    });
    const variant = store.add(ProductVariantEntity, tenant, {
      productId: product.id,
      skuCode: sku,
      name: `Name ${sku}`,
      basePrice: price,
      imageUrl: null,
      isDefault: true,
      status: 'ACTIVE',
      deletedAt: null,
    });
    return { product, variant };
  };
  const combo = (tenant: string, sku: string, withVariant = true) => {
    const product = store.add(ProductEntity, tenant, {
      name: sku,
      isCombo: true,
      deletedAt: null,
    });
    const variant = withVariant
      ? store.add(ProductVariantEntity, tenant, {
          productId: product.id,
          skuCode: sku,
          name: sku,
          basePrice: 250_000,
          imageUrl: null,
          isDefault: true,
          status: 'ACTIVE',
          deletedAt: null,
        })
      : null;
    return { product, variant };
  };

  const as = <T>(tenant: string, fn: () => Promise<T>) =>
    TenantContext.run(tenant, fn);
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const ex = e as HttpException;
      const body = ex.getResponse() as { errorCode: string };
      return { status: ex.getStatus(), code: body.errorCode };
    }
    throw new Error('expected the call to fail');
  };

  beforeEach(() => {
    store = new Store();
    service = new ProductComboItemsService(dataSource);
    jest
      .spyOn(TenantScopedRepository, 'forEntity')
      .mockImplementation(((_em: unknown, entity: unknown) =>
        store.repo(entity)) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('PUT replaces the list', () => {
    it('stores the components in request order and returns what the web needs', async () => {
      const mug = simple(TENANT_A, 'MUG', 260_000);
      const candle = simple(TENANT_A, 'CANDLE', 320_000);
      const c = combo(TENANT_A, 'SET');

      const res = await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: candle.variant.id, quantity: 2 },
          { childVariantId: mug.variant.id, quantity: 1 },
        ]),
      );

      expect(res).toEqual([
        {
          id: expect.any(String),
          comboProductId: c.product.id,
          childVariantId: candle.variant.id,
          childProductId: candle.product.id,
          skuCode: 'CANDLE',
          variantName: 'Name CANDLE',
          basePrice: 320_000,
          imageUrl: null,
          quantity: 2,
          lineTotal: 640_000,
          sortOrder: 0,
        },
        expect.objectContaining({
          childVariantId: mug.variant.id,
          quantity: 1,
          lineTotal: 260_000,
          sortOrder: 1,
        }),
      ]);
      expect(store.rows(ComboItemEntity)).toHaveLength(2);
      // the price of the combo stays on its own variant
      expect((c.variant as Row).basePrice).toBe(250_000);
      expect(await as(TENANT_A, () => service.list(c.product.id))).toEqual(res);
    });

    it('replaces the whole list: components left out disappear, new ones appear', async () => {
      const a = simple(TENANT_A, 'A');
      const b = simple(TENANT_A, 'B');
      const d = simple(TENANT_A, 'D');
      const c = combo(TENANT_A, 'SET');
      await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: a.variant.id, quantity: 1 },
          { childVariantId: b.variant.id, quantity: 1 },
        ]),
      );

      const res = await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: d.variant.id, quantity: 3 },
          { childVariantId: a.variant.id, quantity: 5 },
        ]),
      );

      expect(res.map((r) => [r.skuCode, r.quantity])).toEqual([
        ['D', 3],
        ['A', 5],
      ]);
      expect(store.rows(ComboItemEntity)).toHaveLength(2);
    });

    it('is idempotent: the same request twice leaves the same list', async () => {
      const a = simple(TENANT_A, 'A');
      const c = combo(TENANT_A, 'SET');
      const body = [{ childVariantId: a.variant.id, quantity: 2 }];
      const first = await as(TENANT_A, () =>
        service.replace(c.product.id, body),
      );
      const second = await as(TENANT_A, () =>
        service.replace(c.product.id, body),
      );
      const strip = (l: typeof first) => l.map(({ id: _id, ...r }) => r);
      expect(strip(second)).toEqual(strip(first));
      expect(store.rows(ComboItemEntity)).toHaveLength(1);
    });

    it('leaves the previous list untouched when the new one is refused', async () => {
      const a = simple(TENANT_A, 'A');
      const c = combo(TENANT_A, 'SET');
      await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: a.variant.id, quantity: 1 },
        ]),
      );
      await codeOf(
        as(TENANT_A, () =>
          service.replace(c.product.id, [
            { childVariantId: a.variant.id, quantity: 0 },
          ]),
        ),
      );
      expect(store.rows(ComboItemEntity)).toHaveLength(1);
      expect(store.rows(ComboItemEntity)[0].quantity).toBe(1);
    });
  });

  describe('PUT validation', () => {
    it('refuses a product that is not a combo (422 PRODUCT_NOT_COMBO)', async () => {
      const a = simple(TENANT_A, 'A');
      const b = simple(TENANT_A, 'B');
      expect(
        await codeOf(
          as(TENANT_A, () =>
            service.replace(a.product.id, [
              { childVariantId: b.variant.id, quantity: 1 },
            ]),
          ),
        ),
      ).toEqual({ status: 422, code: 'PRODUCT_NOT_COMBO' });
    });

    it('refuses an empty list', async () => {
      const c = combo(TENANT_A, 'SET');
      expect(
        (await codeOf(as(TENANT_A, () => service.replace(c.product.id, []))))
          .status,
      ).toBe(422);
    });

    it.each([0, -1, 1.5, Number.NaN, 10_001])(
      'refuses quantity %p',
      async (quantity) => {
        const a = simple(TENANT_A, 'A');
        const c = combo(TENANT_A, 'SET');
        expect(
          (
            await codeOf(
              as(TENANT_A, () =>
                service.replace(c.product.id, [
                  { childVariantId: a.variant.id, quantity },
                ]),
              ),
            )
          ).status,
        ).toBe(422);
        expect(store.rows(ComboItemEntity)).toHaveLength(0);
      },
    );

    it('refuses the same variant twice (422 COMBO_DUPLICATE_ITEM)', async () => {
      const a = simple(TENANT_A, 'A');
      const c = combo(TENANT_A, 'SET');
      expect(
        await codeOf(
          as(TENANT_A, () =>
            service.replace(c.product.id, [
              { childVariantId: a.variant.id, quantity: 1 },
              { childVariantId: a.variant.id, quantity: 2 },
            ]),
          ),
        ),
      ).toEqual({ status: 422, code: 'COMBO_DUPLICATE_ITEM' });
    });

    it('refuses a combo that contains itself (422 COMBO_SELF_REFERENCE)', async () => {
      const c = combo(TENANT_A, 'SET');
      expect(
        await codeOf(
          as(TENANT_A, () =>
            service.replace(c.product.id, [
              { childVariantId: (c.variant as Row).id, quantity: 1 },
            ]),
          ),
        ),
      ).toEqual({ status: 422, code: 'COMBO_SELF_REFERENCE' });
    });

    it('refuses another combo as a component (422 COMBO_NESTING_NOT_ALLOWED)', async () => {
      const inner = combo(TENANT_A, 'INNER');
      const outer = combo(TENANT_A, 'OUTER');
      expect(
        await codeOf(
          as(TENANT_A, () =>
            service.replace(outer.product.id, [
              { childVariantId: (inner.variant as Row).id, quantity: 1 },
            ]),
          ),
        ),
      ).toEqual({ status: 422, code: 'COMBO_NESTING_NOT_ALLOWED' });
    });

    it('refuses a combo without a variant (422 COMBO_VARIANT_REQUIRED)', async () => {
      const a = simple(TENANT_A, 'A');
      const c = combo(TENANT_A, 'SET', false);
      expect(
        await codeOf(
          as(TENANT_A, () =>
            service.replace(c.product.id, [
              { childVariantId: a.variant.id, quantity: 1 },
            ]),
          ),
        ),
      ).toEqual({ status: 422, code: 'COMBO_VARIANT_REQUIRED' });
    });

    it('404s a variant that does not exist, is deleted or is archived', async () => {
      const gone = simple(TENANT_A, 'GONE');
      (gone.variant as Row).deletedAt = new Date();
      const archived = simple(TENANT_A, 'ARCH');
      (archived.variant as Row).status = 'ARCHIVED';
      const c = combo(TENANT_A, 'SET');
      for (const id of [gone.variant.id, archived.variant.id, uuid()]) {
        expect(
          await codeOf(
            as(TENANT_A, () =>
              service.replace(c.product.id, [
                { childVariantId: id, quantity: 1 },
              ]),
            ),
          ),
        ).toEqual({ status: 404, code: 'VARIANT_NOT_FOUND' });
      }
    });

    it('404s a variant whose product was deleted', async () => {
      const a = simple(TENANT_A, 'A');
      (a.product as Row).deletedAt = new Date();
      const c = combo(TENANT_A, 'SET');
      expect(
        (
          await codeOf(
            as(TENANT_A, () =>
              service.replace(c.product.id, [
                { childVariantId: a.variant.id, quantity: 1 },
              ]),
            ),
          )
        ).status,
      ).toBe(404);
    });

    it('404s an unknown or deleted product', async () => {
      const a = simple(TENANT_A, 'A');
      const item = [{ childVariantId: a.variant.id, quantity: 1 }];
      expect(
        await codeOf(as(TENANT_A, () => service.replace(uuid(), item))),
      ).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
      const c = combo(TENANT_A, 'SET');
      (c.product as Row).deletedAt = new Date();
      expect(
        (await codeOf(as(TENANT_A, () => service.replace(c.product.id, item))))
          .status,
      ).toBe(404);
    });
  });

  describe('GET', () => {
    it('is empty for a combo without components and for a product that is not a combo', async () => {
      const c = combo(TENANT_A, 'SET');
      const a = simple(TENANT_A, 'A');
      expect(await as(TENANT_A, () => service.list(c.product.id))).toEqual([]);
      expect(await as(TENANT_A, () => service.list(a.product.id))).toEqual([]);
    });

    it('404s a product that is not in the tenant', async () => {
      expect(await codeOf(as(TENANT_A, () => service.list(uuid())))).toEqual({
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
    });

    it('hides a component whose variant was deleted afterwards', async () => {
      const a = simple(TENANT_A, 'A');
      const b = simple(TENANT_A, 'B');
      const c = combo(TENANT_A, 'SET');
      await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: a.variant.id, quantity: 1 },
          { childVariantId: b.variant.id, quantity: 1 },
        ]),
      );
      (b.variant as Row).deletedAt = new Date();
      expect(
        (await as(TENANT_A, () => service.list(c.product.id))).map(
          (r) => r.skuCode,
        ),
      ).toEqual(['A']);
    });
  });

  describe('tenant isolation', () => {
    it("tenant B cannot read tenant A's combo (404, nothing leaks)", async () => {
      const a = simple(TENANT_A, 'A');
      const c = combo(TENANT_A, 'SET');
      await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: a.variant.id, quantity: 1 },
        ]),
      );
      expect(
        await codeOf(as(TENANT_B, () => service.list(c.product.id))),
      ).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    });

    it("tenant B cannot change tenant A's combo, which stays as it was", async () => {
      const a = simple(TENANT_A, 'A');
      const mine = simple(TENANT_B, 'MINE');
      const c = combo(TENANT_A, 'SET');
      await as(TENANT_A, () =>
        service.replace(c.product.id, [
          { childVariantId: a.variant.id, quantity: 1 },
        ]),
      );
      expect(
        await codeOf(
          as(TENANT_B, () =>
            service.replace(c.product.id, [
              { childVariantId: mine.variant.id, quantity: 9 },
            ]),
          ),
        ),
      ).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
      const list = await as(TENANT_A, () => service.list(c.product.id));
      expect(list.map((r) => [r.skuCode, r.quantity])).toEqual([['A', 1]]);
    });

    it("a variant of tenant A cannot be added to tenant B's combo", async () => {
      const theirs = simple(TENANT_A, 'THEIRS');
      const c = combo(TENANT_B, 'SETB');
      expect(
        await codeOf(
          as(TENANT_B, () =>
            service.replace(c.product.id, [
              { childVariantId: theirs.variant.id, quantity: 1 },
            ]),
          ),
        ),
      ).toEqual({ status: 404, code: 'VARIANT_NOT_FOUND' });
      expect(store.rows(ComboItemEntity)).toHaveLength(0);
    });

    it('needs a tenant in the context', async () => {
      const c = combo(TENANT_A, 'SET');
      await expect(service.list(c.product.id)).rejects.toThrow(
        'No tenant in the current context',
      );
    });
  });
});
