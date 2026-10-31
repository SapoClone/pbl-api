import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { AuditHandler } from './audit/audit.handler';
import { NotificationHandler } from './notifications/notification.handler';
import { toCsv } from './reports/report-export.service';
import {
  SalesSummaryHandler,
  salesDate,
} from './sales-summary/sales-summary.handler';

const envelope = (type: string, payload: object) =>
  ({
    id: '0b0f4a8e-6c0e-4c53-9d62-1f5a8c9d1e11',
    type,
    version: 1,
    occurredAt: '2026-10-18T10:00:00.000Z',
    tenantId: 'tenant-a',
    actor: null,
    traceId: 't',
    payload,
  }) as never;

describe('salesDate', () => {
  it('uses the store timezone (UTC+7), so a late-night sale lands on the next day', () => {
    expect(salesDate('2026-10-18T10:00:00.000Z')).toBe('2026-10-18');
    expect(salesDate('2026-10-18T18:30:00.000Z')).toBe('2026-10-19');
  });
});

describe('SalesSummaryHandler', () => {
  it('adds the order to the revenue of its day, in the event tenant', async () => {
    const query = jest.fn();
    const manager = { query, connection: { options: { schema: 'insight' } } };

    await RequestContext.run({ tenantId: 'tenant-a' }, () =>
      new SalesSummaryHandler().onOrderCompleted(
        envelope('sales.order.completed', {
          branchId: 'b1',
          totalAmount: 590000,
          completedAt: '2026-10-18T10:00:00.000Z',
        }),
        manager as never,
      ),
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('"insight"."daily_sales"');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual(['tenant-a', 'b1', '2026-10-18', 590000]);
  });
});

describe('SalesSummaryHandler read models', () => {
  const run = async (payload: object) => {
    const query = jest.fn();
    const manager = { query, connection: { options: { schema: 'insight' } } };
    await RequestContext.run({ tenantId: 'tenant-a' }, () =>
      new SalesSummaryHandler().onOrderCompleted(
        envelope('sales.order.completed', {
          branchId: 'b1',
          totalAmount: 100,
          completedAt: '2026-10-18T18:30:00.000Z',
          ...payload,
        }),
        manager as never,
      ),
    );
    return query.mock.calls.map(([sql, params]) => ({
      sql: sql as string,
      params,
    }));
  };

  it('keeps the daily counter first and defaults an old event to pos, unknown cost, no customer', async () => {
    const calls = await run({});

    expect(calls[0].sql).toContain('"insight"."daily_sales"');
    expect(calls[1].sql).toContain('"insight"."hourly_sales"');
    // 18:30Z is 01:30 on the 19th in Vietnam
    expect(calls[1].params).toEqual([
      'tenant-a',
      'b1',
      'pos',
      '2026-10-19',
      1,
      100,
      null,
      0,
    ]);
    expect(calls).toHaveLength(2);
  });

  it('adds channel, cost, one row per SKU and the customer when present', async () => {
    const calls = await run({
      channel: 'shopee',
      costAmount: 60,
      customerId: 'c1',
      items: [
        { sku: 'A', name: 'a', quantity: 1, unitPrice: 10 },
        { sku: 'A', name: 'a', quantity: 2, unitPrice: 10 },
        { sku: 'B', name: 'b', quantity: 1, unitPrice: 5 },
      ],
    });

    expect(calls[1].params).toEqual([
      'tenant-a',
      'b1',
      'shopee',
      '2026-10-19',
      1,
      100,
      60,
      100,
    ]);
    const products = calls.filter((c) => c.sql.includes('product_sales_daily'));
    expect(products.map((c) => c.params.slice(3))).toEqual([
      ['A', 'a', 3, 30],
      ['B', 'b', 1, 5],
    ]);
    const customer = calls.find((c) => c.sql.includes('customer_sales_daily'));
    expect(customer?.params).toEqual(['tenant-a', 'b1', '2026-10-19', 'c1', 1]);
  });
});

describe('csv', () => {
  it('quotes cells and neutralises formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 1],
          ['=1+1', null],
          ['say "hi"', 'ok'],
        ],
      ),
    ).toBe('a,b\r\n"x,y",1\r\n\'=1+1,\r\n"say ""hi""",ok\r\n');
  });
});

describe('NotificationHandler', () => {
  const create = jest.fn();
  const handler = new NotificationHandler({ create } as never);
  beforeEach(() => create.mockClear());

  it('writes an order notification keyed by the event id', async () => {
    await handler.onOrderCompleted(
      envelope('sales.order.completed', {
        orderId: 'o1',
        code: 'DH-7',
        branchId: 'b1',
        totalAmount: 1259000,
        itemCount: 3,
      }),
      'm' as never,
    );

    expect(create).toHaveBeenCalledWith(
      {
        id: '0b0f4a8e-6c0e-4c53-9d62-1f5a8c9d1e11',
        type: 'order',
        title: 'Đơn hàng mới DH-7',
        body: '1.259.000 đ · 3 sản phẩm',
        refType: 'order',
        refId: 'o1',
        branchId: 'b1',
      },
      'm',
    );
  });

  it('writes a staff notification for a granted membership', async () => {
    await handler.onMembershipGranted(
      envelope('platform.membership.granted', {
        accountId: 'a1',
        email: 'x@y.vn',
        role: 'cashier',
      }),
      'm' as never,
    );

    expect(create.mock.calls[0][0]).toMatchObject({
      type: 'staff',
      refType: 'account',
      refId: 'a1',
    });
  });
});

describe('AuditHandler', () => {
  let saved: Record<string, unknown>[];

  beforeEach(() => {
    saved = [];
    jest.spyOn(TenantScopedRepository, 'forEntity').mockReturnValue({
      save: jest.fn(async (row) => saved.push(row)),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const run = <T>(work: () => Promise<T>) =>
    RequestContext.run({ tenantId: 'tenant-a' }, work);

  it('records a login with the event id as the row id', async () => {
    await run(() =>
      new AuditHandler().onLogin(
        envelope('platform.account.logged_in', {
          accountId: 'a1',
          sessionId: 's1',
          role: 'cashier',
          method: 'password',
        }),
        {} as never,
      ),
    );

    expect(saved[0]).toMatchObject({
      id: '0b0f4a8e-6c0e-4c53-9d62-1f5a8c9d1e11',
      type: 'platform.account.logged_in',
      actorId: 'a1',
      summary: 'Account a1 signed in as cashier',
    });
  });

  it('records a role change with the previous and the new role', async () => {
    await run(() =>
      new AuditHandler().onRoleChanged(
        envelope('platform.membership.role_changed', {
          accountId: 'a2',
          email: 'c@example.com',
          role: 'manager',
          previousRole: 'cashier',
          changedBy: 'a1',
        }),
        {} as never,
      ),
    );

    expect(saved[0]).toMatchObject({
      actorId: 'a1',
      summary: 'c@example.com changed from cashier to manager',
    });
  });

  it('records a completed order', async () => {
    await run(() =>
      new AuditHandler().onOrderCompleted(
        envelope('sales.order.completed', {
          code: 'DH-1',
          totalAmount: 590000,
          createdBy: 'a3',
        }),
        {} as never,
      ),
    );

    expect(saved[0]).toMatchObject({
      actorId: 'a3',
      summary: 'Order DH-1 completed for 590000 VND',
    });
  });
});
