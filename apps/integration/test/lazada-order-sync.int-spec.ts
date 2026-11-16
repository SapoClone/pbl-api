import { HttpService } from '@nestjs/axios';
import { InternalHttpClient, RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { createHash, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { computeLazadaApiSignature } from '../src/domain/integration-domain';
import {
  ChannelOrderRefEntity,
  ConnectionCredentialEntity,
  IntegrationCatalogVariantEntity,
  IntegrationStockProjectionEntity,
  M6_INTEGRATION_ENTITIES,
  SyncConflictEntity,
  SyncCursorEntity,
  SyncJobEntity,
} from '../src/infrastructure/persistence/integration.entities';
import { ProviderRateLimiterService } from '../src/infrastructure/rate-limiting/provider-rate-limiter.service';
import { SalesOrderClient } from '../src/infrastructure/sales-client/sales-order.client';
import { CreateM6IntegrationCore1791900000200 } from '../src/migrations/1791900000200-create-m6-integration-core';
import { AllowSyncJobSchedulerSelect1792500000000 } from '../src/migrations/1792500000000-allow-sync-job-scheduler-select';
import { CreateTenantStatus1793100000420 } from '../src/migrations/1793100000420-create-tenant-status';
import { BranchScopeService } from '../src/modules/branch-scope/branch-scope.service';
import { ConflictsService } from '../src/modules/conflicts/conflicts.service';
import { ConnectionsService } from '../src/modules/connections/connections.service';
import { InventorySyncService } from '../src/modules/inventory-sync/inventory-sync.service';
import { OrderSyncService } from '../src/modules/order-sync/order-sync.service';
import { SkuMappingService } from '../src/modules/sku-mapping/sku-mapping.service';
import { SyncJobsController } from '../src/modules/sync-jobs/sync-jobs.controller';
import { SyncJobsService } from '../src/modules/sync-jobs/sync-jobs.service';
import { LazadaHttpClient } from '../src/providers/lazada/lazada-http.client';
import { LazadaProviderAdapter } from '../src/providers/lazada/lazada.adapter';
import { ProviderRegistryService } from '../src/providers/provider-registry.service';
import { ShopeeProviderAdapter } from '../src/providers/shopee/shopee.adapter';
import { TenantStatusEntity } from '../src/tenant-status/tenant-status.entity';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const WAREHOUSE_A = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a';
const ACTOR_OWNER = '11111111-1111-4111-8111-111111111111';

const LAZADA_APP_KEY = '128999';
const LAZADA_APP_SECRET = 'lzd_sandbox_secret_vertical_slice_2026';
const LAZADA_ACCESS_TOKEN = '50000900b22x998877665544332211lazadatoken';
const LAZADA_REFRESH_TOKEN = '50001900r33x112233445566778899lazadarefresh';
const LAZADA_SHOP_ID = 'VN-LZD-SANDBOX-SHOP-01';
const INTERNAL_S2S_SECRET = 'test-internal-s2s-token-lazada-slice';

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function runAsTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
  actorId = ACTOR_OWNER,
): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId,
      actor: { id: actorId, type: 'account' },
    },
    fn,
  );
}

describe('Lazada Sandbox Order Synchronization Vertical Slice (Real PostgreSQL + Signed Lazada HTTP + Sales HTTP Contract Suite)', () => {
  const schema = uniqueSchema('lazada_order_sync_it');
  let dataSource: DataSource;
  let outbox: EventOutbox;
  let rateLimiter: ProviderRateLimiterService;
  let lazadaHttpClient: LazadaHttpClient;
  let lazadaAdapter: LazadaProviderAdapter;
  let shopeeAdapter: ShopeeProviderAdapter;
  let providerRegistry: ProviderRegistryService;
  let salesOrderClient: SalesOrderClient;
  let connectionsService: ConnectionsService;
  let skuMappingService: SkuMappingService;
  let orderSyncService: OrderSyncService;
  let inventorySyncService: InventorySyncService;
  let syncJobsService: SyncJobsService;
  let syncJobsController: SyncJobsController;
  let conflictsService: ConflictsService;

  // Local Lazada Sandbox Open Platform HTTP Server
  let lazadaServer: http.Server;
  let lazadaBaseUrl: string;
  const sandboxOrdersById = new Map<string, Record<string, any>>();
  const sandboxItemsByOrderId = new Map<string, Array<Record<string, any>>>();
  let lazadaSignedCalls: Array<{
    apiPath: string;
    query: Record<string, string>;
  }> = [];

  // Local Sales Internal HTTP Contract Server (`POST /internal/v1/orders/omnichannel`)
  let salesServer: http.Server;
  let salesBaseUrl: string;
  const salesOrdersByKey = new Map<
    string,
    {
      id: string;
      code: string;
      orderStatus: string;
      fulfillmentStatus: string;
      autoConfirm: boolean;
      lines: Array<{
        variantId: string;
        qty: number;
        unitPriceOverride: number;
      }>;
    }
  >();
  let salesHttpCalls: Array<{
    headers: http.IncomingHttpHeaders;
    body: Record<string, any>;
  }> = [];
  const simulatedWarehouseReservedByVariant = new Map<string, number>();

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIAL_MASTER_KEY =
      'test-only-integration-master-key-0123456789';
    process.env.INTERNAL_S2S_TOKEN = INTERNAL_S2S_SECRET;

    // 1. Start Lazada Sandbox Open Platform HTTP Server
    lazadaServer = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const apiPath = parsedUrl.pathname.replace(/^\/rest(?=\/)/, '');
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      lazadaSignedCalls.push({ apiPath, query });

      const expectedSign = computeLazadaApiSignature({
        appSecret: LAZADA_APP_SECRET,
        apiPath,
        queryParams: query,
      });

      const isAuthEndpoint =
        apiPath === '/auth/token/create' || apiPath === '/auth/token/refresh';

      if (
        query.app_key !== LAZADA_APP_KEY ||
        (!isAuthEndpoint && query.access_token !== LAZADA_ACCESS_TOKEN) ||
        query.sign_method !== 'sha256' ||
        query.sign !== expectedSign
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 'IncompleteSignature',
            type: 'ISV',
            message: 'Lazada HMAC-SHA256 signature verification failed',
            request_id: `lzd-err-${randomUUID().slice(0, 8)}`,
          }),
        );
        return;
      }

      if (apiPath === '/auth/token/create') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: `lzd-auth-create-${randomUUID().slice(0, 8)}`,
            access_token: LAZADA_ACCESS_TOKEN,
            refresh_token: LAZADA_REFRESH_TOKEN,
            expires_in: 604800,
            refresh_expires_in: 2592000,
            account: 'seller.vn@lazada.sandbox',
            country: 'vn',
            country_user_info: [
              {
                country: 'vn',
                user_id: '10008899',
                seller_id: 'VN-LZD-OAUTH-SHOP-01',
                short_code: 'VN8899',
              },
            ],
          }),
        );
        return;
      }

      if (apiPath === '/auth/token/refresh') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: `lzd-auth-refresh-${randomUUID().slice(0, 8)}`,
            access_token: `${LAZADA_ACCESS_TOKEN}_refreshed_v2`,
            refresh_token: `${LAZADA_REFRESH_TOKEN}_refreshed_v2`,
            expires_in: 604800,
            refresh_expires_in: 2592000,
            account: 'seller.vn@lazada.sandbox',
            country: 'vn',
            country_user_info: [
              {
                country: 'vn',
                user_id: '10008899',
                seller_id: 'VN-LZD-OAUTH-SHOP-01',
                short_code: 'VN8899',
              },
            ],
          }),
        );
        return;
      }

      if (apiPath === '/orders/get') {
        const allOrders = Array.from(sandboxOrdersById.values());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: `lzd-orders-${randomUUID().slice(0, 8)}`,
            data: {
              count: allOrders.length,
              countTotal: allOrders.length,
              orders: allOrders,
            },
          }),
        );
        return;
      }

      if (apiPath === '/order/get') {
        const orderId = String(query.order_id ?? '');
        const order = sandboxOrdersById.get(orderId);
        if (!order) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 'InvalidOrderId',
              type: 'ISV',
              message: `Order ${orderId} not found`,
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: `lzd-order-${randomUUID().slice(0, 8)}`,
            data: order,
          }),
        );
        return;
      }

      if (apiPath === '/order/items/get') {
        const orderId = String(query.order_id ?? '');
        const items = sandboxItemsByOrderId.get(orderId) ?? [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: '0',
            request_id: `lzd-items-${randomUUID().slice(0, 8)}`,
            data: items,
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: '404', message: 'Not Found' }));
    });

    await new Promise<void>((resolve) => {
      lazadaServer.listen(0, '127.0.0.1', () => resolve());
    });
    const lzdAddr = lazadaServer.address() as AddressInfo;
    lazadaBaseUrl = `http://127.0.0.1:${lzdAddr.port}/rest`;

    // 2. Start Sales Internal HTTP Contract Server (`POST /internal/v1/orders/omnichannel`)
    salesServer = http.createServer((req, res) => {
      if (
        req.method !== 'POST' ||
        req.url !== '/internal/v1/orders/omnichannel'
      ) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Not Found' }));
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = JSON.parse(raw) as Record<string, any>;
        salesHttpCalls.push({ headers: req.headers, body });

        if (req.headers['x-internal-token'] !== INTERNAL_S2S_SECRET) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errorCode: 'UNAUTHORIZED_INTERNAL_CALL' }));
          return;
        }

        const tenantId = String(req.headers['x-tenant-id'] ?? '');
        const connectionId = String(body.sourceConnectionId ?? '');
        const externalOrderId = String(body.externalOrderId ?? '');
        const dedupKey = `${tenantId}:${connectionId}:${externalOrderId}`;

        const existing = salesOrdersByKey.get(dedupKey);
        if (existing) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Idempotency-Replayed': 'true',
          });
          res.end(
            JSON.stringify({
              id: existing.id,
              code: existing.code,
              orderStatus: existing.orderStatus,
              fulfillmentStatus: existing.fulfillmentStatus,
              replayed: true,
              shortageDetected: false,
              shortages: [],
            }),
          );
          return;
        }

        const autoConfirm = Boolean(body.autoConfirm);
        const lines = Array.isArray(body.lines) ? body.lines : [];

        // Only reserve stock in Inventory when autoConfirm === true (active READY_TO_SHIP orders)
        if (autoConfirm) {
          for (const line of lines) {
            const currentReserved =
              simulatedWarehouseReservedByVariant.get(line.variantId) ?? 0;
            simulatedWarehouseReservedByVariant.set(
              line.variantId,
              currentReserved + Number(line.qty ?? 0),
            );
          }
        }

        const created = {
          id: deterministicUuid(`sales-omnichannel:${dedupKey}`),
          code: `HD-LZD-${externalOrderId.slice(-6)}`,
          orderStatus: autoConfirm ? 'CONFIRMED' : 'PENDING',
          fulfillmentStatus: autoConfirm ? 'RESERVED' : 'UNFULFILLED',
          autoConfirm,
          lines,
        };
        salesOrdersByKey.set(dedupKey, created);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: created.id,
            code: created.code,
            orderStatus: created.orderStatus,
            fulfillmentStatus: created.fulfillmentStatus,
            replayed: false,
            shortageDetected: false,
            shortages: [],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      salesServer.listen(0, '127.0.0.1', () => resolve());
    });
    const salesAddr = salesServer.address() as AddressInfo;
    salesBaseUrl = `http://127.0.0.1:${salesAddr.port}`;
    process.env.SALES_SERVICE_URL = salesBaseUrl;

    // 3. Initialize Real PostgreSQL Schema & Services
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M6_INTEGRATION_ENTITIES,
          TenantStatusEntity,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM6IntegrationCore1791900000200,
          AllowSyncJobSchedulerSelect1792500000000,
          CreateTenantStatus1793100000420,
        ],
      }),
    });

    outbox = new EventOutbox();
    rateLimiter = new ProviderRateLimiterService(dataSource);
    lazadaHttpClient = new LazadaHttpClient({
      apiBaseUrl: lazadaBaseUrl,
      liveEnabled: true,
    });
    shopeeAdapter = new ShopeeProviderAdapter(rateLimiter);
    lazadaAdapter = new LazadaProviderAdapter(rateLimiter, lazadaHttpClient);
    providerRegistry = new ProviderRegistryService(
      shopeeAdapter,
      lazadaAdapter,
    );
    salesOrderClient = new SalesOrderClient(
      new InternalHttpClient(new HttpService(), { baseURL: salesBaseUrl }),
    );
    connectionsService = new ConnectionsService(
      dataSource,
      providerRegistry,
      rateLimiter,
      outbox,
    );
    skuMappingService = new SkuMappingService(dataSource, outbox);
    orderSyncService = new OrderSyncService(
      dataSource,
      connectionsService,
      providerRegistry,
      salesOrderClient,
      outbox,
    );
    inventorySyncService = new InventorySyncService(
      dataSource,
      connectionsService,
      providerRegistry,
      outbox,
    );
    syncJobsService = new SyncJobsService(
      dataSource,
      connectionsService,
      orderSyncService,
      inventorySyncService,
      outbox,
    );
    const branchScopeService = new BranchScopeService(dataSource);
    syncJobsController = new SyncJobsController(
      syncJobsService,
      branchScopeService,
    );
    conflictsService = new ConflictsService(
      dataSource,
      skuMappingService,
      orderSyncService,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => lazadaServer.close(() => resolve()));
    await new Promise<void>((resolve) => salesServer.close(() => resolve()));
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    rateLimiter.clearAllSimulations();
    sandboxOrdersById.clear();
    sandboxItemsByOrderId.clear();
    lazadaSignedCalls = [];
    salesOrdersByKey.clear();
    salesHttpCalls = [];
    simulatedWarehouseReservedByVariant.clear();
  });

  async function seedVariantAndStock(params: {
    tenantId: string;
    variantId: string;
    skuCode: string;
    productName: string;
    onHandQty: number;
  }): Promise<void> {
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);
      const variant = em.create(IntegrationCatalogVariantEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        variantId: params.variantId,
        productId: randomUUID(),
        skuCode: params.skuCode,
        barcode: null,
        name: params.productName,
        basePrice: 200000,
        status: 'ACTIVE',
        aggregateVersion: 1,
      });
      await em.save(IntegrationCatalogVariantEntity, variant);

      const proj = em.create(IntegrationStockProjectionEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        warehouseId: WAREHOUSE_A,
        skuId: params.variantId,
        onHandQty: params.onHandQty.toFixed(3),
        reservedQty: '0.000',
        availableQty: params.onHandQty,
        stockVersion: '1',
      });
      await em.save(IntegrationStockProjectionEntity, proj);
    });
  }

  it('Vertical Slice 1 & 2 (Manual Sync Endpoint + HMAC-SHA256 GetOrders/GetOrderItems + Idempotency): creates durable SyncJob, fetches Lazada orders, resolves SKU mappings, imports through Sales API, and enforces idempotency on duplicate syncs', async () => {
    const variantTee = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: variantTee,
      skuCode: 'SAPO-TEE-WHT-L',
      productName: 'Áo Thun Sapo Trắng L',
      onHandQty: 100,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'LAZADA',
        externalShopId: LAZADA_SHOP_ID,
        shopName: 'Lazada Sandbox Flagship VN',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        partnerId: LAZADA_APP_KEY,
        accessToken: LAZADA_ACCESS_TOKEN,
        refreshToken: LAZADA_REFRESH_TOKEN,
        webhookSecret: LAZADA_APP_SECRET,
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'LZD-ITEM-5001',
        externalSkuId: 'LZD-SKU-5001',
        externalSkuCode: 'SAPO-TEE-WHT-L',
        internalVariantId: variantTee,
      }),
    );

    // Seed Lazada Sandbox order 261108900001 with 2 physical item rows for LZD-SKU-5001
    const externalOrderId = '261108900001';
    sandboxOrdersById.set(externalOrderId, {
      order_id: 261108900001,
      order_number: 261108900001,
      statuses: ['ready_to_ship'],
      price: '420,000.00',
      shipping_fee: '30000.00',
      payment_method: 'COD',
      customer_first_name: 'Pham',
      customer_last_name: 'Hoang Nam',
      created_at: '2026-11-08 10:00:00 +0700',
      updated_at: '2026-11-08 10:05:00 +0700',
    });
    sandboxItemsByOrderId.set(externalOrderId, [
      {
        order_item_id: 88001,
        order_id: 261108900001,
        shop_id: LAZADA_SHOP_ID,
        product_id: 'LZD-ITEM-5001',
        sku_id: 'LZD-SKU-5001',
        sku: 'SAPO-TEE-WHT-L',
        name: 'Áo Thun Sapo Trắng L',
        item_price: '200000.00',
        paid_price: '195000.00',
        voucher_amount: '5000.00',
        currency: 'VND',
        status: 'ready_to_ship',
      },
      {
        order_item_id: 88002,
        order_id: 261108900001,
        shop_id: LAZADA_SHOP_ID,
        product_id: 'LZD-ITEM-5001',
        sku_id: 'LZD-SKU-5001',
        sku: 'SAPO-TEE-WHT-L',
        name: 'Áo Thun Sapo Trắng L',
        item_price: '200000.00',
        paid_price: '195000.00',
        voucher_amount: '5000.00',
        currency: 'VND',
        status: 'ready_to_ship',
      },
    ]);

    // Trigger manual synchronization endpoint (`POST /api/v1/integrations/connections/:id/sync/orders`)
    const syncResponse = await runAsTenant(TENANT_A, () =>
      syncJobsController.triggerOrderSync(
        null, // all branches allowed
        conn.id,
        {
          tenantId: TENANT_A,
          userId: ACTOR_OWNER,
          roles: ['owner'],
          permissions: ['channels.update'],
        } as any,
        {
          executeImmediately: true,
          windowStart: '2026-11-08T00:00:00.000Z',
          windowEnd: '2026-11-08T12:00:00.000Z',
        },
      ),
    );

    expect(syncResponse?.job.status).toBe('COMPLETED');
    expect(syncResponse?.job.jobType).toBe('ORDER_POLL');
    expect(syncResponse?.job.resultSummary).toMatchObject({
      polledCount: 1,
      importedCount: 1,
      replayedCount: 0,
      conflictCount: 0,
    });

    // Verify Lazada GetOrders & GetOrderItems were called with HMAC-SHA256 signatures
    expect(lazadaSignedCalls.map((c) => c.apiPath)).toEqual([
      '/orders/get',
      '/order/items/get',
    ]);
    expect(lazadaSignedCalls[0].query.update_after).toBe(
      '2026-11-08T00:00:00.000Z',
    );
    expect(lazadaSignedCalls[0].query.update_before).toBe(
      '2026-11-08T12:00:00.000Z',
    );

    // Verify Sales microservice API received the normalized order with consolidated qty=2 and autoConfirm=true
    expect(salesHttpCalls).toHaveLength(1);
    expect(salesHttpCalls[0].headers['x-tenant-id']).toBe(TENANT_A);
    expect(salesHttpCalls[0].headers['idempotency-key']).toBe(
      `omni-ord:${TENANT_A}:${conn.id}:${externalOrderId}`,
    );
    expect(salesHttpCalls[0].body).toMatchObject({
      branchId: BRANCH_A,
      warehouseId: WAREHOUSE_A,
      channelType: 'MARKETPLACE',
      sourceConnectionId: conn.id,
      externalOrderId,
      customerName: 'Pham Hoang Nam',
      shippingFee: 30000,
      paymentMethod: 'COD',
      autoConfirm: true,
      lines: [
        {
          variantId: variantTee,
          qty: 2,
          unitPriceOverride: 200000,
        },
      ],
    });
    expect(simulatedWarehouseReservedByVariant.get(variantTee)).toBe(2);

    // Verify durable records in PostgreSQL (SyncJob, SyncCursor, ChannelOrderRef)
    const dbState = await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const orderRefs = await em.getRepository(ChannelOrderRefEntity).find({
        where: { tenantId: TENANT_A, connectionId: conn.id, externalOrderId },
      });
      const cursor = await em.getRepository(SyncCursorEntity).findOne({
        where: {
          tenantId: TENANT_A,
          connectionId: conn.id,
          cursorType: 'ORDER_POLL',
        },
      });
      const job = await em.getRepository(SyncJobEntity).findOneByOrFail({
        id: syncResponse!.job.id,
        tenantId: TENANT_A,
      });
      return { orderRefs, cursor, job };
    });

    expect(dbState.orderRefs).toHaveLength(1);
    expect(dbState.orderRefs[0].syncStatus).toBe('IMPORTED');
    expect(dbState.orderRefs[0].internalOrderId).toBeTruthy();
    expect(dbState.orderRefs[0].normalizedStatus).toBe('READY_TO_SHIP');
    expect(dbState.cursor?.cursorValue).toBe('2026-11-08T12:00:00.000Z');
    expect(dbState.job.status).toBe('COMPLETED');

    // Duplicate Order Sync Test: Re-run manual sync + 10 concurrent direct imports for the same Lazada order
    const secondSync = await runAsTenant(TENANT_A, () =>
      syncJobsController.triggerOrderSync(
        null,
        conn.id,
        {
          tenantId: TENANT_A,
          userId: ACTOR_OWNER,
          roles: ['owner'],
          permissions: ['channels.update'],
        } as any,
        {
          executeImmediately: true,
          windowStart: '2026-11-08T00:00:00.000Z',
          windowEnd: '2026-11-08T12:00:00.000Z',
        },
      ),
    );
    expect(secondSync?.job.resultSummary).toMatchObject({
      polledCount: 1,
      importedCount: 0,
      replayedCount: 1,
      conflictCount: 0,
    });

    const concurrentImports = await Promise.all(
      Array.from({ length: 10 }, () =>
        orderSyncService.importOrderByExternalId({
          tenantId: TENANT_A,
          connectionId: conn.id,
          externalOrderId,
        }),
      ),
    );
    expect(concurrentImports.every((r) => r.replayed)).toBe(true);

    // Still exactly 1 Sales order and 1 stock reservation of qty=2!
    expect(salesOrdersByKey.size).toBe(1);
    expect(simulatedWarehouseReservedByVariant.get(variantTee)).toBe(2);
  });

  it('Vertical Slice 3 (Historical Orders Policy): imports DELIVERED, SHIPPED, and CANCELLED Lazada orders with autoConfirm=false and never deducts or reserves Inventory stock again', async () => {
    const variantHist = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: variantHist,
      skuCode: 'SAPO-JEAN-BLU-32',
      productName: 'Quần Jean Sapo Blue 32',
      onHandQty: 50,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'LAZADA',
        externalShopId: 'VN-LZD-HIST-SHOP',
        shopName: 'Lazada Historical Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        partnerId: LAZADA_APP_KEY,
        accessToken: LAZADA_ACCESS_TOKEN,
        refreshToken: LAZADA_REFRESH_TOKEN,
        webhookSecret: LAZADA_APP_SECRET,
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'LZD-ITEM-HIST-1',
        externalSkuId: 'LZD-SKU-HIST-1',
        externalSkuCode: 'SAPO-JEAN-BLU-32',
        internalVariantId: variantHist,
      }),
    );

    const historicalStatuses = [
      { orderId: '26110100001', status: 'delivered' },
      { orderId: '26110100002', status: 'shipped' },
      { orderId: '26110100003', status: 'canceled' },
    ];

    for (const h of historicalStatuses) {
      sandboxOrdersById.set(h.orderId, {
        order_id: Number(h.orderId),
        order_number: Number(h.orderId),
        statuses: [h.status],
        price: '390000.00',
        shipping_fee: 0,
        payment_method: 'LAZPAY',
        customer_first_name: 'Historical',
        customer_last_name: `Buyer ${h.status}`,
        created_at: '2026-11-01 08:00:00 +0700',
        updated_at: '2026-11-01 12:00:00 +0700',
      });
      sandboxItemsByOrderId.set(h.orderId, [
        {
          order_item_id: Number(`${h.orderId}1`),
          order_id: Number(h.orderId),
          shop_id: 'VN-LZD-HIST-SHOP',
          product_id: 'LZD-ITEM-HIST-1',
          sku_id: 'LZD-SKU-HIST-1',
          sku: 'SAPO-JEAN-BLU-32',
          name: 'Quần Jean Sapo Blue 32',
          item_price: '390000.00',
          paid_price: '390000.00',
          voucher_amount: '0.00',
          currency: 'VND',
          status: h.status,
        },
      ]);
    }

    const syncRes = await runAsTenant(TENANT_A, () =>
      syncJobsController.triggerOrderSync(
        null,
        conn.id,
        {
          tenantId: TENANT_A,
          userId: ACTOR_OWNER,
          roles: ['owner'],
          permissions: ['channels.update'],
        } as any,
        {
          executeImmediately: true,
          windowStart: '2026-11-01T00:00:00.000Z',
          windowEnd: '2026-11-02T00:00:00.000Z',
        },
      ),
    );

    expect(syncRes?.job.status).toBe('COMPLETED');
    expect(syncRes?.job.resultSummary).toMatchObject({
      polledCount: 3,
      importedCount: 3,
      conflictCount: 0,
    });

    // Verify all 3 historical orders were sent to Sales with autoConfirm=false and ZERO stock reserved!
    expect(salesHttpCalls).toHaveLength(3);
    for (const call of salesHttpCalls) {
      expect(call.body.autoConfirm).toBe(false);
    }
    expect(simulatedWarehouseReservedByVariant.get(variantHist) ?? 0).toBe(0);
  });

  it('Vertical Slice 4 (Recoverable Missing SKU Mapping Conflict): records MAPPING_REQUIRED and SKU_UNMAPPED conflict without fabricating products/payments/reservations, then imports cleanly after mapping resolution', async () => {
    const variantLaterMapped = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: variantLaterMapped,
      skuCode: 'SAPO-POLO-GRN-M',
      productName: 'Áo Polo Sapo Xanh M',
      onHandQty: 30,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'LAZADA',
        externalShopId: 'VN-LZD-CONFLICT-SHOP',
        shopName: 'Lazada Conflict Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        partnerId: LAZADA_APP_KEY,
        accessToken: LAZADA_ACCESS_TOKEN,
        refreshToken: LAZADA_REFRESH_TOKEN,
        webhookSecret: LAZADA_APP_SECRET,
      }),
    );

    const unmappedOrderId = '261108999901';
    sandboxOrdersById.set(unmappedOrderId, {
      order_id: 261108999901,
      order_number: 261108999901,
      statuses: ['ready_to_ship'],
      price: '280000.00',
      shipping_fee: '20000.00',
      payment_method: 'COD',
      customer_first_name: 'Do',
      customer_last_name: 'Van D',
      created_at: '2026-11-08 11:00:00 +0700',
      updated_at: '2026-11-08 11:10:00 +0700',
    });
    sandboxItemsByOrderId.set(unmappedOrderId, [
      {
        order_item_id: 99901,
        order_id: 261108999901,
        shop_id: 'VN-LZD-CONFLICT-SHOP',
        product_id: 'LZD-UNMAPPED-ITEM-99',
        sku_id: 'LZD-UNMAPPED-SKU-99',
        sku: 'UNKNOWN-LZD-SKU',
        name: 'Mystery Lazada Polo',
        item_price: '260000.00',
        paid_price: '260000.00',
        voucher_amount: '0.00',
        currency: 'VND',
        status: 'ready_to_ship',
      },
    ]);

    const syncRes = await runAsTenant(TENANT_A, () =>
      syncJobsController.triggerOrderSync(
        null,
        conn.id,
        {
          tenantId: TENANT_A,
          userId: ACTOR_OWNER,
          roles: ['owner'],
          permissions: ['channels.update'],
        } as any,
        {
          executeImmediately: true,
        },
      ),
    );

    expect(syncRes?.job.status).toBe('COMPLETED');
    expect(syncRes?.job.resultSummary).toMatchObject({
      polledCount: 1,
      importedCount: 0,
      conflictCount: 1,
    });

    // Verify Sales was NOT called, no order/payment/reservation fabricated
    expect(salesHttpCalls).toHaveLength(0);
    expect(
      simulatedWarehouseReservedByVariant.get(variantLaterMapped) ?? 0,
    ).toBe(0);

    // Inspect ChannelOrderRef and SyncConflict in PostgreSQL
    const conflictState = await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const orderRef = await em
        .getRepository(ChannelOrderRefEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          connectionId: conn.id,
          externalOrderId: unmappedOrderId,
        });
      const conflict = await em
        .getRepository(SyncConflictEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          connectionId: conn.id,
          externalOrderId: unmappedOrderId,
          status: 'OPEN',
        });
      return { orderRef, conflict };
    });

    expect(conflictState.orderRef.syncStatus).toBe('MAPPING_REQUIRED');
    expect(conflictState.orderRef.internalOrderId).toBeNull();
    expect(conflictState.conflict.conflictType).toBe('SKU_UNMAPPED');
    expect(conflictState.conflict.externalItemId).toBe('LZD-UNMAPPED-ITEM-99');
    expect(conflictState.conflict.externalSkuId).toBe('LZD-UNMAPPED-SKU-99');

    // Recover: resolve the conflict by mapping the unknown Lazada SKU to variantLaterMapped and retrying import
    const resolved = await runAsTenant(TENANT_A, () =>
      conflictsService.resolveConflict(conflictState.conflict.id, ACTOR_OWNER, {
        resolutionStatus: 'RESOLVED',
        resolutionAction: 'MAP_SKU_AND_RETRY',
        internalVariantId: variantLaterMapped,
        resolutionNotes: 'Mapped Lazada SKU to SAPO-POLO-GRN-M',
        retryAfterResolve: true,
      }),
    );

    expect(resolved.conflict.status).toBe('RESOLVED');
    expect(resolved.retryResult?.statusOutcome).toBe('IMPORTED');
    expect(resolved.retryResult?.orderRef.syncStatus).toBe('IMPORTED');
    expect(resolved.retryResult?.orderRef.internalOrderId).toBeTruthy();
    expect(salesHttpCalls).toHaveLength(1);
    expect(simulatedWarehouseReservedByVariant.get(variantLaterMapped)).toBe(1);
  });

  it('Vertical Slice 5 (Lazada OAuth Seller Authorization, Code Exchange, AES-256-GCM Encrypted Persistence & Token Refresh): uses env LAZADA_APP_KEY / LAZADA_APP_SECRET without hardcoding tokens', async () => {
    const savedAppKey = process.env.LAZADA_APP_KEY;
    const savedAppSecret = process.env.LAZADA_APP_SECRET;
    const savedAuthTokenUrl = process.env.LAZADA_AUTH_TOKEN_URL;
    const savedStateSecret = process.env.LAZADA_OAUTH_STATE_SECRET;
    process.env.LAZADA_APP_KEY = LAZADA_APP_KEY;
    process.env.LAZADA_APP_SECRET = LAZADA_APP_SECRET;
    process.env.LAZADA_AUTH_TOKEN_URL = lazadaBaseUrl;
    process.env.LAZADA_OAUTH_STATE_SECRET =
      'lazada-int-spec-oauth-state-secret-key-2026';

    try {
      // 1. Create pending Lazada connection without knowing externalShopId upfront
      const created = await runAsTenant(TENANT_A, () =>
        connectionsService.createConnection(ACTOR_OWNER, {
          provider: 'LAZADA',
          branchId: BRANCH_A,
          warehouseId: WAREHOUSE_A,
        }),
      );
      expect(created.status).toBe('PENDING_AUTH');
      expect(created.externalShopId).toMatch(/^pending_lazada_/);
      expect(created.credentialSummary.hasAccessToken).toBe(false);

      // 1b. Reject untrusted client-supplied redirectUri
      await expect(
        runAsTenant(TENANT_A, () =>
          connectionsService.authorizeConnection(created.id, ACTOR_OWNER, {
            redirectUri: 'https://evil.example.com/lazada/callback',
          }),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });

      // 2. Initiate OAuth to get seller authorization URL and signed state token
      const initiated = await runAsTenant(TENANT_A, () =>
        connectionsService.authorizeConnection(created.id, ACTOR_OWNER, {}),
      );
      expect(initiated.mode).toBe('OAUTH_INITIATED');
      if (!('authorizationUrl' in initiated)) {
        throw new Error('Expected OAUTH_INITIATED with authorizationUrl');
      }
      expect(initiated.authorizationUrl).toContain(
        `client_id=${LAZADA_APP_KEY}`,
      );
      expect(initiated.authorizationUrl).toContain(
        encodeURIComponent(
          'https://api.sapo.makeasy.id.vn/api/v1/integrations/lazada/callback',
        ),
      );
      expect(initiated.authorizationUrl).toContain(
        `state=${encodeURIComponent(initiated.stateNonce)}`,
      );

      // 3. Complete public OAuth callback with code + signed state -> calls signed /auth/token/create and binds seller_id
      const completed = await connectionsService.handleLazadaPublicCallback({
        code: '0_128990_sandbox_seller_code_abc',
        state: initiated.stateNonce,
      });
      expect(completed.status).toBe('CONNECTED');
      expect(completed.connectionId).toBe(created.id);
      expect(completed.tenantId).toBe(TENANT_A);
      expect(completed.externalShopId).toBe('VN-LZD-OAUTH-SHOP-01');

      const connectedView = await runAsTenant(TENANT_A, () =>
        connectionsService.getConnectionById(created.id),
      );
      expect(connectedView.status).toBe('CONNECTED');
      expect(connectedView.externalShopId).toBe('VN-LZD-OAUTH-SHOP-01');
      expect(connectedView.credentialSummary.hasAccessToken).toBe(true);
      expect(connectedView.credentialSummary.hasRefreshToken).toBe(true);

      // 4. Verify encrypted persistence in PostgreSQL (never plaintext!)
      const rawCredRow = await dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          TENANT_A,
        ]);
        const credRepo = em.getRepository(ConnectionCredentialEntity);
        const cred = await credRepo.findOneByOrFail({
          tenantId: TENANT_A,
          connectionId: created.id,
        });
        // Move lastRefreshedAt back by 10s so the 1.5s concurrent-refresh coalescing window does not skip explicit refresh
        cred.lastRefreshedAt = new Date(Date.now() - 10_000);
        await credRepo.save(cred);
        return cred;
      });
      expect(rawCredRow.partnerId).toBe(LAZADA_APP_KEY);
      expect(rawCredRow.encryptedAccessToken).toMatch(/^v1:/);
      expect(rawCredRow.encryptedAccessToken).not.toContain(
        LAZADA_ACCESS_TOKEN,
      );
      expect(rawCredRow.encryptedRefreshToken).toMatch(/^v1:/);
      expect(rawCredRow.encryptedRefreshToken).not.toContain(
        LAZADA_REFRESH_TOKEN,
      );

      const decryptedCreds = await runAsTenant(TENANT_A, () =>
        connectionsService.getDecryptedCredentialsForWorker(
          TENANT_A,
          created.id,
        ),
      );
      expect(decryptedCreds.accessToken).toBe(LAZADA_ACCESS_TOKEN);
      expect(decryptedCreds.refreshToken).toBe(LAZADA_REFRESH_TOKEN);
      expect(decryptedCreds.webhookSecret).toBe(LAZADA_APP_SECRET);

      // 5. Refresh credentials via signed /auth/token/refresh -> rotates encrypted tokens
      const refreshedView = await runAsTenant(TENANT_A, () =>
        connectionsService.refreshCredentials(created.id, ACTOR_OWNER),
      );
      expect(refreshedView.refreshed).toBe(true);
      expect(refreshedView.credentialSummary.credentialVersion).toBe(
        Number(rawCredRow.credentialVersion) + 1,
      );

      const rotatedCreds = await runAsTenant(TENANT_A, () =>
        connectionsService.getDecryptedCredentialsForWorker(
          TENANT_A,
          created.id,
        ),
      );
      expect(rotatedCreds.accessToken).toBe(
        `${LAZADA_ACCESS_TOKEN}_refreshed_v2`,
      );
      expect(rotatedCreds.refreshToken).toBe(
        `${LAZADA_REFRESH_TOKEN}_refreshed_v2`,
      );
    } finally {
      if (savedAppKey === undefined) delete process.env.LAZADA_APP_KEY;
      else process.env.LAZADA_APP_KEY = savedAppKey;
      if (savedAppSecret === undefined) delete process.env.LAZADA_APP_SECRET;
      else process.env.LAZADA_APP_SECRET = savedAppSecret;
      if (savedAuthTokenUrl === undefined)
        delete process.env.LAZADA_AUTH_TOKEN_URL;
      else process.env.LAZADA_AUTH_TOKEN_URL = savedAuthTokenUrl;
      if (savedStateSecret === undefined)
        delete process.env.LAZADA_OAUTH_STATE_SECRET;
      else process.env.LAZADA_OAUTH_STATE_SECRET = savedStateSecret;
    }
  });

  it('Vertical Slice 6 (Lazada Public Callback Security, Parallel Callback Race Prevention & Cross-Tenant Shop Conflict): enforces one-time state consumption and global shop uniqueness', async () => {
    const savedAppKey = process.env.LAZADA_APP_KEY;
    const savedAppSecret = process.env.LAZADA_APP_SECRET;
    const savedAuthTokenUrl = process.env.LAZADA_AUTH_TOKEN_URL;
    const savedStateSecret = process.env.LAZADA_OAUTH_STATE_SECRET;
    process.env.LAZADA_APP_KEY = LAZADA_APP_KEY;
    process.env.LAZADA_APP_SECRET = LAZADA_APP_SECRET;
    process.env.LAZADA_AUTH_TOKEN_URL = lazadaBaseUrl;
    process.env.LAZADA_OAUTH_STATE_SECRET =
      'lazada-int-spec-oauth-state-secret-key-2026';

    const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const BRANCH_B = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
    const WAREHOUSE_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

    try {
      // 1. Missing or tampered state is rejected before touching DB or Lazada
      await expect(
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_code',
          state: '',
        }),
      ).rejects.toMatchObject({ code: 'OAUTH_STATE_MISSING' });

      await expect(
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_code',
          state: 'eyJ2IjoidjEifQ.invalid_signature',
        }),
      ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });

      // 2. Cross-tenant conflict: Tenant B tries to authorize the same Lazada seller_id ('VN-LZD-OAUTH-SHOP-01') already connected by Tenant A in Vertical Slice 5
      const tenantBConn = await runAsTenant(TENANT_B, () =>
        connectionsService.createConnection(ACTOR_OWNER, {
          provider: 'LAZADA',
          branchId: BRANCH_B,
          warehouseId: WAREHOUSE_B,
        }),
      );
      const initiatedB = await runAsTenant(TENANT_B, () =>
        connectionsService.authorizeConnection(tenantBConn.id, ACTOR_OWNER, {}),
      );
      if (!('stateNonce' in initiatedB)) {
        throw new Error('Expected OAUTH_INITIATED');
      }

      await expect(
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_conflict_code',
          state: initiatedB.stateNonce,
        }),
      ).rejects.toMatchObject({
        code: 'CHANNEL_CONNECTION_CONFLICT',
      });

      // 3. Replaying the already-consumed state token from Tenant B is rejected with OAUTH_STATE_REPLAYED
      const authCreateCallsBeforeReplay = lazadaSignedCalls.filter(
        (c) => c.apiPath === '/auth/token/create',
      ).length;
      await expect(
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_conflict_code',
          state: initiatedB.stateNonce,
        }),
      ).rejects.toMatchObject({
        code: 'OAUTH_STATE_REPLAYED',
      });
      const authCreateCallsAfterReplay = lazadaSignedCalls.filter(
        (c) => c.apiPath === '/auth/token/create',
      ).length;
      expect(authCreateCallsAfterReplay).toBe(authCreateCallsBeforeReplay);

      // 4. Parallel callback race on the same connection in Tenant A: exactly one wins, the concurrent duplicate fails with OAUTH_STATE_REPLAYED, and Lazada /auth/token/create is called only once
      const existingTenantAConns = await runAsTenant(TENANT_A, () =>
        connectionsService.listConnections(),
      );
      const existingOAuthConn = existingTenantAConns.find(
        (c) => c.externalShopId === 'VN-LZD-OAUTH-SHOP-01',
      )!;
      const reinitiatedA = await runAsTenant(TENANT_A, () =>
        connectionsService.authorizeConnection(
          existingOAuthConn.id,
          ACTOR_OWNER,
          {},
        ),
      );
      if (!('stateNonce' in reinitiatedA)) {
        throw new Error('Expected OAUTH_INITIATED');
      }

      const callsBeforeRace = lazadaSignedCalls.filter(
        (c) => c.apiPath === '/auth/token/create',
      ).length;

      const raceOutcomes = await Promise.allSettled([
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_parallel_race_code',
          state: reinitiatedA.stateNonce,
        }),
        connectionsService.handleLazadaPublicCallback({
          code: '0_128990_parallel_race_code',
          state: reinitiatedA.stateNonce,
        }),
      ]);

      const fulfilled = raceOutcomes.filter((r) => r.status === 'fulfilled');
      const rejected = raceOutcomes.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        code: 'OAUTH_STATE_REPLAYED',
      });

      const callsAfterRace = lazadaSignedCalls.filter(
        (c) => c.apiPath === '/auth/token/create',
      ).length;
      expect(callsAfterRace - callsBeforeRace).toBe(1);
    } finally {
      if (savedAppKey === undefined) delete process.env.LAZADA_APP_KEY;
      else process.env.LAZADA_APP_KEY = savedAppKey;
      if (savedAppSecret === undefined) delete process.env.LAZADA_APP_SECRET;
      else process.env.LAZADA_APP_SECRET = savedAppSecret;
      if (savedAuthTokenUrl === undefined)
        delete process.env.LAZADA_AUTH_TOKEN_URL;
      else process.env.LAZADA_AUTH_TOKEN_URL = savedAuthTokenUrl;
      if (savedStateSecret === undefined)
        delete process.env.LAZADA_OAUTH_STATE_SECRET;
      else process.env.LAZADA_OAUTH_STATE_SECRET = savedStateSecret;
    }
  });
});
