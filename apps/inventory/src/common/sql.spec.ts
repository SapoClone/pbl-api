import { Where, csvField, formatCode, likePattern, pageOf, toCsv } from './sql';

describe('sql helpers', () => {
  it('formats readable codes (D4)', () => {
    expect(formatCode('PO', 127, 5)).toBe('PO00127');
    expect(formatCode('NCC', 3, 4)).toBe('NCC0003');
    expect(formatCode('DC', 123456, 5)).toBe('DC123456');
  });

  it('numbers placeholders in order, including date ranges', () => {
    const where = new Where()
      .add('"tenant_id" = ?', 't')
      .add('"a" = ? AND "b" = ?', 1, 2)
      .dateRange('"created_at"', '2026-10-01', '2026-10-31');
    expect(where.params).toEqual(['t', 1, 2, '2026-10-01', '2026-10-31']);
    expect(where.sql).toContain('"tenant_id" = $1 AND "a" = $2 AND "b" = $3');
    expect(where.sql).toContain('>= ($4::date)');
    expect(where.sql).toContain('(($5::date) + 1)');
    expect(where.sql).toContain('Asia/Ho_Chi_Minh');
    expect(new Where().sql).toBe('');
  });

  it('pages: nextPage only when there is one', () => {
    expect(pageOf([1], 25, 1, 10).pagination).toEqual({
      limit: 10,
      currentPage: 1,
      nextPage: 2,
      totalRecords: 25,
      totalPages: 3,
    });
    expect(pageOf([], 0, 1, 10).pagination).not.toHaveProperty('nextPage');
    expect(pageOf([], 25, 3, 10).pagination.totalPages).toBe(3);
  });

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['-5', '-5'],
    [null, ''],
    [12, '12'],
  ])('csv field %p', (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  it('builds CSV with CRLF rows', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
