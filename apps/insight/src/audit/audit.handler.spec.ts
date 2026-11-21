import { AdminAuditEntry } from './audit-writer.service';
import { AuditHandler } from './audit.handler';

const EVENT_ID = '0b0f4a8e-6c0e-4c53-9d62-1f5a8c9d1e11';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = {
  type: 'platform_admin' as const,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Lan Anh',
  role: 'super_admin',
};

const envelope = (
  type: string,
  payload: object,
  tenantId: string | null = TENANT,
  actor: { id: string; type: string } | null = null,
) =>
  ({
    id: EVENT_ID,
    type,
    version: 1,
    occurredAt: '2026-10-18T10:00:00.000Z',
    tenantId,
    actor,
    traceId: 't',
    payload,
  }) as never;

describe('AuditHandler', () => {
  let written: {
    entry: AdminAuditEntry;
    meta: { id?: string; eventType?: string; summary?: string };
  }[];
  let handler: AuditHandler;
  const manager = {} as never;

  beforeEach(() => {
    written = [];
    handler = new AuditHandler({
      recordIn: jest.fn(async (_m, entry, meta) => {
        written.push({ entry, meta });
      }),
    } as never);
  });

  it('records a login with the event id as the row id, in the event store', async () => {
    await handler.onLogin(
      envelope('platform.account.logged_in', {
        accountId: 'a1',
        sessionId: 's1',
        role: 'cashier',
        method: 'password',
      }),
      manager,
    );
    expect(written[0].meta).toEqual({
      id: EVENT_ID,
      eventType: 'platform.account.logged_in',
      summary: 'Account a1 signed in as cashier',
    });
    expect(written[0].entry).toMatchObject({
      scope: 'tenant',
      tenantId: TENANT,
      actor: { type: 'member', id: 'a1' },
      action: 'account.logged_in',
      result: 'success',
      occurredAt: new Date('2026-10-18T10:00:00.000Z'),
    });
  });

  it('records a role change and a completed order with their old summaries', async () => {
    await handler.onRoleChanged(
      envelope('platform.membership.role_changed', {
        accountId: 'a2',
        email: 'c@example.com',
        role: 'manager',
        previousRole: 'cashier',
        changedBy: 'a1',
      }),
      manager,
    );
    await handler.onOrderCompleted(
      envelope('sales.order.completed', {
        orderId: 'o1',
        code: 'DH-1',
        totalAmount: 590000,
        createdBy: 'a3',
      }),
      manager,
    );
    expect(written[0].meta.summary).toBe(
      'c@example.com changed from cashier to manager',
    );
    expect(written[0].entry.actor).toEqual({ type: 'member', id: 'a1' });
    expect(written[1].meta.summary).toBe('Order DH-1 completed for 590000 VND');
    expect(written[1].entry.actor).toEqual(
      expect.objectContaining({ type: 'member', id: 'a3' }),
    );
  });

  it('records a store edit by an admin with the before and after values and the store name', async () => {
    await handler.onTenantUpdated(
      envelope('platform.tenant.updated', {
        id: TENANT,
        code: 'TN0001',
        name: 'Cua hang A',
        actor: ADMIN,
        changes: { name: { from: 'Old', to: 'Cua hang A' } },
      }),
      manager,
    );
    expect(written[0].entry).toMatchObject({
      scope: 'tenant',
      tenantId: TENANT,
      actor: { type: 'platform_admin', id: ADMIN.id, name: 'Lan Anh' },
      action: 'tenant.updated',
      target: { type: 'tenant', id: TENANT, name: 'TN0001' },
      data: {
        tenantName: 'Cua hang A',
        changes: { name: { from: 'Old', to: 'Cua hang A' } },
      },
    });
  });

  it('records a status change, using the store name of the payload', async () => {
    await handler.onTenantStatusChanged(
      envelope('platform.tenant.status_changed', {
        tenantId: TENANT,
        tenantName: 'Cua hang A',
        tenantCode: 'TN0001',
        from: 'active',
        to: 'suspended',
        reason: 'unpaid',
        changedBy: ADMIN,
      }),
      manager,
    );
    expect(written[0].entry).toMatchObject({
      action: 'tenant.status_changed',
      actor: { type: 'platform_admin', name: 'Lan Anh' },
      target: { type: 'tenant', name: 'TN0001' },
      data: { tenantName: 'Cua hang A', reason: 'unpaid' },
    });
    expect(written[0].meta.summary).toBe(
      'Store changed from active to suspended: unpaid',
    );
  });

  it('records a plan change but not a first plan, a past-due notice or a resync', async () => {
    const base = {
      subscriptionId: 's1',
      tenantCode: 'TN0001',
      fromPlan: 'free',
      toPlan: 'pro',
      expiresAt: null,
      quotas: {},
      actor: ADMIN,
    };
    await handler.onSubscriptionChanged(
      envelope('platform.subscription.changed', {
        ...base,
        eventType: 'upgraded',
      }),
      manager,
    );
    await handler.onSubscriptionChanged(
      envelope('platform.subscription.changed', {
        ...base,
        eventType: 'created',
      }),
      manager,
    );
    await handler.onSubscriptionChanged(
      envelope('platform.subscription.changed', {
        ...base,
        eventType: 'past_due',
      }),
      manager,
    );
    await handler.onSubscriptionChanged(
      envelope('platform.subscription.changed', {
        ...base,
        eventType: 'resync',
      }),
      manager,
    );
    expect(written).toHaveLength(1);
    expect(written[0].entry).toMatchObject({
      action: 'subscription.plan_changed',
      target: { type: 'subscription', id: 's1' },
    });
  });

  it('writes one platform row per plan edit, however many stores get the event', async () => {
    const payload = {
      planId: 'p1',
      code: 'pro',
      status: 'active',
      quotas: {},
      updatedAt: '2026-10-18T09:59:00.000Z',
      actor: ADMIN,
      changes: { priceMonthly: { from: 1, to: 2 } },
    };
    await handler.onPlanChanged(
      envelope('platform.plan.changed', payload),
      manager,
    );
    await handler.onPlanChanged(
      envelope(
        'platform.plan.changed',
        payload,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ),
      manager,
    );
    expect(written[0].entry).toMatchObject({
      scope: 'platform',
      tenantId: null,
      action: 'plan.updated',
    });
    expect(written[0].meta.id).toBe(written[1].meta.id);
    expect(written[0].meta.id).not.toBe(EVENT_ID);
  });

  it('ignores a plan announcement that is not an admin edit', async () => {
    await handler.onPlanChanged(
      envelope('platform.plan.changed', {
        planId: 'p1',
        code: 'pro',
        actor: { type: 'system', id: null },
      }),
      manager,
    );
    expect(written).toHaveLength(0);
  });

  it('writes platform-scope rows for the admin, settings and sessions events', async () => {
    await handler.onAdminCreated(
      envelope(
        'platform.admin.created',
        {
          actor: ADMIN,
          target: {
            type: 'admin',
            id: 'x1',
            name: 'Minh',
            email: 'm@x.vn',
            role: 'admin',
            status: 'active',
          },
        },
        null,
      ),
      manager,
    );
    await handler.onSettingsChanged(
      envelope(
        'platform.settings.changed',
        {
          actor: ADMIN,
          keys: ['security.lockoutMaxAttempts'],
          changes: { 'security.lockoutMaxAttempts': { from: 5, to: 6 } },
        },
        null,
      ),
      manager,
    );
    await handler.onSessionsRevoked(
      envelope(
        'platform.account.sessions_revoked',
        {
          actor: ADMIN,
          target: { type: 'account', id: 'a9', name: 'Hoa', email: 'h@x.vn' },
          revokedCount: 3,
        },
        null,
      ),
      manager,
    );
    expect(
      written.map((w) => [w.entry.scope, w.entry.tenantId, w.entry.action]),
    ).toEqual([
      ['platform', null, 'admin.created'],
      ['platform', null, 'settings.changed'],
      ['platform', null, 'account.sessions_revoked'],
    ]);
    expect(written.every((w) => w.meta.id === EVENT_ID)).toBe(true);
    expect(written[1].entry.data).toEqual({
      keys: ['security.lockoutMaxAttempts'],
      changes: { 'security.lockoutMaxAttempts': { from: 5, to: 6 } },
    });
  });

  it('records support sessions in the store, the expiry as the system', async () => {
    await handler.onSupportSessionStarted(
      envelope('platform.support_session.started', {
        sessionId: 'ss1',
        code: 'SS0001',
        tenantId: TENANT,
        tenantName: 'Cua hang A',
        adminId: ADMIN.id,
        adminName: 'Lan Anh',
        reason: 'ticket 42',
        expiresAt: '2026-10-18T11:00:00.000Z',
      }),
      manager,
    );
    await handler.onSupportSessionEnded(
      envelope('platform.support_session.ended', {
        sessionId: 'ss1',
        code: 'SS0001',
        tenantId: TENANT,
        adminId: ADMIN.id,
        adminName: 'Lan Anh',
        endedBy: 'expiry',
        endedAt: '2026-10-18T11:00:00.000Z',
      }),
      manager,
    );
    expect(written[0].entry).toMatchObject({
      scope: 'tenant',
      tenantId: TENANT,
      actor: { type: 'platform_admin', name: 'Lan Anh' },
      action: 'support_session.started',
      target: { type: 'support_session', id: 'ss1', name: 'SS0001' },
      data: { tenantName: 'Cua hang A', reason: 'ticket 42' },
    });
    expect(written[1].entry).toMatchObject({
      actor: { type: 'system' },
      action: 'support_session.ended',
    });
  });

  it('records a disconnect by an admin as that admin, and by a store member as the request actor', async () => {
    const payload = {
      connectionId: 'c1',
      provider: 'SHOPEE',
      shopName: 'Shop A',
      branchId: 'b1',
      status: 'disconnected',
      reason: 'closed shop',
    };
    await handler.onConnectionDisconnected(
      envelope('integration.connection.disconnected', {
        ...payload,
        actor: { type: 'platform_admin', id: ADMIN.id, name: 'Lan Anh' },
      }),
      manager,
    );
    await handler.onConnectionDisconnected(
      envelope('integration.connection.disconnected', payload, TENANT, {
        id: 'm1',
        type: 'account',
      }),
      manager,
    );
    expect(written[0].entry).toMatchObject({
      actor: { type: 'platform_admin', id: ADMIN.id, name: 'Lan Anh' },
      action: 'integration.disconnected',
      target: { type: 'integration', id: 'c1', name: 'Shop A' },
      data: { reason: 'closed shop' },
    });
    expect(written[1].entry.actor).toMatchObject({ type: 'member', id: 'm1' });
  });
});
