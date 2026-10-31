import {
  buildOrderWhere,
  dateRange,
  dayStart,
  tabWhere,
  todayInStore,
} from './order-filters';

describe('order filters', () => {
  it('reads a day as Ho Chi Minh time', () => {
    expect(dayStart('2026-10-20').toISOString()).toBe(
      '2026-10-19T17:00:00.000Z',
    );
    expect(todayInStore(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20');
    expect(todayInStore(new Date('2026-10-19T16:30:00Z'))).toBe('2026-10-19');
  });

  it('makes to inclusive: the range ends at the start of the next day', () => {
    const range = dateRange('2026-10-20', '2026-10-20') as unknown as {
      type: string;
      value: { value: Date }[];
    };
    expect(range.type).toBe('and');
    expect(range.value.map((v) => v.value.toISOString())).toEqual([
      '2026-10-19T17:00:00.000Z',
      '2026-10-20T17:00:00.000Z',
    ]);
    expect(dateRange()).toBeUndefined();
  });

  it.each([
    ['new', { status: 'new' }],
    ['confirmed', { status: 'confirmed', fulfillmentStatus: 'unfulfilled' }],
    ['packing', { status: 'confirmed', fulfillmentStatus: 'packing' }],
    ['shipping', { status: 'confirmed', fulfillmentStatus: 'shipping' }],
    ['completed', { status: 'completed' }],
    ['processing', { status: 'confirmed' }],
  ])('tab %s', (tab, where) => {
    expect(tabWhere(tab)).toEqual(where);
  });

  it('leaves drafts out unless orderStatus asks for them', () => {
    const [plain] = buildOrderWhere({});
    expect((plain.status as { type: string }).type).toBe('not');
    const [drafts] = buildOrderWhere({ orderStatus: ['draft'] });
    expect((drafts.status as { type: string }).type).toBe('in');
  });

  it('turns q into an OR where every branch carries the other filters', () => {
    const where = buildOrderWhere({
      q: '50%_x',
      branchId: 'b1',
      channel: ['pos'],
    });
    expect(where).toHaveLength(5);
    for (const w of where) {
      expect(w.branchId).toBe('b1');
      expect(w.channel).toBeDefined();
    }
    const like = (where[0].code as unknown as { value: string }).value;
    expect(like).toBe('%50\\%\\_x%');
  });
});
