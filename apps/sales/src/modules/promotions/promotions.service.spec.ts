import { TenantContext } from '@pbl/common';
import { SalesDomainErrorCode } from '../../domain/sales-domain';
import {
  CouponEntity,
  PromotionEntity,
} from '../../infrastructure/persistence/sales.entities';
import { PromotionsService } from './promotions.service';

const TA = '11111111-1111-4111-8111-111111111111';
const TB = '99999999-9999-4999-8999-999999999999';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const PROMO_ID = '66666666-6666-4666-8666-666666666666';
const COUPON_ID = '77777777-7777-4777-8777-777777777777';
const ALL = null;

const promo = (over: Partial<PromotionEntity> = {}): PromotionEntity =>
  ({
    id: PROMO_ID,
    tenantId: TA,
    code: 'P1',
    name: 'Promo',
    description: null,
    discountType: 'PERCENT',
    discountValue: 10,
    minOrderAmount: 0,
    maxDiscountAmount: null,
    branchId: null,
    startsAt: null,
    endsAt: null,
    channelTypes: [],
    customerGroupIds: [],
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as PromotionEntity;

const coupon = (over: Partial<CouponEntity> = {}): CouponEntity =>
  ({
    id: COUPON_ID,
    tenantId: TA,
    promotionId: PROMO_ID,
    code: 'SALE10',
    maxUses: null,
    maxUsesPerCustomer: null,
    usedCount: 0,
    status: 'ACTIVE',
    createdAt: new Date(),
    ...over,
  }) as CouponEntity;

/** An in-memory stand-in for the sales schema: just the queries the promotions service runs */
function fake(promotions: PromotionEntity[], coupons: CouponEntity[]) {
  const usages: { couponId: string; customerId: string | null }[] = [];
  const writes: string[] = [];
  const repoOf = (entity: unknown) => {
    const rows: Record<string, unknown>[] =
      entity === PromotionEntity
        ? (promotions as never)
        : entity === CouponEntity
          ? (coupons as never)
          : [];
    return {
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ??
        null,
      find: async () => rows,
    };
  };
  const em = {
    connection: { options: { schema: 'sales' } },
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('set_config')) return [];
      if (/^\s*SELECT id, promotion_id/.test(sql)) {
        const c = coupons.find(
          (x) => x.tenantId === params[0] && x.code === params[1],
        );
        return c
          ? [
              {
                id: c.id,
                promotion_id: c.promotionId,
                code: c.code,
                max_uses: c.maxUses,
                max_uses_per_customer: c.maxUsesPerCustomer,
                used_count: c.usedCount,
                status: c.status,
              },
            ]
          : [];
      }
      if (sql.includes('COUNT(*)')) {
        return [
          {
            cnt: String(
              usages.filter(
                (u) => u.couponId === params[1] && u.customerId === params[2],
              ).length,
            ),
          },
        ];
      }
      if (sql.includes('cu.coupon_id')) return [];
      if (/UPDATE|INSERT|DELETE/i.test(sql)) writes.push(sql);
      return [];
    }),
    getRepository: jest.fn(repoOf),
    create: (_e: unknown, v: unknown) => v,
    save: jest.fn(async (_e: unknown, v: unknown) => {
      writes.push('save');
      return v;
    }),
  };
  const dataSource = {
    options: { schema: 'sales' },
    transaction: jest.fn(async (work: (m: typeof em) => unknown) => work(em)),
  };
  return {
    service: new PromotionsService(dataSource as never),
    em,
    writes,
    usages,
  };
}

const inTenant = <T>(tenant: string, fn: () => Promise<T>) =>
  TenantContext.run(tenant, fn);

const evaluate = (
  svc: PromotionsService,
  over: Partial<Parameters<PromotionsService['evaluateCouponPreview']>[0]> = {},
  scope: Parameters<PromotionsService['evaluateCouponPreview']>[1] = ALL,
) =>
  inTenant(TA, () =>
    svc.evaluateCouponPreview(
      {
        code: 'sale10',
        orderAmount: 1_000_000,
        branchId: BRANCH,
        channelType: 'POS',
        ...over,
      },
      scope,
    ),
  );

describe('PromotionsService.evaluateCouponPreview', () => {
  it.each([
    ['PERCENT', 10, 1_000_000, null, 100_000],
    ['PERCENT', 12.5, 999, null, 125], // 124.875 rounds half up
    ['PERCENT', 12.5, 1_001, null, 125], // 125.125
    ['PERCENT', 0.5, 1_000, null, 5],
    ['PERCENT', 10, 1_000_000, 50_000, 50_000], // capped
    ['PERCENT', 100, 1_000_000, null, 1_000_000],
    ['FIXED', 30_000, 1_000_000, null, 30_000],
    ['FIXED', 30_000, 1_000_000, 20_000, 20_000], // capped
  ])(
    '%s %s on %s (cap %s) discounts %s',
    async (type, value, amount, cap, expected) => {
      const { service, writes } = fake(
        [
          promo({
            discountType: type,
            discountValue: value,
            maxDiscountAmount: cap,
          }),
        ],
        [coupon()],
      );
      const out = await evaluate(service, { orderAmount: amount });
      expect(out.discountAmountVnd).toBe(expected);
      expect(out.finalAmountVnd).toBe(amount - expected);
      expect(out.orderAmountVnd).toBe(amount);
      expect(out).toMatchObject({
        couponId: COUPON_ID,
        promotionId: PROMO_ID,
        promotionCode: 'P1',
        promotionName: 'Promo',
        couponCode: 'SALE10',
        discountType: type,
        discountValue: value,
        maxDiscountAmount: cap,
      });
      expect(writes).toEqual([]); // read-only
    },
  );

  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);
  it.each<
    [
      string,
      Partial<PromotionEntity>,
      Partial<CouponEntity> | null,
      object,
      string,
    ]
  >([
    [
      'unknown code',
      {},
      { code: 'OTHER' },
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'inactive coupon',
      {},
      { status: 'INACTIVE' },
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'inactive promotion',
      { status: 'INACTIVE' },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'not started',
      { startsAt: future },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    ['expired', { endsAt: past }, {}, {}, SalesDomainErrorCode.COUPON_INVALID],
    [
      'other branch',
      { branchId: OTHER_BRANCH },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'below min order',
      { minOrderAmount: 2_000_000 },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'wrong channel',
      { channelTypes: ['SHOPEE'] },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'no channel given',
      { channelTypes: ['POS'] },
      {},
      { channelType: undefined },
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'wrong group',
      { customerGroupIds: [GROUP] },
      {},
      {},
      SalesDomainErrorCode.COUPON_INVALID,
    ],
    [
      'usage limit reached',
      {},
      { maxUses: 5, usedCount: 5 },
      {},
      SalesDomainErrorCode.COUPON_USAGE_LIMIT_EXCEEDED,
    ],
  ])('rejects: %s', async (_name, p, c, extra, errorCode) => {
    const { service, writes } = fake([promo(p)], [coupon(c ?? {})]);
    await expect(evaluate(service, extra)).rejects.toMatchObject({
      code: errorCode,
      httpStatus: 409,
    });
    expect(writes).toEqual([]);
  });

  it('rejects a customer over the per-customer limit', async () => {
    const f = fake([promo()], [coupon({ maxUsesPerCustomer: 1 })]);
    f.usages.push({ couponId: COUPON_ID, customerId: CUSTOMER });
    await expect(
      evaluate(f.service, { customerId: CUSTOMER }),
    ).rejects.toMatchObject({
      code: SalesDomainErrorCode.COUPON_USAGE_LIMIT_EXCEEDED,
    });
    // another customer still qualifies
    await expect(
      evaluate(f.service, { customerId: OTHER_BRANCH }),
    ).resolves.toMatchObject({ discountAmountVnd: 100_000 });
  });

  it('accepts a matching channel, group and branch', async () => {
    const { service } = fake(
      [
        promo({
          channelTypes: ['POS', 'WEBSITE'],
          customerGroupIds: [GROUP],
          branchId: BRANCH,
        }),
      ],
      [coupon()],
    );
    await expect(
      evaluate(service, { customerGroupId: GROUP, channelType: 'pos' }),
    ).resolves.toMatchObject({ discountAmountVnd: 100_000 });
  });

  it('refuses a branch outside the caller scope (404 branch)', async () => {
    const { service } = fake([promo()], [coupon()]);
    await expect(evaluate(service, {}, [OTHER_BRANCH])).rejects.toBeDefined();
  });

  it("another tenant's coupon does not exist for the caller", async () => {
    const { service } = fake(
      [promo({ tenantId: TB })],
      [coupon({ tenantId: TB })],
    );
    await expect(evaluate(service)).rejects.toMatchObject({
      code: SalesDomainErrorCode.COUPON_INVALID,
    });
  });
});

describe('evaluate agrees with the checkout pricing', () => {
  it.each([
    ['PERCENT', 12.5, 999, null],
    ['PERCENT', 33.33, 1_234_567, 100_000],
    ['PERCENT', 10, 1_000_000, null],
    ['FIXED', 45_000, 500_000, 20_000],
    ['FIXED', 45_000, 500_000, null],
  ])('%s %s on %s (cap %s)', async (type, value, amount, cap) => {
    const f = fake(
      [
        promo({
          discountType: type,
          discountValue: value,
          maxDiscountAmount: cap,
        }),
      ],
      [coupon()],
    );
    const preview = await evaluate(f.service, { orderAmount: amount });
    // what the POS quote charges
    const quoted = await inTenant(TA, () =>
      f.service.previewCouponDiscount('SALE10', amount, BRANCH, null, {
        channelType: 'POS',
      }),
    );
    // what the checkout claims inside its transaction
    const redeemed = await inTenant(TA, () =>
      f.service.redeemCouponWithinTransaction(
        f.em as never,
        TA,
        'SALE10',
        amount,
        BRANCH,
        null,
        'order-1',
        { channelType: 'POS' },
      ),
    );
    expect(preview.discountAmountVnd).toBe(quoted.discountAmountVnd);
    expect(preview.discountAmountVnd).toBe(redeemed.discountAmountVnd);
  });
});

describe('PromotionsService.updatePromotion', () => {
  const update = (
    svc: PromotionsService,
    body: Parameters<PromotionsService['updatePromotion']>[1],
    tenant = TA,
    scope: Parameters<PromotionsService['updatePromotion']>[2] = ALL,
  ) => inTenant(tenant, () => svc.updatePromotion(PROMO_ID, body, scope));

  it('updates the given fields only and keeps the code', async () => {
    const { service } = fake([promo()], [coupon()]);
    const out = await update(service, {
      name: ' New name ',
      discountType: 'FIXED',
      discountValue: 20_000,
      maxDiscountAmount: null,
      channelTypes: ['pos', 'POS', 'shopee'],
      customerGroupIds: [GROUP],
      description: 'desc',
      status: 'INACTIVE',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-02-01T00:00:00Z',
    });
    expect(out).toMatchObject({
      code: 'P1',
      name: 'New name',
      discountType: 'FIXED',
      discountValue: 20_000,
      channelTypes: ['POS', 'SHOPEE'],
      customerGroupIds: [GROUP],
      description: 'desc',
      status: 'INACTIVE',
      minOrderAmount: 0,
    });
  });

  it.each([
    ['percent above 100', { discountValue: 101 }, 422],
    [
      'fractional fixed',
      { discountType: 'FIXED' as const, discountValue: 10.5 },
      422,
    ],
    [
      'end before start',
      { startsAt: '2026-03-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' },
      422,
    ],
    ['not a date', { startsAt: 'nope' }, 422],
  ])('422 on %s', async (_n, body, status) => {
    const { service, writes } = fake([promo()], [coupon()]);
    await expect(update(service, body)).rejects.toMatchObject({
      httpStatus: status,
    });
    expect(writes).toEqual([]);
  });

  it('validates against the stored values (switching to FIXED keeps a percent-sized value legal)', async () => {
    const { service } = fake([promo({ discountValue: 50 })], [coupon()]);
    await expect(
      update(service, { discountType: 'FIXED' }),
    ).resolves.toMatchObject({ discountType: 'FIXED', discountValue: 50 });
  });

  it("404 for another tenant's promotion, and nothing is written", async () => {
    const { service, writes } = fake([promo()], [coupon()]);
    await expect(update(service, { name: 'x' }, TB)).rejects.toMatchObject({
      httpStatus: 404,
    });
    expect(writes).toEqual([]);
  });

  it('404 for a promotion of a branch outside the caller scope', async () => {
    const { service } = fake([promo({ branchId: BRANCH })], [coupon()]);
    await expect(
      update(service, { name: 'x' }, TA, [OTHER_BRANCH]),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('PromotionsService.updateCoupon', () => {
  const update = (
    svc: PromotionsService,
    body: Parameters<PromotionsService['updateCoupon']>[1],
    tenant = TA,
  ) => inTenant(tenant, () => svc.updateCoupon(COUPON_ID, body, ALL));

  it('changes limits and status, never the code', async () => {
    const { service } = fake([promo()], [coupon({ usedCount: 3 })]);
    const out = await update(service, {
      maxUses: 3,
      maxUsesPerCustomer: 2,
      status: 'INACTIVE',
    });
    expect(out).toMatchObject({
      code: 'SALE10',
      maxUses: 3,
      maxUsesPerCustomer: 2,
      status: 'INACTIVE',
    });
    await expect(update(service, { maxUses: null })).resolves.toMatchObject({
      maxUses: null,
    });
  });

  it('refuses a limit below the used count with a coded 409', async () => {
    const { service, writes } = fake([promo()], [coupon({ usedCount: 5 })]);
    await expect(update(service, { maxUses: 4 })).rejects.toMatchObject({
      code: SalesDomainErrorCode.COUPON_MAX_USES_BELOW_USED,
      httpStatus: 409,
    });
    expect(writes).toEqual([]);
  });

  it("404 for another tenant's coupon", async () => {
    const { service, writes } = fake([promo()], [coupon()]);
    await expect(
      update(service, { status: 'INACTIVE' }, TB),
    ).rejects.toMatchObject({
      code: SalesDomainErrorCode.COUPON_NOT_FOUND,
      httpStatus: 404,
    });
    expect(writes).toEqual([]);
  });
});
