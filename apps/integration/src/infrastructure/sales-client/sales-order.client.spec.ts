import { InternalHttpClient } from '@pbl/common';
import { SalesOrderClient } from './sales-order.client';

const cmd = {
  tenantId: 't1',
  connectionId: 'c1',
  provider: 'SHOPEE' as const,
  externalShopId: 's1',
  externalOrderId: 'o1',
  branchId: 'b1',
  warehouseId: null,
  buyerName: 'Buyer',
  currency: 'VND',
  shippingFee: 0,
  paymentMethod: 'COD',
  normalizedStatus: 'READY_TO_SHIP',
  autoConfirm: true,
  lines: [],
  idempotencyKey: 'idem-1',
};

describe('SalesOrderClient', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('calls sales with x-internal-token and the idempotency key', async () => {
    process.env.SALES_SERVICE_URL = 'http://sales:3000/';
    process.env.INTERNAL_S2S_TOKEN = 'tok';
    const post = jest.fn(async () => ({
      data: { order: { id: 'ord-1', code: 'HD1' } },
    }));
    const client = new SalesOrderClient({
      post,
    } as unknown as InternalHttpClient);
    const res = await client.createOrRecoverOmnichannelOrder(cmd);
    expect(res.internalOrderId).toBe('ord-1');
    const [url, , config, options] = post.mock.calls[0] as unknown as any[];
    expect(url).toBe('http://sales:3000/internal/v1/orders/omnichannel');
    expect(config.headers['x-internal-token']).toBe('tok');
    expect(config.headers['Idempotency-Key']).toBe('idem-1');
    expect(options).toEqual({ asService: true, tenantId: cmd.tenantId });
  });

  it('sends money to sales as JSON numbers', async () => {
    process.env.SALES_SERVICE_URL = 'http://sales:3000/';
    process.env.INTERNAL_S2S_TOKEN = 'tok';
    const post = jest.fn(async () => ({
      data: { order: { id: 'o', code: 'c' } },
    }));
    const client = new SalesOrderClient({
      post,
    } as unknown as InternalHttpClient);
    await client.createOrRecoverOmnichannelOrder({
      ...cmd,
      shippingFee: 30000,
      lines: [
        {
          variantId: 'v1',
          skuCode: 'S',
          itemName: 'n',
          quantity: 2,
          unitPrice: 250000,
          lineDiscount: 0,
        },
      ],
    });
    const [, body] = post.mock.calls[0] as unknown as any[];
    expect(body.shippingFee).toBe(30000);
    expect(body.lines[0].unitPriceOverride).toBe(250000);
  });

  it('fails clearly, with no in-memory fallback, when SALES_SERVICE_URL is unset', async () => {
    delete process.env.SALES_SERVICE_URL;
    process.env.INTERNAL_S2S_TOKEN = 'tok';
    const post = jest.fn();
    const client = new SalesOrderClient({
      post,
    } as unknown as InternalHttpClient);
    await expect(client.createOrRecoverOmnichannelOrder(cmd)).rejects.toThrow(
      'SALES_SERVICE_URL',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('does not leak the service token in a rethrown HTTP error', async () => {
    process.env.SALES_SERVICE_URL = 'http://sales:3000';
    process.env.INTERNAL_S2S_TOKEN = 'tok';
    const err: any = new Error('boom');
    err.config = {
      headers: {
        'x-internal-token': 'tok',
        post: { 'X-Internal-Token': 'tok' },
      },
    };
    const client = new SalesOrderClient({
      post: jest.fn().mockRejectedValue(err),
    } as unknown as InternalHttpClient);
    await expect(client.createOrRecoverOmnichannelOrder(cmd)).rejects.toBe(err);
    expect(JSON.stringify(err.config)).not.toContain('tok');
  });
});
