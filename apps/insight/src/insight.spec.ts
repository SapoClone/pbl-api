import { RequestContext, TenantScopedRepository } from '@pbl/common';
import { AuditHandler } from './audit/audit.handler';
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
