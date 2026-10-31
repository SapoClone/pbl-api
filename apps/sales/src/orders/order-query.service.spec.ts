import { TenantContext } from '@pbl/common';
import {
  csvCell,
  EXPORT_LIMIT,
  OrderQueryService,
} from './order-query.service';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['@cmd', "'@cmd"],
    [-5000, '-5000'],
    [null, ''],
    ['two\nlines', '"two\nlines"'],
  ])('%j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe('OrderQueryService.exportCsv', () => {
  it(`refuses more than ${EXPORT_LIMIT} rows with 422 S020 and reads none`, async () => {
    const orders = {
      count: jest.fn().mockResolvedValue(EXPORT_LIMIT + 1),
      find: jest.fn(),
    };
    const service = new OrderQueryService(orders as never);
    await expect(
      TenantContext.run('t1', () => service.exportCsv({})),
    ).rejects.toMatchObject({ response: { errorCode: 'S020' }, status: 422 });
    expect(orders.find).not.toHaveBeenCalled();
  });
});
