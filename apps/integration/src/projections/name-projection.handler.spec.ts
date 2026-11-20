import { EventEnvelope } from '@pbl/common';
import { EntityManager } from 'typeorm';
import { NameProjectionHandler } from './name-projection.handler';

const T = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('NameProjectionHandler', () => {
  const query = jest.fn(async () => []);
  const manager = {
    connection: { options: { schema: 'integration' } },
    query,
  } as unknown as EntityManager;
  const handler = new NameProjectionHandler();
  beforeEach(() => query.mockClear());

  it('upserts the store name, ignoring an older event', async () => {
    await handler.onTenantUpdated(
      {
        tenantId: T,
        payload: {
          id: T,
          name: 'Moc Store',
          updatedAt: '2031-01-02T00:00:00.000Z',
        },
      } as unknown as EventEnvelope<never>,
      manager,
    );
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('"integration"."tenant_projection"');
    expect(sql).toContain(
      '"source_updated_at" <= EXCLUDED."source_updated_at"',
    );
    expect(params).toEqual([
      T,
      'Moc Store',
      new Date('2031-01-02T00:00:00.000Z'),
    ]);
  });

  it('upserts the branch name under the tenant of the event', async () => {
    await handler.onBranchCreated(
      {
        tenantId: T,
        payload: { id: B, name: 'CN1', updatedAt: '2031-01-02T00:00:00.000Z' },
      } as unknown as EventEnvelope<never>,
      manager,
    );
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('"integration"."branch_projection"');
    expect(params.slice(0, 3)).toEqual([B, T, 'CN1']);
  });
});
