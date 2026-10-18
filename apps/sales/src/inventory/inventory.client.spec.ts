import { ServiceUnavailableException } from '@nestjs/common';
import { InventoryClient } from './inventory.client';

const lines = [{ sku: 'AO-01', quantity: 2 }];

describe('InventoryClient', () => {
  let http: { post: jest.Mock; delete: jest.Mock };
  let client: InventoryClient;

  beforeEach(() => {
    http = { post: jest.fn(), delete: jest.fn() };
    client = new InventoryClient(http as never);
  });

  it('sends the hold to the internal route with a short timeout', async () => {
    http.post.mockResolvedValue({ status: 201, data: {} });

    await client.reserve('o1', 'b1', lines);

    expect(http.post).toHaveBeenCalledWith(
      '/internal/reservations',
      { orderId: 'o1', branchId: 'b1', lines },
      expect.objectContaining({ timeout: 3000 }),
    );
  });

  it.each([[201], [200]])(
    'answers null when the stock is held (%i)',
    async (status) => {
      http.post.mockResolvedValue({ status, data: {} });

      await expect(client.reserve('o1', 'b1', lines)).resolves.toBeNull();
    },
  );

  it('answers the shortages on a 409', async () => {
    const details = [{ sku: 'AO-01', requested: 2, available: 1 }];
    http.post.mockResolvedValue({ status: 409, data: { details } });

    await expect(client.reserve('o1', 'b1', lines)).resolves.toEqual(details);
  });

  it('refuses the sale (503 S005) when inventory is down, and on any other answer', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    http.post.mockResolvedValueOnce({ status: 403, data: {} });

    for (let i = 0; i < 2; i++) {
      const error = await client.reserve('o1', 'b1', lines).catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getResponse()).toMatchObject({ errorCode: 'S005' });
    }
  });

  describe('breaker', () => {
    const failFive = async () => {
      http.post.mockRejectedValue(new Error('down'));
      for (let i = 0; i < 5; i++)
        await client.reserve('o', 'b', lines).catch(() => null);
    };

    it('stops calling inventory after 5 failures in a row, then tries again', async () => {
      jest.useFakeTimers();
      try {
        await failFive();
        http.post.mockClear();

        await expect(client.reserve('o', 'b', lines)).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(http.post).not.toHaveBeenCalled(); // failed fast, no call

        jest.advanceTimersByTime(10_001);
        http.post.mockResolvedValue({ status: 201, data: {} });
        await expect(client.reserve('o', 'b', lines)).resolves.toBeNull();
        expect(http.post).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not open for failures that are not in a row', async () => {
      for (let round = 0; round < 3; round++) {
        http.post.mockRejectedValue(new Error('down'));
        for (let i = 0; i < 4; i++)
          await client.reserve('o', 'b', lines).catch(() => null);
        http.post.mockResolvedValue({ status: 201, data: {} });
        await client.reserve('o', 'b', lines); // a success resets the count
      }
      http.post.mockResolvedValue({ status: 201, data: {} });
      await expect(client.reserve('o', 'b', lines)).resolves.toBeNull();
    });
  });

  it('release never throws: the hold expires by itself', async () => {
    http.delete.mockRejectedValue(new Error('down'));

    await expect(client.release('o1')).resolves.toBeUndefined();
    expect(http.delete).toHaveBeenCalledWith(
      '/internal/reservations/o1',
      expect.objectContaining({ timeout: 3000 }),
    );
  });
});
