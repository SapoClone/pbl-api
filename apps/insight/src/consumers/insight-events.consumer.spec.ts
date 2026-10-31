import { normalizeOrderEvent } from './insight-events.consumer';

describe('normalizeOrderEvent', () => {
  const base = {
    orderId: 'o1',
    branchId: 'b1',
    totalAmount: 100000,
    items: [
      { sku: 'A', quantity: 1, unitPrice: 60001 },
      { sku: 'B', quantity: 2, unitPrice: 20000 },
    ],
  };

  it('maps the channel of sales.order.completed to the channel type', () => {
    expect(
      normalizeOrderEvent({ ...base, channel: 'shopee' }).channelType,
    ).toBe('SHOPEE');
    // lifecycle events already say channelType
    expect(
      normalizeOrderEvent({ ...base, channelType: 'POS' }).channelType,
    ).toBe('POS');
    expect(normalizeOrderEvent(base).channelType).toBeUndefined();
  });

  it('spreads the order cost over the lines by subtotal share, the last line takes the rest', () => {
    const out = normalizeOrderEvent({ ...base, costAmount: 60000 });
    const costs = out.items!.map((i) => i.cogsAmount);
    expect(costs).toEqual([36000, 24000]);
    expect(costs.reduce((a, b) => Number(a) + Number(b), 0)).toBe(60000);
    expect(out).not.toHaveProperty('costAmount');
  });

  it('keeps the remainder whole when the shares do not divide', () => {
    const out = normalizeOrderEvent({
      orderId: 'o',
      branchId: 'b',
      items: [
        { sku: 'A', quantity: 1, unitPrice: 1 },
        { sku: 'B', quantity: 1, unitPrice: 1 },
        { sku: 'C', quantity: 1, unitPrice: 1 },
      ],
      costAmount: 100,
    });
    const costs = out.items!.map((i) => Number(i.cogsAmount));
    expect(costs.every(Number.isInteger)).toBe(true);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('leaves the cost unknown without costAmount and respects a cost already on the lines', () => {
    expect(
      normalizeOrderEvent({ ...base, costAmount: null as never }).items![0],
    ).not.toHaveProperty('cogsAmount');
    expect(normalizeOrderEvent(base).items![0]).not.toHaveProperty(
      'cogsAmount',
    );
    const given = normalizeOrderEvent({
      ...base,
      items: [{ sku: 'A', quantity: 1, unitPrice: 5, unitCost: 3 }],
      costAmount: 99,
    });
    expect(given.items![0]).toEqual({
      sku: 'A',
      quantity: 1,
      unitPrice: 5,
      unitCost: 3,
    });
  });
});
