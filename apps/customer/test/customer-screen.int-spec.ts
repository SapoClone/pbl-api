import { EventEnvelope, RequestContext } from '@pbl/common';
import { OrderCompletedPayload, SALES_ORDER_COMPLETED } from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { M4_CUSTOMER_ENTITIES } from '../src/infrastructure/persistence/customer.entities';
import { CreateM4CustomerCore1791900000200 } from '../src/migrations/1791900000200-create-m4-customer-core';
import { DataManagementService } from '../src/modules/data-management/data-management.service';
import { GroupsService } from '../src/modules/groups/groups.service';
import { LoyaltyService } from '../src/modules/loyalty/loyalty.service';
import { MembershipsService } from '../src/modules/memberships/memberships.service';
import { ProfilesService } from '../src/modules/profiles/profiles.service';
import { TagsService } from '../src/modules/tags/tags.service';

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = '99999999-9999-4999-8999-999999999999';

const as = <T>(tenantId: string, fn: () => Promise<T>) =>
  RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
      actor: { id: ACTOR, type: 'account' },
    },
    fn,
  );

describe('Customer screen endpoints (real PostgreSQL)', () => {
  const schema = uniqueSchema('customer_screen_it');
  let ds: DataSource;
  let profiles: ProfilesService;
  let groups: GroupsService;
  let tags: TagsService;
  let loyalty: LoyaltyService;
  let data: DataManagementService;

  const create = (dto: any, full = true, tenant = T1) =>
    profiles.createCustomer(tenant, ACTOR, dto, full) as Promise<any>;
  const order = (tenantId: string, customerId: string, total: number) =>
    loyalty.onSalesOrderCompleted({
      id: randomUUID(),
      type: SALES_ORDER_COMPLETED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId,
      actor: null,
      traceId: randomUUID(),
      payload: {
        orderId: randomUUID(),
        code: `DH${Math.floor(Math.random() * 1e6)}`,
        branchId: randomUUID(),
        customerId,
        totalAmount: total,
        itemCount: 1,
        subtotal: total,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: total,
        paymentMethod: 'CASH',
        createdBy: ACTOR,
        completedAt: new Date().toISOString(),
        items: [],
      },
    } as EventEnvelope<OrderCompletedPayload>);

  beforeAll(async () => {
    useDatabase(schema);
    ds = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M4_CUSTOMER_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM4CustomerCore1791900000200,
        ],
      }),
    });
    const outbox = new EventOutbox();
    groups = new GroupsService(ds, outbox);
    tags = new TagsService(ds);
    loyalty = new LoyaltyService(
      ds,
      new MembershipsService(ds, outbox),
      outbox,
    );
    profiles = new ProfilesService(ds, outbox);
    data = new DataManagementService(ds, outbox);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('seeds the four groups once, with customerCount and isSeeded', async () => {
    const list = await as(T1, () => groups.listGroups());
    await as(T1, () => groups.listGroups());
    const seeded = list.filter((g) => g.isSeeded);
    expect(seeded.map((g) => g.code).sort()).toEqual([
      'member',
      'retail',
      'vip',
      'wholesale',
    ]);
    expect(list.every((g) => g.customerCount === 0)).toBe(true);
    expect((await as(T1, () => groups.listGroups())).length).toBe(4);
  });

  it('tags: create, duplicate (case-insensitive) is 409, list, tenant isolation', async () => {
    const t = await tags.createTag(T1, { name: 'Mua nhieu' });
    expect(t).toEqual({ id: expect.any(String), name: 'Mua nhieu' });
    await expect(
      tags.createTag(T1, { name: 'MUA NHIEU' }),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_TAG_ALREADY_EXISTS',
      httpStatus: 409,
    });
    await tags.createTag(T1, { name: 'Qua tang' });
    expect((await tags.listTags(T1)).data.map((x) => x.name)).toEqual([
      'Mua nhieu',
      'Qua tang',
    ]);
    expect((await tags.listTags(T2)).data).toEqual([]);
    await tags.createTag(T2, { name: 'Mua nhieu' });
  });

  it('create with addresses, tags, group alias, loyalty and initial points; detail shape; masking', async () => {
    const member = (await as(T1, () => groups.listGroups())).find(
      (g) => g.code === 'member',
    )!;
    const tag = (await tags.listTags(T1)).data[0];
    const c = await create({
      name: 'Nguyen Ngoc Ha',
      phone: '0901234528',
      gender: 'FEMALE',
      dob: '1995-04-12',
      groupId: member.id,
      tagIds: [tag.id],
      source: 'store',
      loyalty: { enabled: true, initialPoints: 40 },
      addresses: [
        {
          province: 'HCM',
          district: 'Phu Nhuan',
          ward: 'Cau Kieu',
          addressLine: '1 A',
        },
        {
          province: 'HCM',
          district: 'Q1',
          ward: 'BN',
          addressLine: '2 B',
          isDefault: true,
        },
      ],
    });
    expect(c.memberCode).toMatch(/^MB\d{6}$/);
    expect(c.dob).toBe('1995-04-12');
    expect(c.group).toMatchObject({ id: member.id, code: 'member' });
    expect(c.tags).toEqual([{ id: tag.id, name: tag.name }]);
    expect(c.loyaltyPoints).toBe(40);
    expect(c.tier === null || typeof c.tier.id === 'string').toBe(true);
    expect(c.addresses).toHaveLength(2);
    expect(c.addresses.filter((a: any) => a.isDefault)).toHaveLength(1);
    expect(c.addresses[0].addressLine).toBe('2 B');
    expect(c.joinedAt).toBeDefined();
    expect(c.phone).toBe('0901234528');
    expect(c.phoneMasked).toBe('090 ••• •• 28');

    const masked = (await profiles.getCustomerById(T1, c.id, {
      fullPhone: false,
    })) as any;
    expect(masked.phone).toBe('090***4528');
    expect(masked.phoneMasked).toBe('090 ••• •• 28');
    expect(masked.addresses[0].recipientPhone).toBe('090***4528');
    expect(JSON.stringify(masked)).not.toContain('0901234528');

    const txs = await as(T1, () => loyalty.listTransactionsPage(c.id));
    expect(txs.data[0]).toMatchObject({ type: 'adjust', points: 40 });
    expect(txs.pagination.totalRecords).toBe(1);
  });

  it('create rejects addresses plus initialAddress, unknown tag and initialPoints without loyalty (422/404)', async () => {
    const addr = {
      province: 'p',
      district: 'd',
      ward: 'w',
      addressLine: 'l',
    };
    await expect(
      create({
        name: 'X',
        addresses: [addr],
        initialAddress: { addressLine: 'l' },
      }),
    ).rejects.toMatchObject({ httpStatus: 422 });
    await expect(
      create({ name: 'X', tagIds: [randomUUID()] }),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_TAG_NOT_FOUND',
      httpStatus: 404,
    });
    await expect(
      create({
        name: 'X',
        loyalty: { enabled: false, initialPoints: 5 },
      }),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('list: contract rows, filters, sort, spend, tag, pagination, phone rule, tenant isolation', async () => {
    const lst = (await as(T1, () => groups.listGroups())) as any[];
    const vip = lst.find((g) => g.code === 'vip');
    const tag = (await tags.listTags(T1)).data[1];
    const big = await create({
      name: 'Big Spender',
      phone: '0911000001',
      groupId: vip.id,
      tagIds: [tag.id],
    });
    const small = await create({ name: 'Small Spender', phone: '0911000002' });
    await order(T1, big.id, 5_000_000);
    await order(T1, big.id, 1_000_000);
    await order(T1, small.id, 200_000);

    const all = (await profiles.listCustomers(T1, { limit: 50 }, false)) as any;
    const row = all.data.find((r: any) => r.id === big.id);
    expect(row).toMatchObject({
      orderCount: 2,
      totalSpent: 6_000_000,
      phone: null,
      phoneMasked: '091 ••• •• 01',
      group: { code: 'vip' },
    });
    expect(row.loyaltyPoints).toBe(600);
    expect(row.lastPurchaseAt).toBeTruthy();
    expect(all.items.length).toBe(all.data.length);
    expect(all.pagination.totalRecords).toBe(all.total);
    expect(JSON.stringify(all)).not.toContain('0911000001');

    const full = (await profiles.listCustomers(T1, { q: 'Big' }, true)) as any;
    expect(full.data[0].phone).toBe('0911000001');

    const byGroup = (await profiles.listCustomers(
      T1,
      { group: 'VIP,all' },
      false,
    )) as any;
    expect(byGroup.data.map((r: any) => r.id)).toEqual([big.id]);
    const byTag = (await profiles.listCustomers(
      T1,
      { tagId: tag.id },
      false,
    )) as any;
    expect(byTag.data.map((r: any) => r.id)).toEqual([big.id]);
    const spend = (await profiles.listCustomers(
      T1,
      { spendMin: 100_000, spendMax: 1_000_000 },
      false,
    )) as any;
    expect(spend.data.map((r: any) => r.id)).toEqual([small.id]);
    const sorted = (await profiles.listCustomers(
      T1,
      { sort: 'totalSpent', order: 'desc', limit: 2 },
      false,
    )) as any;
    expect(sorted.data.map((r: any) => r.id)).toEqual([big.id, small.id]);
    expect(sorted.pagination).toMatchObject({
      limit: 2,
      currentPage: 1,
      nextPage: 2,
    });
    const page2 = (await profiles.listCustomers(
      T1,
      { sort: 'totalSpent', order: 'desc', limit: 2, page: 2 },
      false,
    )) as any;
    expect(page2.pagination.currentPage).toBe(2);
    const byPhone = (await profiles.listCustomers(
      T1,
      { q: '+84 911 000 002' },
      false,
    )) as any;
    expect(byPhone.data.map((r: any) => r.id)).toEqual([small.id]);
    const other = (await profiles.listCustomers(T2, {}, false)) as any;
    expect(other.total).toBe(0);
  });

  it('KPI summary: totals, group counts, returning rate; tenant isolation', async () => {
    const s = await profiles.getKpiSummary(T1, {});
    expect(s.total).toBeGreaterThanOrEqual(3);
    expect(s.newThisMonth).toBe(s.total);
    expect(s.groupCounts).toMatchObject({ all: s.total, vip: 1 });
    expect(s.vip).toBe(1);
    expect(s.members).toBeGreaterThanOrEqual(1);
    // one buyer with 2 orders, one with 1 order -> 1/2
    expect(s.returningRate).toBe(0.5);
    expect(s.returningRateDelta).toBe(0.5);
    const empty = await profiles.getKpiSummary(T2, { month: '2020-01' });
    expect(empty).toMatchObject({ total: 0, returningRate: 0, vip: 0 });
  });

  it('update: tagIds replace, groupId alias, loyalty.enabled; delete blocked by debt', async () => {
    const tag = (await tags.listTags(T1)).data;
    const c = await create({
      name: 'Upd',
      phone: '0911000010',
      tagIds: [tag[0].id],
    });
    const u = (await profiles.updateCustomer(
      T1,
      c.id,
      ACTOR,
      { tagIds: [tag[1].id], loyalty: { enabled: false }, gender: 'MALE' },
      true,
    )) as any;
    expect(u.tags.map((t: any) => t.id)).toEqual([tag[1].id]);
    expect(u.loyalty.enabled).toBe(false);
    const cleared = (await profiles.updateCustomer(
      T1,
      c.id,
      ACTOR,
      { tagIds: [] },
      true,
    )) as any;
    expect(cleared.tags).toEqual([]);
    await ds.query(
      `UPDATE "${schema}"."customers" SET current_debt = 5000 WHERE id = $1`,
      [c.id],
    );
    await expect(
      profiles.deactivateCustomer(T1, c.id, ACTOR, {}),
    ).rejects.toMatchObject({ code: 'CUSTOMER_HAS_OUTSTANDING_DEBT' });
    await ds.query(
      `UPDATE "${schema}"."customers" SET current_debt = 0 WHERE id = $1`,
      [c.id],
    );
    await profiles.deactivateCustomer(T1, c.id, ACTOR, {});
  });

  it('group delete: seeded 409, non-empty 409, empty 204-path, unknown 404', async () => {
    const lst = (await as(T1, () => groups.listGroups())) as any[];
    const retail = lst.find((g) => g.code === 'retail');
    await expect(
      as(T1, () => groups.deleteGroup(retail.id)),
    ).rejects.toMatchObject({ code: 'CUSTOMER_GROUP_SEEDED' });
    const g = await as(T1, () => groups.createGroup({ name: 'Doanh nghiep' }));
    const c = await create({
      name: 'In group',
      phone: '0911000020',
      customerGroupId: g.id,
    });
    await expect(as(T1, () => groups.deleteGroup(g.id))).rejects.toMatchObject({
      code: 'CUSTOMER_GROUP_NOT_EMPTY',
    });
    await profiles.deactivateCustomer(T1, c.id, ACTOR, {});
    await as(T1, () => groups.deleteGroup(g.id));
    await expect(as(T1, () => groups.deleteGroup(g.id))).rejects.toMatchObject({
      httpStatus: 404,
    });
    await expect(
      as(T2, () => groups.deleteGroup(retail.id)),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('import: dry run rolls back, real run creates/updates, duplicates and invalid rows reported without phones', async () => {
    const existing = await create({
      name: 'Exist',
      phone: '0922000001',
      code: 'KHIMP1',
    });
    const csv = [
      'code,name,phone,email,source,note',
      ',New One,0922000002,n1@x.vn,STORE,hi',
      'KHIMP1,Exist Renamed,,,,',
      ',Dup Phone,0922000001,,,',
      ',,0922000003,,,',
      ',Bad Phone,abc,,,',
    ].join('\n');
    const dry = await data.importCustomersFromFile(T1, ACTOR, csv, true);
    expect(dry).toEqual({
      total: 5,
      created: 1,
      updated: 1,
      failed: 3,
      errors: [
        { row: 3, field: 'phone', code: 'duplicate' },
        { row: 4, field: 'name', code: 'required' },
        { row: 5, field: 'phone', code: 'invalid' },
      ],
    });
    expect(JSON.stringify(dry)).not.toContain('0922');
    const before = (await profiles.listCustomers(
      T1,
      { q: 'New One' },
      true,
    )) as any;
    expect(before.total).toBe(0);
    const real = await data.importCustomersFromFile(T1, ACTOR, csv, false);
    expect(real).toEqual(dry);
    const after = (await profiles.listCustomers(
      T1,
      { q: 'New One' },
      true,
    )) as any;
    expect(after.total).toBe(1);
    const renamed = (await profiles.getCustomerById(T1, existing.id, {
      fullPhone: true,
    })) as any;
    expect(renamed.name).toBe('Exist Renamed');
    await expect(
      data.importCustomersFromFile(T1, ACTOR, 'foo,bar\n1,2', false),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('export csv: filters, masked phones unless full, formula-safe', async () => {
    await create({ name: '=cmd()', phone: '0933000001' });
    const masked = await profiles.exportCustomersCsv(T1, { q: 'cmd' }, false);
    const [header, line] = masked.split('\n');
    expect(header).toBe(
      'code,name,phone,email,group,orderCount,totalSpent,loyaltyPoints,lastPurchaseAt,source,status,note',
    );
    expect(line).toContain("'=cmd()");
    expect(line).toContain('093***0001');
    expect(masked).not.toContain('0933000001');
    const full = await profiles.exportCustomersCsv(T1, { q: 'cmd' }, true);
    expect(full).toContain('0933000001');
    expect(await profiles.exportCustomersCsv(T2, {}, true)).toBe(header);
  });

  it('loyalty: ledger page types and order codes, adjustment cannot go below zero, settings mapping', async () => {
    const c = await create({ name: 'Ledger', phone: '0944000001' });
    await order(T1, c.id, 300_000);
    const page = await as(T1, () =>
      loyalty.listTransactionsPage(c.id, { limit: 1 }),
    );
    expect(page.data[0]).toMatchObject({ type: 'earn', points: 30 });
    expect(page.data[0].orderCode).toMatch(/^DH/);
    const adj = await as(T1, () =>
      loyalty.adjustPoints(c.id, ACTOR, undefined, {
        pointsDelta: -10,
        reason: 'Dieu chinh tay',
      }),
    );
    expect(adj.account.postedPointsBalance).toBe(20);
    await expect(
      as(T1, () =>
        loyalty.adjustPoints(c.id, ACTOR, undefined, {
          pointsDelta: -100,
          reason: 'Too much',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_LOYALTY_POINTS' });
    await expect(
      as(T2, () => loyalty.listTransactionsPage(c.id)),
    ).rejects.toMatchObject({ httpStatus: 404 });
    const s = await as(T1, () =>
      loyalty.updateSettings(ACTOR, { pointsExpirationDays: 360 }),
    );
    expect(s.pointsExpirationDays).toBe(360);
  });
});
