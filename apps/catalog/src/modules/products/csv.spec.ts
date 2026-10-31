import { csvCell, csvRow, parseCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvRow(['a,b', 'say "hi"', 'x\ny', 1, null])).toBe(
      '"a,b","say ""hi""","x\ny",1,',
    );
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
    'guards formula start %j',
    (value) => {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('does not touch numbers, including negative ones', () => {
    expect(csvCell(-5)).toBe('-5');
  });

  it('parses BOM, CRLF, quoted fields and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['last', ''],
    ]);
  });
});
