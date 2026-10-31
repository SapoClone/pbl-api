import { moneyTransformer, roundVnd, toMoney } from '../common/money';
import { LazadaProviderAdapter } from './lazada/lazada.adapter';
import { ShopeeProviderAdapter } from './shopee/shopee.adapter';

describe('integer VND money', () => {
  const limiter = {} as never;

  it('rounds half up at the line level and keeps every amount an integer', () => {
    const shopee = new ShopeeProviderAdapter(limiter).normalizeOrderPayload(
      {
        order_sn: 'S1',
        estimated_shipping_fee: 15000.5,
        item_list: [
          {
            item_id: 1,
            model_id: 2,
            model_quantity_purchased: 3,
            model_discounted_price: 99999.5,
            lineDiscount: 0.4,
          },
        ],
      },
      'shop',
    );
    expect(shopee.lines[0].unitPrice).toBe(100000);
    expect(shopee.lines[0].lineDiscount).toBe(0);
    expect(shopee.shippingFee).toBe(15001);
    // total = sum of rounded lines + rounded shipping
    expect(shopee.totalAmount).toBe(3 * 100000 - 0 + 15001);

    const lazada = new LazadaProviderAdapter(limiter).normalizeOrderPayload(
      {
        order_id: 'L1',
        shipping_fee: 10000.49,
        order_items: [
          { product_id: 1, sku_id: 2, quantity: 2, item_price: 50000.5 },
        ],
      },
      'shop',
    );
    expect(lazada.lines[0].unitPrice).toBe(50001);
    expect(lazada.shippingFee).toBe(10000);
    expect(lazada.totalAmount).toBe(2 * 50001 + 10000);
    for (const n of [lazada.totalAmount, lazada.shippingFee]) {
      expect(Number.isSafeInteger(n)).toBe(true);
    }
  });

  it('round-trips bigint strings and fails loudly on unsafe or fractional values', () => {
    expect(moneyTransformer.from('250000')).toBe(250000);
    expect(moneyTransformer.from(null)).toBeNull();
    expect(roundVnd('1234.5')).toBe(1235);
    expect(() => moneyTransformer.from('9007199254740993')).toThrow();
    expect(() => toMoney(1.5)).toThrow();
    expect(() => roundVnd('abc')).toThrow();
  });
});
