import { ForbiddenException } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantStatusHandler } from './tenant-status.handler';
import { TenantStatusService } from './tenant-status.service';

const options = { schema: 'integration' };
const T = '11111111-1111-4111-8111-111111111111';

const envelope = <P>(payload: P, occurredAt: string) =>
  ({ payload, occurredAt, tenantId: T }) as unknown as EventEnvelope<P>;

describe('TenantStatusHandler', () => {
  const query = jest.fn(async () => []);
  const manager = {
    connection: { options },
    query,
  } as unknown as EntityManager;
  const handler = new TenantStatusHandler();
  beforeEach(() => query.mockClear());

  it('upserts the status of the store, and only over an older or equal event', async () => {
    await handler.onStatusChanged(
      envelope(
        { tenantId: T, from: 'active', to: 'suspended', reason: null },
        '2031-01-02T00:00:00.000Z',
      ) as never,
      manager,
    );
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('"integration"."tenant_status"');
    expect(sql).toContain(
      '"status_changed_at" <= EXCLUDED."status_changed_at"',
    );
    expect(params.slice(0, 2)).toEqual([T, 'suspended']);
    expect(params[2]).toEqual(new Date('2031-01-02T00:00:00.000Z'));
  });

  it('upserts the plan code without touching the status', async () => {
    await handler.onSubscriptionChanged(
      envelope(
        { tenantId: T, toPlan: 'free', eventType: 'expired' },
        '2031-01-02T00:00:00.000Z',
      ) as never,
      manager,
    );
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('SET "plan_code" = EXCLUDED."plan_code"');
    expect(sql).not.toContain('SET "status"');
    expect(params.slice(0, 2)).toEqual([T, 'free']);
  });
});

describe('TenantStatusService', () => {
  const service = (rows: { status: string }[]) =>
    new TenantStatusService(
      Object.assign(Object.create(DataSource.prototype), {
        options,
        query: jest.fn(async () => rows),
      }) as DataSource,
    );

  it('lets an active store and a store with no row through (fail open)', async () => {
    await expect(
      service([{ status: 'active' }]).assertActive(T, 'test'),
    ).resolves.toBeUndefined();
    await expect(service([]).assertActive(T, 'test')).resolves.toBeUndefined();
  });

  it('refuses a suspended store with 403 TENANT_SUSPENDED', async () => {
    const error = await service([{ status: 'suspended' }])
      .assertActive(T, 'test')
      .catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({
      statusCode: 403,
      errorCode: 'TENANT_SUSPENDED',
    });
  });
});
