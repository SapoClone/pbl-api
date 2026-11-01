import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { AuditHandler } from './audit/audit.handler';
import { salesDate } from './common/store-time';
import { NotificationHandler } from './notifications/notification.handler';

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

describe('NotificationHandler attention producers', () => {
  const create = jest.fn();
  const handler = new NotificationHandler({ create } as never);
  beforeEach(() => create.mockClear());

  it('turns inventory.stock.below_min into a branch warning, critical at zero', async () => {
    const payload = {
      branchId: 'b1',
      warehouseId: 'w1',
      variantId: 'v1',
      sku: 'SKU-1',
      name: 'Áo',
      available: 2,
      minQuantity: 5,
      occurredAt: '2026-10-18T10:00:00.000Z',
    };
    await handler.onStockBelowMin(
      envelope('inventory.stock.below_min', payload),
      'm' as never,
    );
    await handler.onStockBelowMin(
      envelope('inventory.stock.below_min', { ...payload, available: 0 }),
      'm' as never,
    );
    expect(create.mock.calls[0][0]).toMatchObject({
      type: 'low_stock',
      severity: 'warning',
      branchId: 'b1',
      refId: 'v1',
    });
    expect(create.mock.calls[1][0]).toMatchObject({ severity: 'critical' });
  });

  it('flags an unmapped external order and a failed sync job for attention', async () => {
    await handler.onMappingRequired(
      envelope('integration.external_order.mapping_required', {
        channelOrderRefId: 'r1',
        externalOrderId: 'E1',
        provider: 'SHOPEE',
      }),
      'm' as never,
    );
    await handler.onSyncJobFailed(
      envelope('integration.sync_job.failed', {
        jobId: 'j1',
        jobType: 'orders',
        errorMessage: 'boom',
      }),
      'm' as never,
    );
    expect(create.mock.calls[0][0]).toMatchObject({
      type: 'unmapped_sku',
      severity: 'warning',
      refId: 'r1',
    });
    expect(create.mock.calls[1][0]).toMatchObject({
      type: 'sync_failed',
      severity: 'critical',
      body: 'boom',
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
