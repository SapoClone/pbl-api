import { TenantContext } from '@pbl/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventConsumer } from './event-consumer.service';
import { EventHandlerRegistry } from './event-handler.registry';
import { readEventsConfig } from './events-config';

const envelope = (overrides: Record<string, unknown> = {}) => ({
  id: '0b0f4a8e-6c0e-4c53-9d62-1f5a8c9d1e11',
  type: 'platform.branch.updated',
  version: 1,
  occurredAt: '2026-10-18T00:00:00.000Z',
  tenantId: 'tenant-a',
  actor: null,
  traceId: 'trace-1',
  payload: { id: 'b1' },
  ...overrides,
});

/** A DataSource whose transaction runs the callback; `inboxRows` is what the INSERT returns */
const build = (inboxRows: unknown[]) => {
  const manager = {
    query: jest.fn().mockResolvedValue(inboxRows),
  } as unknown as EntityManager;
  const dataSource = {
    options: { schema: 'sales' },
    transaction: jest.fn(async (work: (m: EntityManager) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;
  const registry = new EventHandlerRegistry(
    null as any,
    null as any,
    null as any,
  );
  const consumer = new EventConsumer(
    dataSource,
    registry,
    null as any,
    null as any,
    readEventsConfig({}),
    { service: 'sales', produces: false },
  );
  return { consumer, registry, manager, dataSource };
};

describe('EventConsumer.handleBody', () => {
  it('records the event in the inbox and runs the handler in the same transaction', async () => {
    const { consumer, registry, manager, dataSource } = build([
      { event_id: 'x' },
    ]);
    const handler = jest.fn(async () => {
      expect(TenantContext.require()).toBe('tenant-a');
    });
    registry.register('platform.branch.updated', handler);

    await expect(consumer.handleBody(JSON.stringify(envelope()))).resolves.toBe(
      'processed',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('"sales"."inbox_event"'),
      [envelope().id, 'platform.branch.updated'],
    );
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: envelope().id }),
      manager,
    );
  });

  it('skips a duplicate delivery without running the handler', async () => {
    const { consumer, registry } = build([]);
    const handler = jest.fn();
    registry.register('platform.branch.updated', handler);

    await expect(consumer.handleBody(JSON.stringify(envelope()))).resolves.toBe(
      'duplicate',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets a handler error escape, so the transaction rolls back and the message is retried', async () => {
    const { consumer, registry } = build([{ event_id: 'x' }]);
    registry.register('platform.branch.updated', async () => {
      throw new Error('projection failed');
    });
    await expect(
      consumer.handleBody(JSON.stringify(envelope())),
    ).rejects.toThrow('projection failed');
  });

  it('rejects an invalid envelope and malformed JSON', async () => {
    const { consumer, registry, dataSource } = build([{ event_id: 'x' }]);
    registry.register('platform.branch.updated', jest.fn());
    await expect(
      consumer.handleBody(JSON.stringify(envelope({ tenantId: '' }))),
    ).rejects.toThrow('Invalid event envelope');
    await expect(consumer.handleBody('not json')).rejects.toThrow();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('acknowledges an event nobody handles', async () => {
    const { consumer, dataSource } = build([{ event_id: 'x' }]);
    await expect(consumer.handleBody(JSON.stringify(envelope()))).resolves.toBe(
      'processed',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
