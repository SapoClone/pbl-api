/**
 * Customer against a real Postgres: the migration, codes, phone uniqueness, groups seeded
 * lazily, addresses, loyalty and the order-completed consumer, tenant isolation, and the
 * database's own constraints. Run with `pnpm test:int`.
 */
import { RequestContext } from '@pbl/common';
import { OrderCompletedPayload } from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { CustomersService } from '../src/customers/customers.service';
import { CUSTOMER_APP_ENTITIES } from '../src/entities/customer.entities';
import { GroupsService } from '../src/groups/groups.service';
import { TagsService } from '../src/groups/tags.service';
import { LoyaltyService } from '../src/loyalty/loyalty.service';
import { CreateCustomerTables1792000000000 } from '../src/migrations/1792000000000-create-customer-tables';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const address = (over: Record<string, unknown> = {}) => ({
  recipientName: 'Ha',
  recipientPhone: '0901234528',
  addressLine: '24 Hoa Mai',
  ward: 'Cau Kieu',
  district: 'Phu Nhuan',
  province: 'HCM',
  ...over,
});

const listQuery = (over: Record<string, unknown> = {}) =>
  ({ page: 1, limit: 10, sort: 'createdAt', order: 'DESC', ...over }) as never;

describe('customer (Postgres)', () => {
  const schema = uniqueSchema('customer_it');
  let ds: DataSource;
  let customers: CustomersService;
  let groups: GroupsService;
  let tags: TagsService;
  let loyalty: LoyaltyService;

  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    RequestContext.run({ tenantId, requestId: 'it' }, work);
  const table = (name: string) => `"${schema}"."${name}"`;
  const create = (tenantId: string, body: Record<string, unknown>) =>
    as(tenantId, () =>
      customers.create(
        { name: 'Nguyen Ngoc Ha', phone: '0901234528', ...body } as never,
        true,
      ),
    );
  const completed = (
    customerId: string | null | undefined,
    totalAmount: number,
    orderId = randomUUID(),
  ) =>
    ({
      orderId,
      code: 'DH000001',
      branchId: randomUUID(),
      totalAmount,
      itemCount: 1,
      paymentMethod: 'cash',
      createdBy: randomUUID(),
      completedAt: '2026-10-20T07:20:00.000Z',
      items: [],
      customerId,
    }) as OrderCompletedPayload;
  const consume = (tenantId: string, payload: OrderCompletedPayload) =>
    as(tenantId, () =>
      ds.transaction((em) => loyalty.onOrderCompleted(em, tenantId, payload)),
    );

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase(
      databaseOptions({
        entities: [...CUSTOMER_APP_ENTITIES, ...CONSUMER_ENTITIES],
        migrations: [...CONSUMER_MIGRATIONS, CreateCustomerTables1792000000000],
      }),
    );
    customers = new CustomersService(ds);
    groups = new GroupsService(ds);
    tags = new TagsService(ds);
    loyalty = new LoyaltyService(ds);
  });

  afterAll(async () => {
    await ds.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await ds.destroy();
  });

  beforeEach(async () => {
    for (const name of [
      'loyalty_transaction',
      'loyalty_setting',
      'customer_address',
      'customer_tag_link',
      'customer_tag',
      'customer',
      'customer_group',
      'code_sequence',
    ]) {
      await ds.query(`DELETE FROM ${table(name)}`);
    }
  });

  it('migrates down and up again', async () => {
    await ds.undoLastMigration();
    expect(
      await ds.query(`SELECT to_regclass('${table('customer')}') AS t`),
    ).toEqual([{ t: null }]);
    await ds.runMigrations();
    expect(
      (await ds.query(`SELECT to_regclass('${table('customer')}') AS t`))[0].t,
    ).not.toBeNull();
  });

  describe('groups', () => {
    it('seeds the four defaults on first access, once, per tenant', async () => {
      const first = await as(TENANT_A, () => groups.list());
      expect(first.data.map((g) => [g.code, g.name, g.isSeeded])).toEqual([
        ['retail', 'Khách lẻ', true],
        ['member', 'Thành viên', true],
        ['vip', 'VIP', true],
        ['wholesale', 'Sỉ', true],
      ]);
      await as(TENANT_A, () => groups.list());
      await Promise.all([
        as(TENANT_B, () => groups.list()),
        as(TENANT_B, () => groups.list()),
      ]);
      const rows = await ds.query(
        `SELECT "tenant_id", count(*)::int AS n FROM ${table('customer_group')} GROUP BY 1`,
      );
      expect(rows.map((r: { n: number }) => r.n)).toEqual([4, 4]);
    });

    it('creates and renames a custom group; names are unique per tenant', async () => {
      const created = await as(TENANT_A, () => groups.create('Khách quen'));
      expect(created).toMatchObject({ code: 'khach-quen', isSeeded: false });
      const renamed = await as(TENANT_A, () =>
        groups.rename(created.id, 'Quen lắm'),
      );
      expect(renamed.name).toBe('Quen lắm');
      await expect(
        as(TENANT_A, () => groups.create('vip')),
      ).rejects.toMatchObject({ response: { errorCode: 'U007' } });
      // another store may use the name, and cannot touch this group
      await as(TENANT_B, () => groups.create('Quen lắm'));
      await expect(
        as(TENANT_B, () => groups.rename(created.id, 'x')),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('customers', () => {
    it('numbers customers per tenant and puts them in the retail group', async () => {
      const a1 = await create(TENANT_A, {});
      const a2 = await create(TENANT_A, { phone: '0901111111' });
      const b1 = await create(TENANT_B, {});
      expect([a1.code, a2.code, b1.code]).toEqual([
        'KH000001',
        'KH000002',
        'KH000001',
      ]);
      expect(a1.group).toMatchObject({ code: 'retail' });
      expect(a1.phoneMasked).toBe('090 ••• •• 28');
      expect(a1).toMatchObject({
        memberCode: null,
        orderCount: 0,
        loyaltyPoints: 0,
      });
    });

    it('refuses a phone already used by a live customer (U001) and allows it after a delete', async () => {
      const first = await create(TENANT_A, {});
      await expect(create(TENANT_A, {})).rejects.toMatchObject({
        status: 409,
        response: {
          errorCode: 'U001',
          details: [{ existingCustomerId: first.id }],
        },
      });
      // another store is a different phone book
      await create(TENANT_B, {});
      await as(TENANT_A, () => customers.remove(first.id));
      await expect(
        as(TENANT_A, () => customers.get(first.id, true)),
      ).rejects.toMatchObject({ status: 404 });
      const again = await create(TENANT_A, {});
      expect(again.id).not.toBe(first.id);
      // the same phone on update is U001 too
      const other = await create(TENANT_A, { phone: '0902222222' });
      await expect(
        as(TENANT_A, () =>
          customers.update(other.id, { phone: '0901234528' } as never, true),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'U001' },
      });
    });

    it('two simultaneous creates with one phone: one wins, one gets U001', async () => {
      const results = await Promise.allSettled([
        create(TENANT_A, {}),
        create(TENANT_A, {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason.response.errorCode).toBe('U001');
    });

    it('creates with addresses, tags, a member card and initial points', async () => {
      const tag = await as(TENANT_A, () => tags.create('Mua nhiều'));
      const vip = (await as(TENANT_A, () => groups.list())).data.find(
        (g) => g.code === 'vip',
      )!;
      const c = await create(TENANT_A, {
        groupId: vip.id,
        tagIds: [tag.id],
        addresses: [address(), address({ addressLine: 'Other' })],
        loyalty: { enabled: true, initialPoints: 50 },
        email: 'n.ha@example.com',
        dob: '1995-04-12',
        gender: 'female',
        source: 'shopee',
      });
      expect(c.memberCode).toBe('TV000001');
      expect(c.loyaltyPoints).toBe(50);
      expect(c.group).toMatchObject({ code: 'vip' });
      expect(c.tags).toEqual([{ id: tag.id, name: 'Mua nhiều' }]);
      expect(c.addresses.map((a) => a.isDefault)).toEqual([true, false]);
      expect(c).toMatchObject({
        dob: '1995-04-12',
        gender: 'female',
        source: 'shopee',
      });
      const history = await as(TENANT_A, () =>
        loyalty.listTransactions(c.id, { page: 1, limit: 10 }),
      );
      expect(history.data).toMatchObject([
        { type: 'adjust', points: 50, balanceAfter: 50 },
      ]);
      // the next card gets the next number
      const d = await create(TENANT_A, {
        phone: '0903333333',
        loyalty: { enabled: true },
      });
      expect(d.memberCode).toBe('TV000002');
    });

    it("rejects another store's group or tag (U006) and two default addresses (U002)", async () => {
      const otherGroup = (await as(TENANT_B, () => groups.list())).data[0];
      await expect(
        create(TENANT_A, { groupId: otherGroup.id }),
      ).rejects.toMatchObject({
        response: { errorCode: 'U006' },
      });
      const otherTag = await as(TENANT_B, () => tags.create('x'));
      await expect(
        create(TENANT_A, { tagIds: [otherTag.id] }),
      ).rejects.toMatchObject({
        response: { errorCode: 'U006' },
      });
      await expect(
        create(TENANT_A, {
          addresses: [
            address({ isDefault: true }),
            address({ isDefault: true }),
          ],
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'U002' } });
      // nothing was left behind by the failures, not even a code
      expect(await create(TENANT_A, {})).toMatchObject({ code: 'KH000001' });
    });

    it('updates fields, replaces tags, clears optional fields and gives a card on request', async () => {
      const t1 = await as(TENANT_A, () => tags.create('A'));
      const t2 = await as(TENANT_A, () => tags.create('B'));
      const c = await create(TENANT_A, {
        tagIds: [t1.id],
        email: 'a@b.co',
        note: 'n',
      });
      const updated = await as(TENANT_A, () =>
        customers.update(
          c.id,
          {
            name: 'New',
            email: null,
            tagIds: [t2.id],
            status: 'inactive',
            loyalty: { enabled: true },
          } as never,
          true,
        ),
      );
      expect(updated).toMatchObject({
        name: 'New',
        email: null,
        note: 'n',
        status: 'inactive',
        memberCode: 'TV000001',
      });
      expect(updated.tags.map((t) => t.name)).toEqual(['B']);
      const again = await as(TENANT_A, () =>
        customers.update(c.id, { loyalty: { enabled: true } } as never, true),
      );
      expect(again.memberCode).toBe('TV000001');
    });

    it("cannot read, change or delete another store's customer", async () => {
      const c = await create(TENANT_A, {});
      await expect(
        as(TENANT_B, () => customers.get(c.id, true)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(TENANT_B, () =>
          customers.update(c.id, { name: 'x' } as never, true),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(TENANT_B, () => customers.remove(c.id)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(TENANT_B, () =>
          customers.addAddress(c.id, address() as never, true),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(TENANT_B, () => loyalty.adjust(c.id, { points: 5, reason: 'x' })),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        as(TENANT_B, () =>
          loyalty.listTransactions(c.id, { page: 1, limit: 5 }),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await as(TENANT_B, () => customers.list(listQuery(), true))).data,
      ).toEqual([]);
    });

    it('keeps one default address across add, change, delete', async () => {
      const c = await create(TENANT_A, {});
      const one = await as(TENANT_A, () =>
        customers.addAddress(
          c.id,
          address({ addressLine: 'one' }) as never,
          true,
        ),
      );
      expect(one.addresses.map((a) => [a.addressLine, a.isDefault])).toEqual([
        ['one', true],
      ]);
      const two = await as(TENANT_A, () =>
        customers.addAddress(
          c.id,
          address({ addressLine: 'two', isDefault: true }) as never,
          true,
        ),
      );
      expect(two.addresses.map((a) => [a.addressLine, a.isDefault])).toEqual([
        ['two', true],
        ['one', false],
      ]);
      const oneId = two.addresses.find((a) => a.addressLine === 'one')!.id;
      const twoId = two.addresses.find((a) => a.addressLine === 'two')!.id;
      const flipped = await as(TENANT_A, () =>
        customers.updateAddress(
          c.id,
          oneId,
          { isDefault: true, ward: 'W' } as never,
          true,
        ),
      );
      expect(flipped.addresses.find((a) => a.id === oneId)).toMatchObject({
        isDefault: true,
        ward: 'W',
      });
      expect(flipped.addresses.filter((a) => a.isDefault)).toHaveLength(1);
      await expect(
        as(TENANT_A, () =>
          customers.updateAddress(
            c.id,
            oneId,
            { isDefault: false } as never,
            true,
          ),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'U002' } });
      // deleting the default hands it to the remaining one
      await as(TENANT_A, () => customers.removeAddress(c.id, oneId));
      const after = await as(TENANT_A, () => customers.get(c.id, true));
      expect(after.addresses).toMatchObject([{ id: twoId, isDefault: true }]);
      await expect(
        as(TENANT_A, () => customers.removeAddress(c.id, oneId)),
      ).rejects.toMatchObject({ status: 404 });
      // the database allows one default per customer
      await expect(
        ds.query(
          `INSERT INTO ${table('customer_address')} (id, tenant_id, customer_id, recipient_name, phone, address_line, ward, district, province, is_default)
           VALUES ($1, $2, $3, 'x', '1', 'x', 'x', 'x', 'x', true)`,
          [randomUUID(), TENANT_A, c.id],
        ),
      ).rejects.toMatchObject({ constraint: 'UQ_customer_address_default' });
    });
  });

  describe('list, summary and export', () => {
    beforeEach(async () => {
      const vip = (await as(TENANT_A, () => groups.list())).data.find(
        (g) => g.code === 'vip',
      )!;
      const tag = await as(TENANT_A, () => tags.create('Quà tặng'));
      await create(TENANT_A, {
        name: 'An',
        phone: '0900000001',
        email: 'an@x.vn',
      });
      await create(TENANT_A, {
        name: 'Binh',
        phone: '0900000002',
        groupId: vip.id,
        tagIds: [tag.id],
      });
      await create(TENANT_A, {
        name: '=cmd, "x"',
        phone: '0900000003',
        loyalty: { enabled: true },
      });
      await create(TENANT_B, { name: 'Other store', phone: '0900000001' });
    });

    it('searches name, phone, email and code; filters group and tag; pages', async () => {
      const names = async (q: Record<string, unknown>) =>
        (
          await as(TENANT_A, () =>
            customers.list(
              listQuery({ sort: 'name', order: 'ASC', ...q }),
              true,
            ),
          )
        ).data.map((c) => c.name);
      expect(await names({ q: 'bin' })).toEqual(['Binh']);
      expect(await names({ q: '0900000001' })).toEqual(['An']);
      expect(await names({ q: 'an@x' })).toEqual(['An']);
      expect(await names({ q: 'KH000003' })).toEqual(['=cmd, "x"']);
      expect(await names({ q: 'TV000001' })).toEqual(['=cmd, "x"']);
      expect(await names({ q: '%' })).toEqual([]);
      expect(await names({ groupCode: ['vip'] })).toEqual(['Binh']);
      expect(await names({ groupCode: ['vip', 'retail'] })).toHaveLength(3);
      const tag = (await as(TENANT_A, () => tags.list())).data[0];
      expect(await names({ tagId: tag.id })).toEqual(['Binh']);
      const page = await as(TENANT_A, () =>
        customers.list(listQuery({ limit: 2, page: 2 }), true),
      );
      expect(page.pagination).toEqual({
        limit: 2,
        currentPage: 2,
        totalRecords: 3,
        totalPages: 2,
      });
      expect(page.data).toHaveLength(1);
    });

    it('sorts by spend, order count and last purchase (nulls last) and masks phones', async () => {
      const [an, binh] = (
        await as(TENANT_A, () =>
          customers.list(listQuery({ sort: 'name', order: 'ASC' }), true),
        )
      ).data;
      await consume(TENANT_A, completed(an.id, 100_000));
      await consume(TENANT_A, completed(binh.id, 300_000));
      await consume(TENANT_A, completed(binh.id, 50_000));
      const by = async (sort: string, order: string, extra = {}) =>
        (
          await as(TENANT_A, () =>
            customers.list(listQuery({ sort, order, ...extra }), false),
          )
        ).data;
      expect((await by('totalSpent', 'DESC')).map((c) => c.name)).toEqual([
        'Binh',
        'An',
        '=cmd, "x"',
      ]);
      expect((await by('orderCount', 'DESC'))[0]).toMatchObject({
        name: 'Binh',
        orderCount: 2,
        totalSpent: 350_000,
      });
      // never-purchased customers sort last in both directions
      expect((await by('lastPurchaseAt', 'ASC')).at(-1)!.name).toBe(
        '=cmd, "x"',
      );
      expect((await by('lastPurchaseAt', 'DESC')).at(-1)!.name).toBe(
        '=cmd, "x"',
      );
      expect(
        (await by('totalSpent', 'DESC', { spendMin: 200_000 })).map(
          (c) => c.name,
        ),
      ).toEqual(['Binh']);
      expect(
        (await by('totalSpent', 'DESC', { spendMax: 100_000 }))
          .map((c) => c.name)
          .sort(),
      ).toEqual(['=cmd, "x"', 'An']);
      const masked = (await by('name', 'ASC'))[0];
      expect(masked.phone).toBeNull();
      expect(masked.phoneMasked).toBe('090 ••• •• 01');
    });

    it("summarises the store: totals, groups and this month's new customers", async () => {
      const summary = await as(TENANT_A, () => customers.summary({}));
      expect(summary).toEqual({
        total: 3,
        newThisMonth: 3,
        members: 0,
        vip: 1,
        returningRate: null,
        returningRateDelta: null,
        groupCounts: { all: 3, retail: 2, member: 0, vip: 1, wholesale: 0 },
      });
      expect(
        (await as(TENANT_A, () => customers.summary({ month: '2020-01' })))
          .newThisMonth,
      ).toBe(0);
      const before = await as(TENANT_B, () => customers.summary({}));
      expect(before.total).toBe(1);
    });

    it('exports CSV with a BOM, escaped cells, neutralised formulas and masked phones', async () => {
      const full = await as(TENANT_A, () =>
        customers.exportCsv(listQuery({ sort: 'name', order: 'ASC' }), true),
      );
      expect(full.startsWith('﻿code,name,phone,')).toBe(true);
      const lines = full.trim().split('\r\n');
      expect(lines).toHaveLength(4);
      expect(lines[3]).toContain(`"'=cmd, ""x"""`);
      expect(lines[1]).toContain('0900000001');
      const masked = await as(TENANT_A, () =>
        customers.exportCsv(listQuery({ sort: 'name', order: 'ASC' }), false),
      );
      expect(masked).not.toContain('0900000001');
      expect(masked).toContain('090 ••• •• 01');
      expect(masked).not.toContain('Other store');
    });
  });

  describe('loyalty', () => {
    it('creates the setting lazily with defaults and updates it', async () => {
      expect(await as(TENANT_A, () => loyalty.getSettings())).toEqual({
        enabled: true,
        earnAmountPerPoint: 10000,
        redeemValuePerPoint: 1000,
        pointsExpireMonths: null,
      });
      const updated = await as(TENANT_A, () =>
        loyalty.updateSettings({
          earnAmountPerPoint: 20000,
          pointsExpireMonths: 12,
        }),
      );
      expect(updated).toMatchObject({
        enabled: true,
        earnAmountPerPoint: 20000,
        pointsExpireMonths: 12,
      });
      expect(
        (await as(TENANT_B, () => loyalty.getSettings())).earnAmountPerPoint,
      ).toBe(10000);
    });

    it('adjusts points and refuses to go below zero', async () => {
      const c = await create(TENANT_A, {});
      const up = await as(TENANT_A, () =>
        loyalty.adjust(c.id, { points: 100, reason: 'gift' }),
      );
      expect(up).toMatchObject({
        balance: 100,
        transaction: {
          type: 'adjust',
          points: 100,
          balanceAfter: 100,
          note: 'gift',
        },
      });
      const down = await as(TENANT_A, () =>
        loyalty.adjust(c.id, { points: -30, reason: 'fix' }),
      );
      expect(down.balance).toBe(70);
      await expect(
        as(TENANT_A, () =>
          loyalty.adjust(c.id, { points: -71, reason: 'too much' }),
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'U005' } });
      expect(
        (await as(TENANT_A, () => customers.get(c.id, true))).loyaltyPoints,
      ).toBe(70);
      const history = await as(TENANT_A, () =>
        loyalty.listTransactions(c.id, { page: 1, limit: 10 }),
      );
      expect(history.data.map((t) => t.points)).toEqual([-30, 100]);
    });

    it('never lets concurrent deductions overdraw', async () => {
      const c = await create(TENANT_A, {});
      await as(TENANT_A, () =>
        loyalty.adjust(c.id, { points: 100, reason: 'seed' }),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          as(TENANT_A, () =>
            loyalty.adjust(c.id, { points: -30, reason: 'race' }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(
        (await as(TENANT_A, () => customers.get(c.id, true))).loyaltyPoints,
      ).toBe(10);
      // the database refuses a negative balance whatever the code does
      await expect(
        ds.query(
          `UPDATE ${table('customer')} SET points_balance = -1 WHERE id = $1`,
          [c.id],
        ),
      ).rejects.toMatchObject({ constraint: 'CHK_customer_points_balance' });
    });
  });

  describe('sales.order.completed', () => {
    it('adds the order to the buyer and earns floor(total / amountPerPoint) points', async () => {
      const c = await create(TENANT_A, {});
      const order = completed(c.id, 259_000, randomUUID());
      await consume(TENANT_A, order);
      const after = await as(TENANT_A, () => customers.get(c.id, true));
      expect(after).toMatchObject({
        orderCount: 1,
        totalSpent: 259_000,
        loyaltyPoints: 25,
      });
      expect(after.lastPurchaseAt).toBe('2026-10-20T07:20:00.000Z');
      const history = await as(TENANT_A, () =>
        loyalty.listTransactions(c.id, { page: 1, limit: 5 }),
      );
      expect(history.data).toMatchObject([
        {
          type: 'earn',
          points: 25,
          balanceAfter: 25,
          orderId: order.orderId,
          orderCode: 'DH000001',
        },
      ]);
    });

    it('keeps the latest purchase date when an older order arrives late', async () => {
      const c = await create(TENANT_A, {});
      await consume(TENANT_A, completed(c.id, 1000));
      await consume(TENANT_A, {
        ...completed(c.id, 1000),
        completedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(
        (await as(TENANT_A, () => customers.get(c.id, true))).lastPurchaseAt,
      ).toBe('2026-10-20T07:20:00.000Z');
    });

    it("uses the store's setting: another rate, or none when the programme is off", async () => {
      const c = await create(TENANT_A, {});
      await as(TENANT_A, () =>
        loyalty.updateSettings({ earnAmountPerPoint: 1000 }),
      );
      await consume(TENANT_A, completed(c.id, 5_500));
      expect(
        (await as(TENANT_A, () => customers.get(c.id, true))).loyaltyPoints,
      ).toBe(5);
      await as(TENANT_A, () => loyalty.updateSettings({ enabled: false }));
      await consume(TENANT_A, completed(c.id, 50_000));
      const after = await as(TENANT_A, () => customers.get(c.id, true));
      expect(after).toMatchObject({
        orderCount: 2,
        totalSpent: 55_500,
        loyaltyPoints: 5,
      });
    });

    it('earns nothing below one point, but still counts the order', async () => {
      const c = await create(TENANT_A, {});
      await consume(TENANT_A, completed(c.id, 9_999));
      expect(await as(TENANT_A, () => customers.get(c.id, true))).toMatchObject(
        { orderCount: 1, loyaltyPoints: 0 },
      );
      expect(
        (
          await as(TENANT_A, () =>
            loyalty.listTransactions(c.id, { page: 1, limit: 5 }),
          )
        ).data,
      ).toEqual([]);
    });

    it("ignores an order without a customer, an unknown customer, another store's and a deleted one", async () => {
      const a = await create(TENANT_A, {});
      const b = await create(TENANT_B, {});
      const deleted = await create(TENANT_A, { phone: '0907777777' });
      await as(TENANT_A, () => customers.remove(deleted.id));
      await consume(TENANT_A, completed(null, 100_000));
      await consume(TENANT_A, completed(undefined, 100_000));
      await consume(TENANT_A, completed(randomUUID(), 100_000));
      await consume(TENANT_A, completed(b.id, 100_000)); // B's customer, A's event
      await consume(TENANT_A, completed(deleted.id, 100_000));
      expect(await as(TENANT_A, () => customers.get(a.id, true))).toMatchObject(
        { orderCount: 0, totalSpent: 0 },
      );
      expect(await as(TENANT_B, () => customers.get(b.id, true))).toMatchObject(
        { orderCount: 0, totalSpent: 0, loyaltyPoints: 0 },
      );
      expect(
        await ds.query(`SELECT 1 FROM ${table('loyalty_transaction')}`),
      ).toEqual([]);
    });

    it('rolls the whole handler back on failure (the inbox retries it)', async () => {
      const c = await create(TENANT_A, {});
      const order = completed(c.id, 100_000);
      await consume(TENANT_A, order);
      // the same order again would earn twice: the unique reference stops it, and nothing else sticks
      await expect(consume(TENANT_A, order)).rejects.toMatchObject({
        constraint: 'UQ_loyalty_transaction_ref',
      });
      expect(await as(TENANT_A, () => customers.get(c.id, true))).toMatchObject(
        { orderCount: 1, totalSpent: 100_000, loyaltyPoints: 10 },
      );
    });
  });
});
