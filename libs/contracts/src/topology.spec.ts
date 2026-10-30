import {
  INVENTORY_RESERVATION_CONFIRMED,
  INVENTORY_STOCK_CHANGED,
  PLATFORM_BRANCH_UPDATED,
  SALES_ORDER_COMPLETED,
} from './events';
import { producerOf, subscribersOf, TOPOLOGY } from './topology';

describe('topology', () => {
  it('finds the subscribers of an event', () => {
    expect(subscribersOf(PLATFORM_BRANCH_UPDATED.type)).toEqual(
      expect.arrayContaining(['sales', 'inventory']),
    );
    expect(subscribersOf(SALES_ORDER_COMPLETED.type)).toEqual(
      expect.arrayContaining(['inventory', 'insight']),
    );
    expect(subscribersOf(INVENTORY_RESERVATION_CONFIRMED.type)).toEqual(
      expect.arrayContaining(['sales', 'insight']),
    );
    expect(subscribersOf(INVENTORY_STOCK_CHANGED.type)).toEqual(
      expect.arrayContaining(['insight']),
    );
    expect(subscribersOf('nobody.listens')).toEqual([]);
  });

  it('finds the producer of an event', () => {
    expect(producerOf(SALES_ORDER_COMPLETED.type)).toBe('sales');
    expect(producerOf(INVENTORY_RESERVATION_CONFIRMED.type)).toBe('inventory');
    expect(producerOf(INVENTORY_STOCK_CHANGED.type)).toBe('inventory');
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
