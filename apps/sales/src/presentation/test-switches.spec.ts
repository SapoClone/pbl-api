import { CheckoutController } from '../modules/checkout/checkout.controller';
import { PosCheckoutDto } from '../modules/checkout/checkout.dto';
import { CheckoutService } from '../modules/checkout/checkout.service';
import { withoutTestSwitches } from './test-switches';

describe('withoutTestSwitches', () => {
  it('drops simulate… fields outside tests and keeps the rest', () => {
    const dto = {
      branchId: 'b1',
      simulateFailureAfterReserve: true,
      simulateFailureAfterCommit: true,
    };
    expect(withoutTestSwitches(dto, { NODE_ENV: 'production' })).toEqual({
      branchId: 'b1',
    });
  });

  it('keeps them under NODE_ENV=test', () => {
    const dto = { simulateFailureAfterReserve: true };
    expect(withoutTestSwitches(dto, { NODE_ENV: 'test' })).toEqual(dto);
  });
});

describe('CheckoutController', () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = saved;
  });

  it('does not pass test switches to the checkout outside tests', async () => {
    process.env.NODE_ENV = 'production';
    const checkout = jest.fn(async () => ({ replayed: false }));
    const controller = new CheckoutController({
      checkout,
    } as unknown as CheckoutService);
    const res = { status: jest.fn(), setHeader: jest.fn() };
    await controller.checkout(
      { id: 'u1', permissions: [] } as never,
      null as never,
      'key-1',
      {
        branchId: 'b1',
        simulateFailureAfterCommit: true,
      } as unknown as PosCheckoutDto,
      res as never,
    );
    const dto = (checkout.mock.calls[0] as unknown[])[4] as Record<
      string,
      unknown
    >;
    expect(dto.branchId).toBe('b1');
    expect(dto).not.toHaveProperty('simulateFailureAfterCommit');
  });
});
