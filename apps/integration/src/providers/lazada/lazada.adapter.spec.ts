import { createHmac } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  IntegrationDomainErrorCode,
  computeLazadaApiSignature,
  createOAuthStateToken,
  verifyOAuthStateToken,
} from '../../domain/integration-domain';
import { ProviderRateLimiterService } from '../../infrastructure/rate-limiting/provider-rate-limiter.service';
import { LazadaHttpClient, redactLazadaQueryUrl } from './lazada-http.client';
import { LazadaProviderAdapter } from './lazada.adapter';

describe('LazadaHttpClient & LazadaProviderAdapter (Signing & Open Platform Contract Suite)', () => {
  const APP_KEY = '128901';
  const APP_SECRET = 'lazada_sandbox_app_secret_key_998877';
  const ACCESS_TOKEN = '50000900a18x7766554433221100lazadasandboxtoken';
  const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const SHOP_ID = 'VN-LAZADA-SANDBOX-01';

  let mockServer: http.Server;
  let baseUrl: string;
  let recordedRequests: Array<{
    pathname: string;
    query: Record<string, string>;
  }> = [];
  let nextErrorResponse: {
    httpStatus?: number;
    headers?: Record<string, string>;
    body: Record<string, unknown>;
  } | null = null;

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const apiPath = parsedUrl.pathname.replace(/^\/rest(?=\/)/, '');
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      recordedRequests.push({
        pathname: apiPath,
        query,
      });

      if (nextErrorResponse) {
        const errSpec = nextErrorResponse;
        nextErrorResponse = null;
        res.writeHead(errSpec.httpStatus ?? 200, {
          'Content-Type': 'application/json',
          ...(errSpec.headers ?? {}),
        });
        res.end(JSON.stringify(errSpec.body));
        return;
      }

      // Verify official Lazada HMAC-SHA256 signature on every incoming request
      // Note: Lazada signs `apiPath` (e.g. `/orders/get`) without the `/rest` mount prefix.
      const expectedSign = computeLazadaApiSignature({
        appSecret: APP_SECRET,
        apiPath,
        queryParams: query,
      });

      const isAuthEndpoint =
        apiPath === '/auth/token/create' || apiPath === '/auth/token/refresh';

      if (
        query.app_key !== APP_KEY ||
        (!isAuthEndpoint && query.access_token !== ACCESS_TOKEN) ||
        query.sign_method !== 'sha256' ||
        query.sign !== expectedSign
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 'IncompleteSignature',
            type: 'ISV',
            message:
              'The request signature does not conform to Lazada standards',
            request_id: 'req-sig-fail-001',
          }),
        );
        return;
      }

      if (apiPath === '/orders/get') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: 'lzd-req-orders-get-001',
            data: {
              count: 2,
              countTotal: 2,
              orders: [
                {
                  order_id: 2611080000101,
                  order_number: 2611080000101,
                  statuses: ['ready_to_ship'],
                  price: '350,000.00',
                  shipping_fee: '25000.00',
                  payment_method: 'COD',
                  customer_first_name: 'Tran',
                  customer_last_name: 'Thi B',
                  created_at: '2026-11-08 09:00:00 +0700',
                  updated_at: '2026-11-08 09:15:00 +0700',
                },
                {
                  order_id: 2611080000102,
                  order_number: 2611080000102,
                  statuses: ['delivered'],
                  price: '190000.00',
                  shipping_fee: 0,
                  payment_method: 'LAZPAY',
                  customer_first_name: 'Le',
                  customer_last_name: 'Minh C',
                  created_at: '2026-11-07 14:00:00 +0700',
                  updated_at: '2026-11-08 09:30:00 +0700',
                },
              ],
            },
          }),
        );
        return;
      }

      if (apiPath === '/order/get') {
        const orderId = query.order_id;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: 'lzd-req-order-get-001',
            data: {
              order_id: Number(orderId),
              order_number: Number(orderId),
              statuses: ['ready_to_ship'],
              price: '350000.00',
              shipping_fee: 25000,
              payment_method: 'COD',
              customer_first_name: 'Tran',
              customer_last_name: 'Thi B',
              created_at: '2026-11-08 09:00:00 +0700',
              updated_at: '2026-11-08 09:15:00 +0700',
            },
          }),
        );
        return;
      }

      if (apiPath === '/order/items/get') {
        const orderId = query.order_id;
        if (orderId === '2611080000101') {
          // Lazada returns 2 separate item rows for 2 units of the same SKU
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: '0',
              request_id: 'lzd-req-items-101',
              data: [
                {
                  order_item_id: 90001,
                  order_id: 2611080000101,
                  shop_id: SHOP_ID,
                  product_id: 'LZD-PROD-101',
                  sku_id: 'LZD-SKU-101',
                  sku: 'TEE-BASIC-BLK-M',
                  name: 'Áo Thun Basic Đen M',
                  item_price: '175000.00',
                  paid_price: '170000.00',
                  voucher_amount: '5000.00',
                  currency: 'VND',
                  status: 'ready_to_ship',
                },
                {
                  order_item_id: 90002,
                  order_id: 2611080000101,
                  shop_id: SHOP_ID,
                  product_id: 'LZD-PROD-101',
                  sku_id: 'LZD-SKU-101',
                  sku: 'TEE-BASIC-BLK-M',
                  name: 'Áo Thun Basic Đen M',
                  item_price: '175000.00',
                  paid_price: '170000.00',
                  voucher_amount: '5000.00',
                  currency: 'VND',
                  status: 'ready_to_ship',
                },
              ],
            }),
          );
          return;
        }

        if (orderId === '2611080000102') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: '0',
              request_id: 'lzd-req-items-102',
              data: [
                {
                  order_item_id: 90003,
                  order_id: 2611080000102,
                  shop_id: SHOP_ID,
                  product_id: 'LZD-PROD-102',
                  sku_id: 'LZD-SKU-102',
                  sku: 'CAP-CLASSIC-NVY',
                  name: 'Nón Lưỡi Trai Classic Navy',
                  item_price: '190000.00',
                  paid_price: '190000.00',
                  voucher_amount: '0.00',
                  currency: 'VND',
                  status: 'delivered',
                },
              ],
            }),
          );
          return;
        }
      }

      if (apiPath === '/auth/token/create') {
        const authCode = query.code;
        if (!authCode || authCode === 'expired_code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 'IllegalCode',
              type: 'ISV',
              message: 'The authorization code is invalid or expired',
              request_id: 'lzd-req-auth-err',
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: 'lzd-req-token-create-1',
            access_token: 'lzd_live_access_token_001',
            refresh_token: 'lzd_live_refresh_token_001',
            expires_in: 604800,
            refresh_expires_in: 2592000,
            account: 'seller.vn@lazada.sandbox',
            country: 'vn',
            country_user_info: [
              {
                country: 'vn',
                user_id: '10009988',
                seller_id: SHOP_ID,
                short_code: 'VN109988',
              },
            ],
          }),
        );
        return;
      }

      if (apiPath === '/auth/token/refresh') {
        const refreshToken = query.refresh_token;
        if (!refreshToken || refreshToken === 'revoked_rt') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 'IllegalRefreshToken',
              type: 'ISV',
              message: 'The refresh token is invalid or expired',
              request_id: 'lzd-req-refresh-err',
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: 'lzd-req-token-refresh-1',
            access_token: 'lzd_live_access_token_002_rotated',
            refresh_token: 'lzd_live_refresh_token_002_rotated',
            expires_in: 604800,
            refresh_expires_in: 2592000,
            account: 'seller.vn@lazada.sandbox',
            country: 'vn',
            country_user_info: [
              {
                country: 'vn',
                user_id: '10009988',
                seller_id: SHOP_ID,
                short_code: 'VN109988',
              },
            ],
          }),
        );
        return;
      }

      if (apiPath === '/products/get') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: 'lzd-req-products-get-001',
            data: {
              total_products: 1,
              products: [
                {
                  item_id: 99001122,
                  attributes: {
                    name: 'Áo Thun Basic Đen',
                  },
                  skus: [
                    {
                      SkuId: 88001122,
                      ShopSku: '99001122_VNAMZ-88001122',
                      SellerSku: 'TEE-BASIC-BLK-M',
                      price: '175000.00',
                      quantity: 42,
                      Status: 'active',
                    },
                  ],
                },
              ],
            },
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: '404', message: 'Not Found' }));
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/rest`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  beforeEach(() => {
    recordedRequests = [];
    nextErrorResponse = null;
  });

  it('computes official Lazada Open Platform HMAC-SHA256 uppercase hex signature over sorted ASCII keys', () => {
    const client = new LazadaHttpClient({
      apiBaseUrl: 'https://api.lazada.vn/rest',
      liveEnabled: true,
    });
    const signed = client.buildSignedRequest({
      apiPath: '/orders/get',
      appKey: APP_KEY,
      appSecret: APP_SECRET,
      accessToken: ACCESS_TOKEN,
      timestampMs: 1762600000000,
      businessParams: {
        update_after: '2026-11-08T00:00:00.000Z',
        limit: 50,
        offset: 0,
      },
    });

    // Expected base string:
    // /orders/get + access_token... + app_key... + limit50 + offset0 + sign_methodsha256 + timestamp1762600000000 + update_after2026-11-08T00:00:00.000Z
    const expectedBaseString =
      `/orders/get` +
      `access_token${ACCESS_TOKEN}` +
      `app_key${APP_KEY}` +
      `limit50` +
      `offset0` +
      `sign_methodsha256` +
      `timestamp1762600000000` +
      `update_after2026-11-08T00:00:00.000Z`;
    const expectedHex = createHmac('sha256', APP_SECRET)
      .update(expectedBaseString, 'utf8')
      .digest('hex')
      .toUpperCase();

    expect(signed.sign).toBe(expectedHex);
    expect(signed.sign).toMatch(/^[0-9A-F]{64}$/);
    expect(signed.redactedUrl).not.toContain(ACCESS_TOKEN);
    expect(signed.redactedUrl).not.toContain(signed.sign);
    expect(redactLazadaQueryUrl(signed.url)).toContain(
      'access_token=[REDACTED]',
    );
  });

  it('polls GetOrders (/orders/get) and GetOrderItems (/order/items/get) with valid HMAC-SHA256 signatures and normalizes multi-unit items', async () => {
    const httpClient = new LazadaHttpClient({
      apiBaseUrl: baseUrl,
      liveEnabled: true,
    });
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter, httpClient);

    const windowStart = new Date('2026-11-08T00:00:00.000Z');
    const windowEnd = new Date('2026-11-08T12:00:00.000Z');

    const result = await adapter.pollUpdatedOrders({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      externalShopId: SHOP_ID,
      windowStart,
      windowEnd,
      accessToken: ACCESS_TOKEN,
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(result.orders).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(recordedRequests.map((r) => r.pathname)).toEqual([
      '/orders/get',
      '/order/items/get',
      '/order/items/get',
    ]);

    // First order: 2 item rows for LZD-SKU-101 consolidated into quantity=2, lineDiscount=10000
    const order1 = result.orders[0];
    expect(order1.externalOrderId).toBe('2611080000101');
    expect(order1.normalizedStatus).toBe('READY_TO_SHIP');
    expect(order1.buyerName).toBe('Tran Thi B');
    expect(order1.shippingFee).toBe(25000);
    expect(order1.totalAmount).toBe(350000);
    expect(order1.lines).toHaveLength(1);
    expect(order1.lines[0]).toEqual({
      externalItemId: 'LZD-PROD-101',
      externalSkuId: 'LZD-SKU-101',
      externalSkuCode: 'TEE-BASIC-BLK-M',
      itemName: 'Áo Thun Basic Đen M',
      quantity: 2,
      unitPrice: 175000,
      lineDiscount: 10000,
    });

    // Second order: historical DELIVERED order
    const order2 = result.orders[1];
    expect(order2.externalOrderId).toBe('2611080000102');
    expect(order2.normalizedStatus).toBe('DELIVERED');
    expect(order2.buyerName).toBe('Le Minh C');
    expect(order2.lines).toHaveLength(1);
    expect(order2.lines[0].quantity).toBe(1);
    expect(order2.lines[0].unitPrice).toBe(190000);
  });

  it('fetches single order details via GetOrder (/order/get) + GetOrderItems (/order/items/get)', async () => {
    const httpClient = new LazadaHttpClient({
      apiBaseUrl: baseUrl,
      liveEnabled: true,
    });
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter, httpClient);

    const order = await adapter.fetchOrderDetails({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      externalShopId: SHOP_ID,
      externalOrderId: '2611080000101',
      accessToken: ACCESS_TOKEN,
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(order.externalOrderId).toBe('2611080000101');
    expect(order.normalizedStatus).toBe('READY_TO_SHIP');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].quantity).toBe(2);
  });

  it('maps Lazada IllegalAccessToken and rate-limit responses to canonical IntegrationDomainError codes', async () => {
    const httpClient = new LazadaHttpClient({
      apiBaseUrl: baseUrl,
      liveEnabled: true,
    });
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter, httpClient);

    nextErrorResponse = {
      httpStatus: 200,
      body: {
        code: 'IllegalAccessToken',
        type: 'ISV',
        message: 'The specified access token is invalid or expired',
        request_id: 'req-err-token-1',
      },
    };

    await expect(
      adapter.pollUpdatedOrders({
        tenantId: TENANT_ID,
        connectionId: CONNECTION_ID,
        externalShopId: SHOP_ID,
        windowStart: new Date('2026-11-08T00:00:00.000Z'),
        windowEnd: new Date('2026-11-08T12:00:00.000Z'),
        accessToken: ACCESS_TOKEN,
        partnerId: APP_KEY,
        partnerSecret: APP_SECRET,
      }),
    ).rejects.toMatchObject({
      code: IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
      httpStatus: 401,
    });

    nextErrorResponse = {
      httpStatus: 429,
      headers: { 'Retry-After': '5' },
      body: {
        code: 'ApiCallLimit',
        message: 'Call limit exceeded',
      },
    };

    await expect(
      adapter.pollUpdatedOrders({
        tenantId: TENANT_ID,
        connectionId: CONNECTION_ID,
        externalShopId: SHOP_ID,
        windowStart: new Date('2026-11-08T00:00:00.000Z'),
        windowEnd: new Date('2026-11-08T12:00:00.000Z'),
        accessToken: ACCESS_TOKEN,
        partnerId: APP_KEY,
        partnerSecret: APP_SECRET,
      }),
    ).rejects.toMatchObject({
      code: IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
      httpStatus: 429,
    });
  });

  it('builds Lazada seller authorization URL and exchanges authorization code + refreshes tokens via signed /auth/token/create and /auth/token/refresh', async () => {
    const httpClient = new LazadaHttpClient({
      apiBaseUrl: baseUrl,
      authBaseUrl: baseUrl,
      liveEnabled: true,
    });
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter, httpClient);

    const authUrlRes = adapter.buildAuthorizationUrl({
      connectionId: CONNECTION_ID,
      externalShopId: SHOP_ID,
      redirectUri: 'https://app.sapoclone.local/integrations/lazada/callback',
      stateNonce: 'st_test_nonce_123',
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(authUrlRes.authorizationUrl).toContain(
      'https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true',
    );
    expect(authUrlRes.authorizationUrl).toContain(`client_id=${APP_KEY}`);
    expect(authUrlRes.authorizationUrl).toContain('state=st_test_nonce_123');
    expect(authUrlRes.authorizationUrl).toContain(
      encodeURIComponent(
        'https://app.sapoclone.local/integrations/lazada/callback',
      ),
    );

    const exchanged = await adapter.exchangeAuthorizationCode({
      connectionId: CONNECTION_ID,
      code: '0_128990_real_auth_code_xyz',
      externalShopId: SHOP_ID,
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(exchanged.accessToken).toBe('lzd_live_access_token_001');
    expect(exchanged.refreshToken).toBe('lzd_live_refresh_token_001');
    expect(exchanged.externalShopId).toBe(SHOP_ID);
    expect(exchanged.liveMode).toBe(true);
    expect(exchanged.accessTokenExpiresAt.getTime()).toBeGreaterThan(
      Date.now() + 600_000 * 1000,
    );

    const refreshed = await adapter.refreshAccessToken({
      connectionId: CONNECTION_ID,
      externalShopId: SHOP_ID,
      refreshToken: exchanged.refreshToken,
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(refreshed.accessToken).toBe('lzd_live_access_token_002_rotated');
    expect(refreshed.refreshToken).toBe('lzd_live_refresh_token_002_rotated');
    expect(refreshed.liveMode).toBe(true);

    expect(recordedRequests.map((r) => r.pathname)).toEqual([
      '/auth/token/create',
      '/auth/token/refresh',
    ]);
  });

  it('fetches external product listings via signed GetProducts (/products/get) and retries transient HTTP 503 on read-only endpoints', async () => {
    const httpClient = new LazadaHttpClient({
      apiBaseUrl: baseUrl,
      liveEnabled: true,
      retryDelayMs: 1,
    });
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter, httpClient);

    // Inject one transient 503 error before /products/get succeeds on retry
    nextErrorResponse = {
      httpStatus: 503,
      body: { code: '503', message: 'Upstream temporarily unavailable' },
    };

    const listings = await adapter.fetchExternalListings({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      externalShopId: SHOP_ID,
      accessToken: ACCESS_TOKEN,
      partnerId: APP_KEY,
      partnerSecret: APP_SECRET,
    });

    expect(recordedRequests.map((r) => r.pathname)).toEqual([
      '/products/get',
      '/products/get',
    ]);
    expect(listings).toEqual([
      {
        externalItemId: '99001122',
        externalSkuId: '88001122',
        externalSkuCode: 'TEE-BASIC-BLK-M',
        externalProductName: 'Áo Thun Basic Đen',
        price: 175000,
        stock: 42,
        status: 'ACTIVE',
      },
    ]);
  });

  it('signs and verifies Lazada OAuth state tokens (HMAC-SHA256) and rejects missing, tampered, or expired state tokens', () => {
    const secret = 'lazada_oauth_state_secret_for_unit_test_32b';
    const nowMs = 1762600000000;
    const created = createOAuthStateToken({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      actorId: 'user-owner-1',
      nowMs,
      ttlMs: 600_000,
      secret,
    });

    const verified = verifyOAuthStateToken({
      stateToken: created.stateToken,
      nowMs: nowMs + 60_000,
      secret,
    });
    expect(verified.payload.tenantId).toBe(TENANT_ID);
    expect(verified.payload.connectionId).toBe(CONNECTION_ID);
    expect(verified.payload.actorId).toBe('user-owner-1');
    expect(verified.stateHash).toBe(created.stateHash);

    // Missing state
    expect(() => verifyOAuthStateToken({ stateToken: '', secret })).toThrow(
      expect.objectContaining({
        code: IntegrationDomainErrorCode.OAUTH_STATE_MISSING,
        httpStatus: 400,
      }),
    );

    // Tampered state
    expect(() =>
      verifyOAuthStateToken({
        stateToken: `${created.stateToken}tampered`,
        secret,
      }),
    ).toThrow(
      expect.objectContaining({
        code: IntegrationDomainErrorCode.OAUTH_STATE_INVALID,
        httpStatus: 400,
      }),
    );

    // Expired state
    expect(() =>
      verifyOAuthStateToken({
        stateToken: created.stateToken,
        nowMs: nowMs + 600_001,
        secret,
      }),
    ).toThrow(
      expect.objectContaining({
        code: IntegrationDomainErrorCode.OAUTH_STATE_EXPIRED,
        httpStatus: 400,
      }),
    );
  });

  it('normalizes real Lazada VN Open Platform order payloads (statuses=["confirmed"], display shop_id, and shop_sku <item_id>_VNAMZ-<sku_id>)', () => {
    const rateLimiter = new ProviderRateLimiterService({
      transaction: jest.fn(),
    } as any);
    const adapter = new LazadaProviderAdapter(rateLimiter);

    const normalized = adapter.normalizeOrderPayload(
      {
        order_id: 533941276780318,
        order_number: 533941276780318,
        statuses: ['confirmed'],
        price: '32000.00',
        shipping_fee: 0,
        payment_method: 'COD',
        customer_first_name: 'C***********t',
        customer_last_name: '',
        created_at: '2026-11-09 10:15:36 +0700',
        updated_at: '2026-11-11 13:32:17 +0700',
        order_items: [
          {
            order_item_id: 533942946780318,
            order_id: 533941276780318,
            shop_id: 'Ngô gia phát 111',
            shop_sku: '13504402059_VNAMZ-117553898643',
            sku: 'OPS250220260007',
            name: 'New Product Ops250220260007',
            item_price: 32000,
            paid_price: 32000,
            voucher_amount: 0,
            currency: 'VND',
            status: 'confirmed',
          },
        ],
      },
      'VN33WH4M4S',
    );

    expect(normalized.externalShopId).toBe('VN33WH4M4S');
    expect(normalized.externalOrderId).toBe('533941276780318');
    expect(normalized.externalStatus).toBe('confirmed');
    expect(normalized.normalizedStatus).toBe('READY_TO_SHIP');
    expect(normalized.lines).toEqual([
      {
        externalItemId: '13504402059',
        externalSkuId: '117553898643',
        externalSkuCode: 'OPS250220260007',
        itemName: 'New Product Ops250220260007',
        quantity: 1,
        unitPrice: 32000,
        lineDiscount: 0,
      },
    ]);
  });
});
