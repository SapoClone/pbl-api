import { EventEnvelope, RequestContext } from '@pbl/common';
import {
  CATALOG_VARIANT_CREATED,
  INVENTORY_STOCK_CHANGED,
} from '@pbl/contracts';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../libs/events/test/it-env';
import { IntegrationEventsConsumer } from '../src/consumers/integration-events.consumer';
import {
  IntegrationDomainErrorCode,
  computeLazadaWebhookSignature,
  computeShopeeWebhookSignature,
} from '../src/domain/integration-domain';
import {
  ChannelOrderRefEntity,
  ConnectionCredentialEntity,
  IntegrationAuditLogEntity,
  IntegrationCatalogVariantEntity,
  IntegrationDeadLetterEventEntity,
  IntegrationStockProjectionEntity,
  M6_INTEGRATION_ENTITIES,
  WebhookInboxEventEntity,
} from '../src/infrastructure/persistence/integration.entities';
import { ProviderRateLimiterService } from '../src/infrastructure/rate-limiting/provider-rate-limiter.service';
import { CreateM6IntegrationCore1791900000200 } from '../src/migrations/1791900000200-create-m6-integration-core';
import { ConflictsService } from '../src/modules/conflicts/conflicts.service';
import { ConnectionsService } from '../src/modules/connections/connections.service';
import { InventorySyncService } from '../src/modules/inventory-sync/inventory-sync.service';
import { OrderSyncService } from '../src/modules/order-sync/order-sync.service';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import { SkuMappingService } from '../src/modules/sku-mapping/sku-mapping.service';
import { SyncJobsService } from '../src/modules/sync-jobs/sync-jobs.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { LazadaProviderAdapter } from '../src/providers/lazada/lazada.adapter';
import { ProviderRegistryService } from '../src/providers/provider-registry.service';
import { ShopeeProviderAdapter } from '../src/providers/shopee/shopee.adapter';
import { InMemorySalesOrderClient } from './support/in-memory-sales-order.client';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const WAREHOUSE_A = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a';
const ACTOR_OWNER = '11111111-1111-4111-8111-111111111111';

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

describe('Integration M6 Core (Real PostgreSQL Integration, Concurrency & Fault-Injection Suite — Mandatory Tests A–T)', () => {
  const schema = uniqueSchema('integration_m6_it');
  let dataSource: DataSource;
  let outbox: EventOutbox;
  let rateLimiter: ProviderRateLimiterService;
  let shopeeAdapter: ShopeeProviderAdapter;
  let lazadaAdapter: LazadaProviderAdapter;
  let providerRegistry: ProviderRegistryService;
  let salesOrderClient: InMemorySalesOrderClient;
  let connectionsService: ConnectionsService;
  let skuMappingService: SkuMappingService;
  let orderSyncService: OrderSyncService;
  let inventorySyncService: InventorySyncService;
  let syncJobsService: SyncJobsService;
  let webhooksService: WebhooksService;
  let conflictsService: ConflictsService;
  let reconciliationService: ReconciliationService;
  let eventsConsumer: IntegrationEventsConsumer;

  beforeAll(async () => {
    process.env.INTEGRATION_CREDENTIAL_MASTER_KEY =
      'test-only-integration-master-key-0123456789';
    useDatabase(schema);
    dataSource = await initializeDatabase({
      ...databaseOptions({
        entities: [
          ...M6_INTEGRATION_ENTITIES,
          ...PRODUCER_ENTITIES,
          ...CONSUMER_ENTITIES,
        ],
        migrations: [
          ...PRODUCER_MIGRATIONS,
          ...CONSUMER_MIGRATIONS,
          CreateM6IntegrationCore1791900000200,
        ],
      }),
    });

    outbox = new EventOutbox();
    rateLimiter = new ProviderRateLimiterService(dataSource);
    shopeeAdapter = new ShopeeProviderAdapter(rateLimiter);
    lazadaAdapter = new LazadaProviderAdapter(rateLimiter);
    providerRegistry = new ProviderRegistryService(
      shopeeAdapter,
      lazadaAdapter,
    );
    salesOrderClient = new InMemorySalesOrderClient(dataSource);
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
    webhooksService = new WebhooksService(
      dataSource,
      providerRegistry,
      syncJobsService,
    );
    conflictsService = new ConflictsService(
      dataSource,
      skuMappingService,
      orderSyncService,
    );
    reconciliationService = new ReconciliationService(
      dataSource,
      orderSyncService,
      inventorySyncService,
      rateLimiter,
      outbox,
    );
    eventsConsumer = new IntegrationEventsConsumer(inventorySyncService);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    rateLimiter.clearAllSimulations();
    salesOrderClient.clearSimulations();
  });

  async function seedVariantAndStock(params: {
    tenantId: string;
    variantId: string;
    skuCode: string;
    productName: string;
    warehouseId?: string;
    onHandQty: number;
    reservedQty?: number;
    stockVersion?: number;
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
        basePrice: 250000,
        status: 'ACTIVE',
        aggregateVersion: 1,
      });
      await em.save(IntegrationCatalogVariantEntity, variant);

      const whId = params.warehouseId ?? WAREHOUSE_A;
      const onHand = params.onHandQty;
      const reserved = params.reservedQty ?? 0;
      const projection = em.create(IntegrationStockProjectionEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        warehouseId: whId,
        skuId: params.variantId,
        onHandQty: onHand.toFixed(3),
        reservedQty: reserved.toFixed(3),
        availableQty: Math.max(0, Math.floor(onHand - reserved)),
        stockVersion: String(params.stockVersion ?? 1),
      });
      await em.save(IntegrationStockProjectionEntity, projection);
    });
  }

  it('Test A (Duplicate webhook storm) & Test B (Webhook and polling race): 100 concurrent duplicate webhooks + concurrent polling produce exactly 1 inbox event, 1 canonical Sales order, and 1 ChannelOrderRef', async () => {
    const variantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId,
      skuCode: 'SKU-STORM-01',
      productName: 'Áo Polo Storm',
      onHandQty: 200,
    });

    const webhookSecret = 'shopee_storm_secret_key_001';
    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-STORM-A',
        shopName: 'Shopee Storm Flagship',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_storm_001',
        refreshToken: 'rt_storm_001',
        webhookSecret,
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-STORM-1',
        externalSkuId: 'MODEL-STORM-1',
        externalSkuCode: 'SKU-STORM-01',
        internalVariantId: variantId,
      }),
    );

    const externalOrderId = 'SHP-ORD-STORM-100';
    const webhookUrl = `https://api.sapoclone.local/webhooks/v1/shopee/${conn.connectionKey}`;
    const rawBody = JSON.stringify({
      code: 3,
      shop_id: 'SHOP-STORM-A',
      msg_id: 'MSG-STORM-100',
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        ordersn: externalOrderId,
        order_status: 'READY_TO_SHIP',
        update_time: Math.floor(Date.now() / 1000),
        buyer_username: 'nguyen.storm',
        currency: 'VND',
        total_amount: 500000,
        estimated_shipping_fee: 30000,
        payment_method: 'SHOPEEPAY',
        item_list: [
          {
            item_id: 'ITEM-STORM-1',
            model_id: 'MODEL-STORM-1',
            model_sku: 'SKU-STORM-01',
            item_name: 'Áo Polo Storm',
            model_quantity_purchased: 2,
            model_discounted_price: 250000,
          },
        ],
      },
    });
    const signature = computeShopeeWebhookSignature(
      webhookUrl,
      rawBody,
      webhookSecret,
    );

    // Also seed the same order in provider simulator for Test B concurrent polling
    rateLimiter.seedSimulatedOrder(conn.id, {
      provider: 'SHOPEE',
      externalShopId: 'SHOP-STORM-A',
      externalOrderId,
      externalStatus: 'READY_TO_SHIP',
      normalizedStatus: 'READY_TO_SHIP',
      externalUpdatedAt: new Date(),
      buyerName: 'nguyen.storm',
      currency: 'VND',
      totalAmount: 500000,
      shippingFee: 30000,
      paymentMethod: 'SHOPEEPAY',
      lines: [
        {
          externalItemId: 'ITEM-STORM-1',
          externalSkuId: 'MODEL-STORM-1',
          externalSkuCode: 'SKU-STORM-01',
          itemName: 'Áo Polo Storm',
          quantity: 2,
          unitPrice: 250000,
          lineDiscount: 0,
        },
      ],
      rawPayload: JSON.parse(rawBody),
    });

    // Fire 100 concurrent duplicate webhooks + concurrent polling
    const webhookPromises = Array.from({ length: 100 }, () =>
      webhooksService.ingestWebhook({
        provider: 'SHOPEE',
        connectionKey: conn.connectionKey,
        rawBody,
        headers: { authorization: signature },
        webhookUrl,
      }),
    );

    const [webhookResults, pollResult] = await Promise.all([
      Promise.all(webhookPromises),
      orderSyncService.pollUpdatedOrdersForConnection({
        tenantId: TENANT_A,
        connectionId: conn.id,
      }),
    ]);

    const acceptedFirst = webhookResults.filter((r) => !r.deduplicated);
    const duplicates = webhookResults.filter((r) => r.deduplicated);
    expect(acceptedFirst).toHaveLength(1);
    expect(duplicates).toHaveLength(99);
    expect(pollResult.polledCount).toBe(1);

    // Drain queued webhook sync jobs
    await syncJobsService.claimAndProcessBatch({
      tenantId: TENANT_A,
      workerId: 'worker-storm',
      batchSize: 10,
    });

    // Verify database state: 1 inbox event, 1 canonical Sales order, 1 ChannelOrderRef
    const counts = await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const inboxCount = await em.getRepository(WebhookInboxEventEntity).count({
        where: { tenantId: TENANT_A, connectionId: conn.id },
      });
      const orderRefs = await em.getRepository(ChannelOrderRefEntity).find({
        where: {
          tenantId: TENANT_A,
          connectionId: conn.id,
          externalOrderId,
        },
      });
      return { inboxCount, orderRefs };
    });

    expect(counts.inboxCount).toBe(1);
    expect(counts.orderRefs).toHaveLength(1);
    expect(counts.orderRefs[0].syncStatus).toBe('IMPORTED');
    expect(counts.orderRefs[0].internalOrderId).toBeTruthy();
    expect(salesOrderClient.getCanonicalOrderCountForTenant(TENANT_A)).toBe(1);
  });

  it('Test C (Unknown SKU) & Test D (Insufficient stock): Unmapped SKU creates MAPPING_REQUIRED conflict without fake variant/reservation; insufficient stock imports order in PENDING/SHORTAGE_HOLD with STOCK_INSUFFICIENT conflict', async () => {
    const lowStockVariantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: lowStockVariantId,
      skuCode: 'SKU-LOW-STOCK',
      productName: 'Limited Sneaker',
      onHandQty: 2,
      reservedQty: 1, // available = 1
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-CD-A',
        shopName: 'Shopee Conflict Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_cd_001',
        refreshToken: 'rt_cd_001',
        webhookSecret: 'secret_cd_001',
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-LOW-1',
        externalSkuId: 'MODEL-LOW-1',
        externalSkuCode: 'SKU-LOW-STOCK',
        internalVariantId: lowStockVariantId,
      }),
    );

    // Test C: Import order with unmapped SKU 'ITEM-UNKNOWN-999'
    const unmappedRes = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-UNMAPPED-01',
      inlineOrderPayload: {
        ordersn: 'SHP-ORD-UNMAPPED-01',
        order_status: 'READY_TO_SHIP',
        update_time: Math.floor(Date.now() / 1000),
        total_amount: 300000,
        item_list: [
          {
            item_id: 'ITEM-UNKNOWN-999',
            model_id: 'MODEL-UNKNOWN-999',
            model_sku: 'MYSTERY-SKU',
            item_name: 'Unmapped Product',
            model_quantity_purchased: 1,
            model_discounted_price: 300000,
          },
        ],
      },
    });

    expect(unmappedRes.statusOutcome).toBe('MAPPING_REQUIRED');
    expect(unmappedRes.orderRef.syncStatus).toBe('MAPPING_REQUIRED');
    expect(unmappedRes.orderRef.internalOrderId).toBeNull();
    expect(unmappedRes.conflictId).toBeDefined();

    // Test D: Import order for mapped SKU where ordered quantity (5) > available stock (1)
    const shortageRes = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-SHORTAGE-01',
      inlineOrderPayload: {
        ordersn: 'SHP-ORD-SHORTAGE-01',
        order_status: 'READY_TO_SHIP',
        update_time: Math.floor(Date.now() / 1000),
        total_amount: 1250000,
        item_list: [
          {
            item_id: 'ITEM-LOW-1',
            model_id: 'MODEL-LOW-1',
            model_sku: 'SKU-LOW-STOCK',
            item_name: 'Limited Sneaker',
            model_quantity_purchased: 5,
            model_discounted_price: 250000,
          },
        ],
      },
    });

    expect(shortageRes.statusOutcome).toBe('SHORTAGE_HOLD');
    expect(shortageRes.orderRef.syncStatus).toBe('SHORTAGE_HOLD');
    expect(shortageRes.orderRef.internalOrderId).toBeTruthy();
    expect(shortageRes.conflictId).toBeDefined();

    // Verify stock was NOT fabricated/negative
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const balance = await em
        .getRepository(IntegrationStockProjectionEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          skuId: lowStockVariantId,
        });
      expect(balance.availableQty).toBe(1);
      expect(Number(balance.reservedQty)).toBe(1);
    });
  });

  it('Test E (Webhook signature failure) & Test F (Webhook persistence failure): Invalid signature rejected with 401 and audit log; DB persistence failure returns 503 without false 200 acknowledgment', async () => {
    const secret = 'lazada_secret_ef_999';
    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'LAZADA',
        externalShopId: 'LAZ-SHOP-EF',
        shopName: 'Lazada EF Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'laz_at_ef',
        refreshToken: 'laz_rt_ef',
        webhookSecret: secret,
      }),
    );

    const rawBody = JSON.stringify({
      message_type: 'TRADE_ORDER',
      seller_id: 'LAZ-SHOP-EF',
      msg_id: 'LAZ-MSG-EF-1',
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        order_id: 'LAZ-ORD-EF-1',
        status: 'pending',
      },
    });

    // Test E: Tampered signature -> 401 INVALID_WEBHOOK_SIGNATURE + security audit log without leaking secret
    await expect(
      webhooksService.ingestWebhook({
        provider: 'LAZADA',
        connectionKey: conn.connectionKey,
        rawBody,
        headers: { 'x-lazada-signature': '0000badsignature0000' },
        webhookUrl: `https://api.sapoclone.local/webhooks/v1/lazada/${conn.connectionKey}`,
      }),
    ).rejects.toMatchObject({
      code: IntegrationDomainErrorCode.INVALID_WEBHOOK_SIGNATURE,
      httpStatus: 401,
    });

    const auditLogs = await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      return em.getRepository(IntegrationAuditLogEntity).find({
        where: {
          tenantId: TENANT_A,
          action: 'WEBHOOK_VERIFICATION_REJECTED',
        },
      });
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(auditLogs)).not.toContain(secret);

    // Test F: Valid signature + simulated DB failure -> 503 WEBHOOK_PERSISTENCE_FAILED
    const validSig = computeLazadaWebhookSignature(rawBody, secret);
    webhooksService.injectPersistenceFailure(conn.connectionKey, true);

    await expect(
      webhooksService.ingestWebhook({
        provider: 'LAZADA',
        connectionKey: conn.connectionKey,
        rawBody,
        headers: { 'x-lazada-signature': validSig },
        webhookUrl: `https://api.sapoclone.local/webhooks/v1/lazada/${conn.connectionKey}`,
      }),
    ).rejects.toMatchObject({
      code: IntegrationDomainErrorCode.WEBHOOK_PERSISTENCE_FAILED,
      httpStatus: 503,
    });

    webhooksService.injectPersistenceFailure(conn.connectionKey, false);
  });

  it('Test G (Out-of-order order statuses): SHIPPED before READY_TO_SHIP ignores stale regression; CANCELLED after DELIVERED raises ORDER_STATE_CONFLICT', async () => {
    const variantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId,
      skuCode: 'SKU-OOO-01',
      productName: 'Out-Of-Order Item',
      onHandQty: 50,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-OOO-A',
        shopName: 'Shopee OOO Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_ooo',
        refreshToken: 'rt_ooo',
        webhookSecret: 'sec_ooo',
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-OOO-1',
        externalSkuId: 'MODEL-OOO-1',
        externalSkuCode: 'SKU-OOO-01',
        internalVariantId: variantId,
      }),
    );

    const makeOrderPayload = (status: string, updateTime: number) => ({
      ordersn: 'SHP-ORD-OOO-01',
      order_status: status,
      update_time: updateTime,
      total_amount: 250000,
      item_list: [
        {
          item_id: 'ITEM-OOO-1',
          model_id: 'MODEL-OOO-1',
          model_sku: 'SKU-OOO-01',
          item_name: 'Out-Of-Order Item',
          model_quantity_purchased: 1,
          model_discounted_price: 250000,
        },
      ],
    });

    // 1. Arrive as SHIPPED first
    const first = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-OOO-01',
      inlineOrderPayload: makeOrderPayload('SHIPPED', 2000),
    });
    expect(first.statusOutcome).toBe('IMPORTED');
    expect(first.orderRef.normalizedStatus).toBe('SHIPPED');

    // 2. Arrive late as READY_TO_SHIP (stale regression) -> ignored
    const stale = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-OOO-01',
      inlineOrderPayload: makeOrderPayload('READY_TO_SHIP', 1500),
    });
    expect(stale.statusOutcome).toBe('IGNORE_STALE');
    expect(stale.orderRef.normalizedStatus).toBe('SHIPPED');

    // 3. Progress to COMPLETED (DELIVERED)
    const delivered = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-OOO-01',
      inlineOrderPayload: makeOrderPayload('COMPLETED', 3000),
    });
    expect(delivered.statusOutcome).toBe('STATUS_UPDATED');
    expect(delivered.orderRef.normalizedStatus).toBe('DELIVERED');

    // 4. Contradictory CANCELLED after DELIVERED -> CONFLICT_RECONCILIATION_REQUIRED
    const contradictory = await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_A,
      connectionId: conn.id,
      externalOrderId: 'SHP-ORD-OOO-01',
      inlineOrderPayload: makeOrderPayload('CANCELLED', 4000),
    });
    expect(contradictory.statusOutcome).toBe(
      'CONFLICT_RECONCILIATION_REQUIRED',
    );
    expect(contradictory.conflictId).toBeDefined();
  });

  it('Test H (Token refresh race): 10 concurrent workers refreshing expiring connection credentials execute lease + CAS so only 1 refresh commits and no stale token overwrites', async () => {
    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-TOKEN-RACE',
        shopName: 'Token Race Shop',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'initial_access_token',
        refreshToken: 'initial_refresh_token',
        webhookSecret: 'token_race_secret',
      }),
    );

    const initialVersion = conn.credentialSummary.credentialVersion;

    const refreshResults = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        runAsTenant(TENANT_A, () =>
          connectionsService.refreshCredentials(conn.id, ACTOR_OWNER, {
            workerId: `worker-refresh-${idx}`,
          }),
        ),
      ),
    );

    const refreshedWinners = refreshResults.filter((r) => r.refreshed);
    const skippedLosers = refreshResults.filter((r) => !r.refreshed);

    expect(refreshedWinners).toHaveLength(1);
    expect(skippedLosers).toHaveLength(9);

    const updatedView = await runAsTenant(TENANT_A, () =>
      connectionsService.getConnectionById(conn.id),
    );
    expect(updatedView.credentialSummary.credentialVersion).toBe(
      initialVersion + 1,
    );
  });

  it('Test I (Rate-limit storm), Test J (Provider timeout after stock write) & Test K (Stale stock publication): HTTP 429 schedules Retry-After backoff; timeout records UNKNOWN_OUTCOME and reconciles safely; stale stock version is skipped', async () => {
    const variantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId,
      skuCode: 'SKU-INV-IJK',
      productName: 'Smart Watch IJK',
      onHandQty: 50,
      stockVersion: 5,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-IJK',
        shopName: 'Shopee IJK Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_ijk',
        refreshToken: 'rt_ijk',
        webhookSecret: 'sec_ijk',
      }),
    );

    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-IJK-1',
        externalSkuId: 'MODEL-IJK-1',
        externalSkuCode: 'SKU-INV-IJK',
        internalVariantId: variantId,
      }),
    );

    // Test I: Rate-limit storm (HTTP 429 with Retry-After = 4s) during ORDER_POLL sync job
    rateLimiter.configureFaultRule(`${conn.id}:get_order_list`, {
      mode: 'HTTP_429',
      remainingCount: 1,
      retryAfterSeconds: 4,
    });

    const { job } = await syncJobsService.enqueueSyncJob({
      tenantId: TENANT_A,
      connectionId: conn.id,
      jobType: 'ORDER_POLL',
      idempotencyKey: `job-rate-limit-${randomUUID()}`,
      payload: {},
    });

    const after429 = await syncJobsService.executeJobById(
      TENANT_A,
      job.id,
      'worker-429',
    );
    expect(after429.status).toBe('RETRY_SCHEDULED');
    expect(after429.lastErrorCode).toBe(
      IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
    );
    expect(after429.nextRetryAt!.getTime()).toBeGreaterThanOrEqual(
      Date.now() + 3000,
    );

    // Test J: Provider timeout AFTER remote stock write succeeds (version 10, qty 35)
    rateLimiter.configureFaultRule(`${conn.id}:update_stock`, {
      mode: 'TIMEOUT_AFTER_REMOTE_WRITE',
      remainingCount: 1,
    });

    const timeoutPubRes =
      await inventorySyncService.recordStockChangeAndPublish({
        tenantId: TENANT_A,
        internalVariantId: variantId,
        warehouseId: WAREHOUSE_A,
        onHandQty: 35,
        reservedQty: 0,
        stockVersion: 10,
      });
    expect(timeoutPubRes.publications[0].status).toBe('UNKNOWN_OUTCOME');

    // Verify remote simulated stock already has qty=35 while local publication row is in UNKNOWN_OUTCOME
    const remoteAfterTimeout = rateLimiter.getSimulatedRemoteStock(
      conn.id,
      'ITEM-IJK-1',
      'MODEL-IJK-1',
    );
    expect(remoteAfterTimeout?.quantity).toBe(35);

    // Reconcile unknown outcome -> inspects remote state and marks publication SUCCEEDED
    const reconRes = await runAsTenant(TENANT_A, () =>
      reconciliationService.executeReconciliationRun(ACTOR_OWNER, {
        connectionId: conn.id,
        autoRecoverSafeItems: true,
      }),
    );
    expect(reconRes.run.autoRecoveredCount).toBeGreaterThanOrEqual(1);

    // Test K: Publish stockVersion 15 (qty = 30), then attempt stale stockVersion 12 (qty = 90)
    const v15Res = await inventorySyncService.recordStockChangeAndPublish({
      tenantId: TENANT_A,
      internalVariantId: variantId,
      warehouseId: WAREHOUSE_A,
      onHandQty: 30,
      reservedQty: 0,
      stockVersion: 15,
    });
    expect(v15Res.publications[0].status).toBe('SUCCEEDED');
    expect(v15Res.publications[0].targetPublishedQty).toBe(30);

    const staleV12Res = await inventorySyncService.recordStockChangeAndPublish({
      tenantId: TENANT_A,
      internalVariantId: variantId,
      warehouseId: WAREHOUSE_A,
      onHandQty: 90,
      reservedQty: 0,
      stockVersion: 12,
    });
    expect(staleV12Res.publications[0].status).toBe('STALE_SKIPPED');

    const finalRemote = rateLimiter.getSimulatedRemoteStock(
      conn.id,
      'ITEM-IJK-1',
      'MODEL-IJK-1',
    );
    expect(finalRemote?.quantity).toBe(30);
    expect(finalRemote?.stockVersion).toBe(15);
  });

  it('Test L (Multi-tenant webhook load), Test O (Credential leakage) & Test P (Cross-tenant mapping attack): Strict tenant isolation across 20 concurrent tenants, encrypted credentials at rest, and cross-tenant variant mapping denied', async () => {
    const tenantAVariantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: tenantAVariantId,
      skuCode: 'TENANT-A-PRIVATE-SKU',
      productName: 'Tenant A Secret Item',
      onHandQty: 100,
    });

    // Create 20 distinct tenant connections and fire concurrent webhooks (Test L)
    const tenantIds = Array.from({ length: 20 }, () => randomUUID());
    const createdConns = await Promise.all(
      tenantIds.map((tId, idx) =>
        runAsTenant(tId, () =>
          connectionsService.createConnection(ACTOR_OWNER, {
            provider: 'SHOPEE',
            externalShopId: `MULTI-SHOP-${idx}`,
            shopName: `Multi Tenant Shop ${idx}`,
            branchId: BRANCH_A,
            warehouseId: WAREHOUSE_A,
            accessToken: `secret_access_token_${idx}`,
            refreshToken: `secret_refresh_token_${idx}`,
            webhookSecret: `secret_wh_key_${idx}`,
          }),
        ),
      ),
    );

    await Promise.all(
      createdConns.map((c, idx) => {
        const webhookUrl = `https://api.sapoclone.local/webhooks/v1/shopee/${c.connectionKey}`;
        const rawBody = JSON.stringify({
          code: 3,
          shop_id: c.externalShopId,
          msg_id: `MSG-MT-${idx}`,
          timestamp: Math.floor(Date.now() / 1000),
          data: {
            ordersn: `ORD-MT-${idx}`,
            order_status: 'READY_TO_SHIP',
          },
        });
        const sig = computeShopeeWebhookSignature(
          webhookUrl,
          rawBody,
          `secret_wh_key_${idx}`,
        );
        return webhooksService.ingestWebhook({
          provider: 'SHOPEE',
          connectionKey: c.connectionKey,
          rawBody,
          headers: { authorization: sig },
          webhookUrl,
        });
      }),
    );

    // Verify each tenant sees ONLY its own 1 webhook inbox event and connection via service & tenant scoping
    for (let i = 0; i < tenantIds.length; i++) {
      const tId = tenantIds[i];
      const conns = await runAsTenant(tId, () =>
        connectionsService.listConnections(),
      );
      expect(conns).toHaveLength(1);
      expect(conns[0].tenantId).toBe(tId);
      expect(conns[0].externalShopId).toBe(`MULTI-SHOP-${i}`);

      const rows = await dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [tId]);
        return em.getRepository(WebhookInboxEventEntity).find({
          where: { tenantId: tId },
        });
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(tId);
      expect(rows[0].externalShopId).toBe(`MULTI-SHOP-${i}`);
    }

    // Test O: Verify credentials in DB are AES-256-GCM encrypted and API views never return plaintext
    const sampleTenant = tenantIds[0];
    const sampleConn = createdConns[0];
    expect(sampleConn.credentialSummary.hasAccessToken).toBe(true);
    expect(JSON.stringify(sampleConn)).not.toContain('secret_access_token_0');
    expect(JSON.stringify(sampleConn)).not.toContain('secret_wh_key_0');

    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        sampleTenant,
      ]);
      const credRow = await em
        .getRepository(ConnectionCredentialEntity)
        .findOneByOrFail({
          tenantId: sampleTenant,
          connectionId: sampleConn.id,
        });
      expect(credRow.encryptedAccessToken).toMatch(/^v1:/);
      expect(JSON.stringify(credRow)).not.toContain('secret_access_token_0');
      expect(JSON.stringify(credRow)).not.toContain('secret_wh_key_0');
    });

    // Test P: Tenant B attempts to map its connection to Tenant A's internalVariantId -> denied with 404
    const tenantBConn = await runAsTenant(TENANT_B, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-TENANT-B',
        shopName: 'Tenant B Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_b',
        refreshToken: 'rt_b',
        webhookSecret: 'sec_b',
      }),
    );

    await expect(
      runAsTenant(TENANT_B, () =>
        skuMappingService.createMapping(ACTOR_OWNER, {
          connectionId: tenantBConn.id,
          externalItemId: 'ITEM-B-ATTACK',
          externalSkuId: 'MODEL-B-ATTACK',
          externalSkuCode: 'ATTACK-SKU',
          internalVariantId: tenantAVariantId,
        }),
      ),
    ).rejects.toMatchObject({
      code: IntegrationDomainErrorCode.INTERNAL_VARIANT_NOT_FOUND,
      httpStatus: 404,
    });
  });

  it('Test M (Worker crash after job lease claim) & Test N (DLQ replay): Expired running job lease is reclaimed once; poison job moves to DEAD_LETTERED and replays cleanly after SKU mapping fix', async () => {
    const variantId = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId,
      skuCode: 'SKU-MN-01',
      productName: 'Recovery Coat',
      onHandQty: 40,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-MN-A',
        shopName: 'Shopee MN Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_mn',
        refreshToken: 'rt_mn',
        webhookSecret: 'sec_mn',
      }),
    );

    // Test N: Enqueue order import job for unmapped SKU 'ITEM-DLQ-1' with maxAttempts=1 -> DEAD_LETTERED
    const dlqOrderPayload = {
      ordersn: 'SHP-ORD-DLQ-01',
      order_status: 'READY_TO_SHIP',
      update_time: Math.floor(Date.now() / 1000),
      total_amount: 250000,
      item_list: [
        {
          item_id: 'ITEM-DLQ-1',
          model_id: 'MODEL-DLQ-1',
          model_sku: 'SKU-MN-01',
          item_name: 'Recovery Coat',
          model_quantity_purchased: 1,
          model_discounted_price: 250000,
        },
      ],
    };

    const { job: poisonJob } = await syncJobsService.enqueueSyncJob({
      tenantId: TENANT_A,
      connectionId: conn.id,
      jobType: 'ORDER_IMPORT',
      idempotencyKey: `dlq-job-${randomUUID()}`,
      maxAttempts: 1,
      payload: {
        externalOrderId: 'SHP-ORD-DLQ-01',
        rawOrder: dlqOrderPayload,
      },
    });

    const failedJob = await syncJobsService.executeJobById(
      TENANT_A,
      poisonJob.id,
      'worker-dlq-1',
    );
    expect(failedJob.status).toBe('DEAD_LETTERED');

    // Fix the missing SKU mapping
    await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-DLQ-1',
        externalSkuId: 'MODEL-DLQ-1',
        externalSkuCode: 'SKU-MN-01',
        internalVariantId: variantId,
      }),
    );

    // Replay the dead-lettered job without immediate execution so we can test Worker Crash Lease Recovery (Test M)
    const replayedPending = await runAsTenant(TENANT_A, () =>
      syncJobsService.retrySyncJob(poisonJob.id, ACTOR_OWNER, {
        reason: 'Fixed missing SKU mapping ITEM-DLQ-1',
        executeImmediately: false,
      }),
    );
    expect(replayedPending.status).toBe('PENDING');

    // Test M: Worker A claims the replayed job with a lease that immediately expires (`leaseDurationMs: -5000`, `simulateCrashAfterClaim: true`)
    const crashedClaim = await syncJobsService.claimAndProcessBatch({
      tenantId: TENANT_A,
      workerId: 'worker-crashed-A',
      batchSize: 5,
      leaseDurationMs: -5000,
      simulateCrashAfterClaim: true,
    });
    expect(crashedClaim.claimedCount).toBeGreaterThanOrEqual(1);
    const crashedJob = crashedClaim.jobs.find((j) => j.id === poisonJob.id);
    expect(crashedJob?.status).toBe('RUNNING');

    // Worker B reclaims the expired RUNNING job and completes it
    const healthyRecovery = await syncJobsService.claimAndProcessBatch({
      tenantId: TENANT_A,
      workerId: 'worker-healthy-B',
      batchSize: 5,
      leaseDurationMs: 60_000,
    });
    const completedJob = healthyRecovery.jobs.find(
      (j) => j.id === poisonJob.id,
    );
    expect(completedJob?.status).toBe('COMPLETED');

    // Verify DLQ entry is marked REPLAYED
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const dlqRow = await em
        .getRepository(IntegrationDeadLetterEventEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          sourceId: poisonJob.id,
        });
      expect(dlqRow.status).toBe('REPLAYED');
    });
  });

  it('Test Q (Lost webhook), Test R (Mapping change during import), Test S (Integration crash after Sales success) & Test T (Simultaneous inventory updates burst)', async () => {
    const variantV1 = randomUUID();
    const variantV2 = randomUUID();
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: variantV1,
      skuCode: 'SKU-QRST-V1',
      productName: 'Variant V1 Original',
      onHandQty: 100,
    });
    await seedVariantAndStock({
      tenantId: TENANT_A,
      variantId: variantV2,
      skuCode: 'SKU-QRST-V2',
      productName: 'Variant V2 Remapped',
      onHandQty: 100,
    });

    const conn = await runAsTenant(TENANT_A, () =>
      connectionsService.createConnection(ACTOR_OWNER, {
        provider: 'SHOPEE',
        externalShopId: 'SHOP-QRST-A',
        shopName: 'Shopee QRST Store',
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        accessToken: 'at_qrst',
        refreshToken: 'rt_qrst',
        webhookSecret: 'sec_qrst',
      }),
    );

    const mapping = await runAsTenant(TENANT_A, () =>
      skuMappingService.createMapping(ACTOR_OWNER, {
        connectionId: conn.id,
        externalItemId: 'ITEM-QRST-1',
        externalSkuId: 'MODEL-QRST-1',
        externalSkuCode: 'SKU-QRST-V1',
        internalVariantId: variantV1,
      }),
    );

    // Test Q: Lost webhook -> Order exists in marketplace simulator, discovered by polling / reconciliation
    rateLimiter.seedSimulatedOrder(conn.id, {
      provider: 'SHOPEE',
      externalShopId: 'SHOP-QRST-A',
      externalOrderId: 'SHP-LOST-WEBHOOK-01',
      externalStatus: 'READY_TO_SHIP',
      normalizedStatus: 'READY_TO_SHIP',
      externalUpdatedAt: new Date(),
      buyerName: 'lost.webhook.buyer',
      currency: 'VND',
      totalAmount: 250000,
      shippingFee: 0,
      paymentMethod: 'COD',
      lines: [
        {
          externalItemId: 'ITEM-QRST-1',
          externalSkuId: 'MODEL-QRST-1',
          externalSkuCode: 'SKU-QRST-V1',
          itemName: 'Variant V1 Original',
          quantity: 1,
          unitPrice: 250000,
          lineDiscount: 0,
        },
      ],
      rawPayload: { ordersn: 'SHP-LOST-WEBHOOK-01' },
    });

    const pollRes = await orderSyncService.pollUpdatedOrdersForConnection({
      tenantId: TENANT_A,
      connectionId: conn.id,
    });
    expect(pollRes.polledCount).toBe(1);
    expect(pollRes.importedCount).toBe(1);

    // Test R (Mapping change during import) & Test S (Integration crash after Sales order creation):
    const crashedExternalOrderId = 'SHP-CRASH-AFTER-SALES-01';
    const salesCreated = await salesOrderClient.createOrRecoverOmnichannelOrder(
      {
        tenantId: TENANT_A,
        connectionId: conn.id,
        provider: 'SHOPEE',
        externalShopId: 'SHOP-QRST-A',
        externalOrderId: crashedExternalOrderId,
        branchId: BRANCH_A,
        warehouseId: WAREHOUSE_A,
        buyerName: 'crash.recovery.buyer',
        currency: 'VND',
        shippingFee: 0,
        paymentMethod: 'SHOPEEPAY',
        normalizedStatus: 'READY_TO_SHIP',
        autoConfirm: true,
        lines: [
          {
            variantId: variantV1,
            skuCode: 'SKU-QRST-V1',
            itemName: 'Variant V1 Original',
            quantity: 1,
            unitPrice: 250000,
            lineDiscount: 0,
          },
        ],
        idempotencyKey: `omni-ord:${TENANT_A}:${conn.id}:${crashedExternalOrderId}`,
      },
    );
    expect(salesCreated.replayed).toBe(false);

    // Persist in-flight ChannelOrderRef stuck in IMPORTING with internalOrderId = null and captured mappingSnapshot = variantV1
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const stuckRef = em.create(ChannelOrderRefEntity, {
        id: randomUUID(),
        tenantId: TENANT_A,
        connectionId: conn.id,
        provider: 'SHOPEE',
        externalShopId: 'SHOP-QRST-A',
        externalOrderId: crashedExternalOrderId,
        internalOrderId: null,
        internalOrderCode: null,
        syncStatus: 'IMPORTING',
        externalStatus: 'READY_TO_SHIP',
        normalizedStatus: 'READY_TO_SHIP',
        statusRank: 20,
        externalUpdatedAt: new Date(),
        buyerName: 'crash.recovery.buyer',
        currency: 'VND',
        totalAmount: 250000,
        shippingFee: 0,
        paymentMethod: 'SHOPEEPAY',
        rawOrderSnapshot: {
          ordersn: crashedExternalOrderId,
          order_status: 'READY_TO_SHIP',
          update_time: Math.floor(Date.now() / 1000),
          total_amount: 250000,
          item_list: [
            {
              item_id: 'ITEM-QRST-1',
              model_id: 'MODEL-QRST-1',
              model_sku: 'SKU-QRST-V1',
              item_name: 'Variant V1 Original',
              model_quantity_purchased: 1,
              model_discounted_price: 250000,
            },
          ],
        },
        mappingSnapshot: {
          capturedAt: new Date().toISOString(),
          lines: [
            {
              externalItemId: 'ITEM-QRST-1',
              externalSkuId: 'MODEL-QRST-1',
              mappingId: mapping.id,
              mappingVersion: 1,
              internalVariantId: variantV1,
              internalSkuCode: 'SKU-QRST-V1',
              itemName: 'Variant V1 Original',
              quantity: 1,
              unitPrice: 250000,
              lineDiscount: 0,
            },
          ],
        },
        version: 1,
      });
      await em.save(ChannelOrderRefEntity, stuckRef);
    });

    // Remap SKU to variantV2 while the in-flight order is still IMPORTING (Test R)
    await runAsTenant(TENANT_A, () =>
      skuMappingService.updateMapping(mapping.id, ACTOR_OWNER, {
        internalVariantId: variantV2,
      }),
    );

    // Run reconciliation auto-recovery (Test S + Test R)
    const reconRes = await runAsTenant(TENANT_A, () =>
      reconciliationService.executeReconciliationRun(ACTOR_OWNER, {
        connectionId: conn.id,
        autoRecoverSafeItems: true,
      }),
    );
    expect(reconRes.run.autoRecoveredCount).toBeGreaterThanOrEqual(1);

    // Verify stuck order linked to the original Sales order without duplicate creation and preserved variantV1 snapshot
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const recoveredRef = await em
        .getRepository(ChannelOrderRefEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          connectionId: conn.id,
          externalOrderId: crashedExternalOrderId,
        });
      expect(recoveredRef.syncStatus).toBe('IMPORTED');
      expect(recoveredRef.internalOrderId).toBe(salesCreated.internalOrderId);
      const snapshotLines = (recoveredRef.mappingSnapshot as any).lines;
      expect(snapshotLines[0].internalVariantId).toBe(variantV1);
    });

    // Test T: Simultaneous inventory updates burst (20 rapid updates for variantV2) -> coalesced to latest version 20
    const burstUpdates = Array.from({ length: 20 }, (_, i) => ({
      tenantId: TENANT_A,
      internalVariantId: variantV2,
      warehouseId: WAREHOUSE_A,
      onHandQty: 100 - (i + 1), // latest is 80
      reservedQty: 0,
      stockVersion: i + 1, // latest is 20
    }));

    const coalescedRes =
      await inventorySyncService.coalesceInventoryBurstAndPublish(burstUpdates);
    expect(coalescedRes).toHaveLength(1);
    expect(coalescedRes[0].publications[0].status).toBe('SUCCEEDED');
    expect(coalescedRes[0].publications[0].targetPublishedQty).toBe(80);

    const remoteV2 = rateLimiter.getSimulatedRemoteStock(
      conn.id,
      'ITEM-QRST-1',
      'MODEL-QRST-1',
    );
    expect(remoteV2?.quantity).toBe(80);
    expect(remoteV2?.stockVersion).toBe(20);
  });

  it('Inbound Event Consumer: processes catalog.variant.created and inventory.stock.changed with version monotonicity', async () => {
    const variantId = randomUUID();
    const productId = randomUUID();

    const catalogEnvelope: EventEnvelope<any> = {
      id: randomUUID(),
      type: CATALOG_VARIANT_CREATED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: { id: ACTOR_OWNER, type: 'account' },
      traceId: randomUUID(),
      payload: {
        variantId,
        productId,
        skuCode: 'SKU-EVENT-01',
        name: 'Event Driven Jacket',
        basePrice: 450000,
        status: 'ACTIVE',
        aggregateVersion: 2,
      },
    };

    await dataSource.transaction(async (em) => {
      await eventsConsumer.onCatalogVariantCreated(catalogEnvelope, em);
    });

    // Stale event with aggregateVersion=1 should be ignored
    const staleCatalogEnvelope: EventEnvelope<any> = {
      ...catalogEnvelope,
      id: randomUUID(),
      payload: {
        ...catalogEnvelope.payload,
        name: 'Stale Name Should Be Ignored',
        aggregateVersion: 1,
      },
    };
    await dataSource.transaction(async (em) => {
      await eventsConsumer.onCatalogVariantCreated(staleCatalogEnvelope, em);
    });

    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const variantRow = await em
        .getRepository(IntegrationCatalogVariantEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          variantId,
        });
      expect(variantRow.name).toBe('Event Driven Jacket');
      expect(variantRow.aggregateVersion).toBe(2);
    });

    const stockEnvelope: EventEnvelope<any> = {
      id: randomUUID(),
      type: INVENTORY_STOCK_CHANGED.type,
      version: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT_A,
      actor: { id: 'inventory-service', type: 'service' },
      traceId: randomUUID(),
      payload: {
        skuId: variantId,
        warehouseId: WAREHOUSE_A,
        onHandAfter: 60,
        reservedAfter: 5,
      },
    };

    await dataSource.transaction(async (em) => {
      await eventsConsumer.onInventoryStockChanged(stockEnvelope, em);
    });

    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_A,
      ]);
      const proj = await em
        .getRepository(IntegrationStockProjectionEntity)
        .findOneByOrFail({
          tenantId: TENANT_A,
          skuId: variantId,
        });
      expect(proj.availableQty).toBe(55);
    });
  });
});
