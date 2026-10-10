import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OffsetPaginationDto } from './offset-pagination.dto';
import { PageOptionsDto } from './page-options.dto';

const pageOptions = (page: number, limit: number) =>
  plainToInstance(PageOptionsDto, { page, limit });

describe('OffsetPaginationDto', () => {
  it('should point to the next page from the first of several pages', () => {
    const meta = new OffsetPaginationDto(18, pageOptions(1, 2));

    expect(meta).toMatchObject({
      limit: 2,
      currentPage: 1,
      nextPage: 2,
      totalRecords: 18,
      totalPages: 9,
    });
    expect(meta.previousPage).toBeUndefined();
  });

  it('should point both ways from a middle page', () => {
    const meta = new OffsetPaginationDto(18, pageOptions(5, 2));

    expect(meta.previousPage).toBe(4);
    expect(meta.nextPage).toBe(6);
  });

  it('should have no next page on the last page', () => {
    const meta = new OffsetPaginationDto(18, pageOptions(9, 2));

    expect(meta.previousPage).toBe(8);
    expect(meta.nextPage).toBeUndefined();
  });

  it('should have neither when everything fits on one page', () => {
    const meta = new OffsetPaginationDto(3, pageOptions(1, 10));

    expect(meta.totalPages).toBe(1);
    expect(meta.nextPage).toBeUndefined();
    expect(meta.previousPage).toBeUndefined();
  });
});

describe('PageOptionsDto', () => {
  it('should accept limit 100', async () => {
    expect(await validate(pageOptions(1, 100))).toHaveLength(0);
  });

  it('should reject a limit above 100', async () => {
    const errors = await validate(pageOptions(1, 101));

    expect(errors.map((e) => e.property)).toContain('limit');
  });
});
