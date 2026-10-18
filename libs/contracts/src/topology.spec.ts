import { PLATFORM_BRANCH_UPDATED, SALES_ORDER_COMPLETED } from './events';
import { producerOf, subscribersOf, TOPOLOGY } from './topology';

describe('topology', () => {
  it('finds the subscribers of an event', () => {
    expect(subscribersOf(PLATFORM_BRANCH_UPDATED.type)).toEqual([
      'sales',
      'inventory',
    ]);
    expect(subscribersOf(SALES_ORDER_COMPLETED.type)).toEqual([
      'inventory',
      'insight',
    ]);
    expect(subscribersOf('nobody.listens')).toEqual([]);
  });

  it('finds the producer of an event', () => {
    expect(producerOf(SALES_ORDER_COMPLETED.type)).toBe('sales');
    expect(producerOf('unknown.event')).toBeUndefined();
  });

  it('only subscribes to events that someone produces', () => {
    const produced = Object.values(TOPOLOGY.producers).flat() as string[];
    for (const types of Object.values(TOPOLOGY.subscriptions)) {
      for (const type of types as readonly string[]) {
        expect(produced).toContain(type);
      }
    }
  });
});
