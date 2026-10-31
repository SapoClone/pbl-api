import { maskPhone } from '../documents/documents.service';
import { csvCell, levelOf, refTypeOf } from './stock-views.service';

describe('stock view helpers', () => {
  it('levelOf: out of stock at zero, below min under the minimum, else ok', () => {
    expect(levelOf(0, 5)).toBe('out_of_stock');
    expect(levelOf(0, null)).toBe('out_of_stock');
    expect(levelOf(4, 5)).toBe('below_min');
    expect(levelOf(5, 5)).toBe('ok');
    expect(levelOf(1, null)).toBe('ok');
  });

  it('refTypeOf maps ledger movements to the contract refTypes', () => {
    expect(refTypeOf('PURCHASE_RECEIPT')).toBe('receipt');
    expect(refTypeOf('RECEIPT')).toBe('receipt');
    expect(refTypeOf('MANUAL_ISSUE')).toBe('issue');
    expect(refTypeOf('TRANSFER_DISPATCH')).toBe('transfer_out');
    expect(refTypeOf('TRANSFER_RECEIPT')).toBe('transfer_in');
    expect(refTypeOf('STOCKTAKE_ADJUSTMENT')).toBe('stock_take');
    expect(refTypeOf('SALE_COMMIT')).toBe('sale');
    expect(refTypeOf('REVERSAL')).toBe('reversal');
  });

  it('csvCell quotes, doubles quotes and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx'])
      expect(csvCell(bad)).toBe(`"'${bad}"`);
  });

  it('maskPhone keeps the first three and the last two digits', () => {
    expect(maskPhone('028 123 45 36')).toBe('028 ••• •• 36');
    expect(maskPhone('0909123456')).toBe('090•••••56');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('123')).toBe('123');
  });
});
