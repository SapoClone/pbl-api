import { ServiceUnavailableException } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { InventoryClient } from './inventory.client';

const lines = [{ sku: 'AO-01', quantity: 2 }];

describe('InventoryClient', () => {
  let http: { post: jest.Mock; delete: jest.Mock; get: jest.Mock };
  let client: InventoryClient;

  beforeEach(() => {
    http = { post: jest.fn(), delete: jest.fn(), get: jest.fn() };
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

  describe('service token (x-internal-token)', () => {
    const saved = { ...process.env };
    const warehouseReq = {
      callerService: 'sales',
      sourceRefType: 'ORDER',
      sourceRefId: 'o1',
      ttlSeconds: 900,
      lines: [],
    } as never;
    const configOf = (call: unknown[]) =>
      call.find((a) => a && typeof a === 'object' && 'headers' in a) as {
        headers: Record<string, string>;
      };
    const headersOf = (mock: jest.Mock) => configOf(mock.mock.calls[0]).headers;

    afterEach(() => {
      process.env = { ...saved };
    });

    it('sends INTERNAL_S2S_TOKEN on every internal route, and never a tenant header', async () => {
      process.env.INTERNAL_S2S_TOKEN = 's3cret';
      http.post.mockResolvedValue({ status: 200, data: {} });
      http.get.mockResolvedValue({ status: 200, data: {} });
      http.delete.mockResolvedValue({ status: 200, data: {} });

      await client.reserve('o1', 'b1', lines);
      await client.release('o1');
      await client.reserveWarehouseStock('k1', warehouseReq);
      await client.getWarehouseReservation('r1');
      await client.commitWarehouseReservation('r1');
      await client.getWarehouseReservationByKey('k1');
      await client.releaseWarehouseReservation('r1', 'why');

      const calls = [
        ...http.post.mock.calls,
        ...http.get.mock.calls,
        ...http.delete.mock.calls,
      ];
      expect(calls).toHaveLength(7);
      for (const call of calls) {
        const headers = configOf(call).headers;
        expect(headers['x-internal-token']).toBe('s3cret');
        expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(
          'x-tenant-id',
        );
      }
      expect(configOf(http.post.mock.calls[1]).headers).toMatchObject({
        'Idempotency-Key': 'k1',
      });
    });

    it('names the tenant on the warehouse routes: they are @Public, so the callee cannot read it from a token', async () => {
      process.env.INTERNAL_S2S_TOKEN = 's3cret';
      http.post.mockResolvedValue({ status: 200, data: {} });
      http.get.mockResolvedValue({ status: 200, data: {} });

      await TenantContext.run('t-1', async () => {
        await client.reserveWarehouseStock('k1', warehouseReq);
        await client.getWarehouseReservation('r1');
        await client.commitWarehouseReservation('r1');
        await client.getWarehouseReservationByKey('k1');
        await client.releaseWarehouseReservation('r1');
      });

      const calls = [...http.post.mock.calls, ...http.get.mock.calls];
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call[call.length - 1]).toEqual({
          asService: true,
          tenantId: 't-1',
        });
      }
    });

    it('fails closed without the token (503 S005, no call), except under NODE_ENV=test', async () => {
      delete process.env.INTERNAL_S2S_TOKEN;
      process.env.NODE_ENV = 'production';

      const error = await client.reserve('o1', 'b1', lines).catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      await expect(
        client.reserveWarehouseStock('k1', warehouseReq),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(http.post).not.toHaveBeenCalled();

      process.env.NODE_ENV = 'test';
      http.post.mockResolvedValue({ status: 201, data: {} });
      await client.reserve('o1', 'b1', lines);
      expect(headersOf(http.post)).toEqual({});
    });
  });
});
