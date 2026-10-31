import { stockLevel } from './stock.service';

describe('stockLevel', () => {
  it.each([
    [0, null, 'out_of_stock'],
    [-1, 5, 'out_of_stock'],
    [4, 5, 'below_min'],
    [5, 5, 'ok'],
    [1, null, 'ok'],
    [50, 12, 'ok'],
    [0, 0, 'out_of_stock'],
  ])('available %p with min %p is %s', (available, min, level) => {
    expect(stockLevel(available, min)).toBe(level);
  });
});
