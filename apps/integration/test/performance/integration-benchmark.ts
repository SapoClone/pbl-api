import { RequestContext } from '@pbl/common';
import {
  CONSUMER_ENTITIES,
  CONSUMER_MIGRATIONS,
  EventOutbox,
  PRODUCER_ENTITIES,
  PRODUCER_MIGRATIONS,
  databaseOptions,
  initializeDatabase,
  qualifiedTable,
} from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DataSource, In } from 'typeorm';
import { uniqueSchema, useDatabase } from '../../../../libs/events/test/it-env';
import { computeShopeeWebhookSignature } from '../../src/domain/integration-domain';
import {
  ChannelInventoryPublicationEntity,
  ChannelOrderRefEntity,
  IntegrationCatalogVariantEntity,
  IntegrationStockProjectionEntity,
  M6_INTEGRATION_ENTITIES,
  SkuMappingEntity,
  WebhookInboxEventEntity,
} from '../../src/infrastructure/persistence/integration.entities';
import { ProviderRateLimiterService } from '../../src/infrastructure/rate-limiting/provider-rate-limiter.service';
import { CreateM6IntegrationCore1791900000200 } from '../../src/migrations/1791900000200-create-m6-integration-core';
import { ConnectionsService } from '../../src/modules/connections/connections.service';
import { InventorySyncService } from '../../src/modules/inventory-sync/inventory-sync.service';
import { OrderSyncService } from '../../src/modules/order-sync/order-sync.service';
import { SkuMappingService } from '../../src/modules/sku-mapping/sku-mapping.service';
import { SyncJobsService } from '../../src/modules/sync-jobs/sync-jobs.service';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';
import { LazadaProviderAdapter } from '../../src/providers/lazada/lazada.adapter';
import { ProviderRegistryService } from '../../src/providers/provider-registry.service';
import { ShopeeProviderAdapter } from '../../src/providers/shopee/shopee.adapter';
import { InMemorySalesOrderClient } from '../support/in-memory-sales-order.client';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH_ID = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const WAREHOUSE_ID = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a';
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Number(sorted[idx].toFixed(2));
}

function summarizeLatencies(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    avgMs: Number((sum / Math.max(1, sorted.length)).toFixed(2)),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : 0,
  };
}

function runAsTenant<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(
    {
      requestId: randomUUID(),
      tenantId: TENANT_ID,
      actor: { id: ACTOR_ID, type: 'account' },
    },
    fn,
  );
}

async function runBenchmark() {
  const schema = uniqueSchema('integration_m6_perf');
  useDatabase(schema);

  const dataSource: DataSource = await initializeDatabase({
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
  process.env.INTEGRATION_CREDENTIAL_MASTER_KEY ??=
    'benchmark-only-master-key-0123456789';

  const outbox = new EventOutbox();
  const rateLimiter = new ProviderRateLimiterService(dataSource);
  const shopeeAdapter = new ShopeeProviderAdapter(rateLimiter);
  const lazadaAdapter = new LazadaProviderAdapter(rateLimiter);
  const providerRegistry = new ProviderRegistryService(
    shopeeAdapter,
    lazadaAdapter,
  );
  const salesOrderClient = new InMemorySalesOrderClient(dataSource);
  const connectionsService = new ConnectionsService(
    dataSource,
    providerRegistry,
    rateLimiter,
    outbox,
  );
  const skuMappingService = new SkuMappingService(dataSource, outbox);
  const orderSyncService = new OrderSyncService(
    dataSource,
    connectionsService,
    providerRegistry,
    salesOrderClient,
    outbox,
  );
  const inventorySyncService = new InventorySyncService(
    dataSource,
    connectionsService,
    providerRegistry,
    outbox,
  );
  const syncJobsService = new SyncJobsService(
    dataSource,
    connectionsService,
    orderSyncService,
    inventorySyncService,
    outbox,
  );
  const webhooksService = new WebhooksService(
    dataSource,
    providerRegistry,
    syncJobsService,
  );

  console.log('=== M6 INTEGRATION & OMNICHANNEL PERFORMANCE BENCHMARK ===');
  const seedStart = performance.now();

  const webhookSecret = 'perf_shopee_secret_key_2026';
  const connection = await runAsTenant(() =>
    connectionsService.createConnection(ACTOR_ID, {
      provider: 'SHOPEE',
      externalShopId: 'PERF-SHOP-001',
      shopName: 'Shopee Performance Flagship',
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      accessToken: 'perf_access_token_001',
      refreshToken: 'perf_refresh_token_001',
      webhookSecret,
    }),
  );

  // Bulk seed 5,000 Catalog variants, 5,000 SKU mappings, 5,000 webhook inbox events, 2,500 order refs, 2,500 publications
  const variantIds: string[] = [];
  await dataSource.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);

    const variants: Partial<IntegrationCatalogVariantEntity>[] = [];
    const balances: Partial<IntegrationStockProjectionEntity>[] = [];
    const mappings: Partial<SkuMappingEntity>[] = [];
    const publications: Partial<ChannelInventoryPublicationEntity>[] = [];

    for (let i = 0; i < 5000; i++) {
      const vId = randomUUID();
      const mId = randomUUID();
      const pId = randomUUID();
      variantIds.push(vId);
      variants.push({
        id: randomUUID(),
        tenantId: TENANT_ID,
        variantId: vId,
        productId: pId,
        skuCode: `PERF-SKU-${i}`,
        barcode: null,
        name: `Performance Product ${i}`,
        basePrice: '199000.00',
        status: 'ACTIVE',
        aggregateVersion: 1,
      });
      balances.push({
        id: randomUUID(),
        tenantId: TENANT_ID,
        skuId: vId,
        warehouseId: WAREHOUSE_ID,
        onHandQty: '500.000',
        reservedQty: '10.000',
        availableQty: 490,
        stockVersion: '1',
      });
      mappings.push({
        id: mId,
        tenantId: TENANT_ID,
        connectionId: connection.id,
        provider: 'SHOPEE',
        externalItemId: `PERF-ITEM-${i}`,
        externalSkuId: `PERF-MODEL-${i}`,
        externalSkuCode: `PERF-SKU-${i}`,
        externalProductName: `Performance Product ${i}`,
        internalProductId: pId,
        internalVariantId: vId,
        internalSkuCode: `PERF-SKU-${i}`,
        mappingMode: 'MANUAL',
        mappingVersion: 1,
        status: 'ACTIVE',
        listingSyncStatus: 'SYNCED',
        externalPrice: '199000.00',
        createdBy: ACTOR_ID,
        updatedBy: ACTOR_ID,
      });
      if (i < 2500) {
        publications.push({
          id: randomUUID(),
          tenantId: TENANT_ID,
          connectionId: connection.id,
          provider: 'SHOPEE',
          mappingId: mId,
          internalVariantId: vId,
          externalItemId: `PERF-ITEM-${i}`,
          externalSkuId: `PERF-MODEL-${i}`,
          availableQtySnapshot: 490,
          safetyBufferSnapshot: 0,
          allocationPercentSnapshot: 100,
          targetPublishedQty: 490,
          lastConfirmedQty: 490,
          stockVersion: '1',
          lastPublishedStockVersion: '1',
          status: 'SUCCEEDED',
          attemptCount: 1,
          publishedAt: new Date(),
        });
      }
    }

    for (let offset = 0; offset < 5000; offset += 1000) {
      await em
        .getRepository(IntegrationCatalogVariantEntity)
        .insert(variants.slice(offset, offset + 1000));
      await em
        .getRepository(IntegrationStockProjectionEntity)
        .insert(balances.slice(offset, offset + 1000));
      await em
        .getRepository(SkuMappingEntity)
        .insert(mappings.slice(offset, offset + 1000));
    }
    for (let offset = 0; offset < 2500; offset += 1000) {
      await em
        .getRepository(ChannelInventoryPublicationEntity)
        .insert(publications.slice(offset, offset + 1000));
    }

    // Seed 5,000 historical webhook inbox rows and 2,500 order refs
    const inboxRows: Partial<WebhookInboxEventEntity>[] = [];
    const orderRefs: Partial<ChannelOrderRefEntity>[] = [];
    for (let i = 0; i < 5000; i++) {
      inboxRows.push({
        id: randomUUID(),
        tenantId: TENANT_ID,
        connectionId: connection.id,
        provider: 'SHOPEE',
        externalShopId: 'PERF-SHOP-001',
        externalEventId: `HIST-EVT-${i}`,
        deduplicationKey: `SHOPEE:PERF-SHOP-001:ORDER_STATUS_UPDATE:HIST-EVT-${i}`,
        eventType: 'ORDER_STATUS_UPDATE',
        externalOrderId: `HIST-ORD-${i}`,
        payloadHash: `hash-${i}`,
        encryptedPayload: 'v1:perf:tag:cipher',
        providerEventTime: new Date(),
        processingStatus: 'PROCESSED',
        attemptCount: 1,
        receivedAt: new Date(),
      });
      if (i < 2500) {
        orderRefs.push({
          id: randomUUID(),
          tenantId: TENANT_ID,
          connectionId: connection.id,
          provider: 'SHOPEE',
          externalShopId: 'PERF-SHOP-001',
          externalOrderId: `HIST-ORD-${i}`,
          internalOrderId: randomUUID(),
          internalOrderCode: `SO-HIST-${i}`,
          syncStatus: 'IMPORTED',
          externalStatus: 'READY_TO_SHIP',
          normalizedStatus: 'READY_TO_SHIP',
          statusRank: 20,
          externalUpdatedAt: new Date(),
          buyerName: `buyer.${i}`,
          currency: 'VND',
          totalAmount: '199000.00',
          shippingFee: '0.00',
          paymentMethod: 'SHOPEEPAY',
          rawOrderSnapshot: {},
          mappingSnapshot: {},
          version: 1,
        });
      }
    }
    for (let offset = 0; offset < 5000; offset += 1000) {
      await em
        .getRepository(WebhookInboxEventEntity)
        .insert(inboxRows.slice(offset, offset + 1000));
    }
    for (let offset = 0; offset < 2500; offset += 1000) {
      await em
        .getRepository(ChannelOrderRefEntity)
        .insert(orderRefs.slice(offset, offset + 1000));
    }

    await em.query(`ANALYZE`);
  });

  const seedMs = Number((performance.now() - seedStart).toFixed(2));
  console.log(
    `Seeded 5,000 variants, 5,000 SKU mappings, 5,000 webhook inbox events, 2,500 order refs, 2,500 inventory publications in ${seedMs} ms`,
  );

  // 1. Measure Webhook signature verification + durable inbox ingestion (50 distinct webhooks)
  const webhookLatencies: number[] = [];
  const webhookUrl = `https://api.sapoclone.local/webhooks/v1/shopee/${connection.connectionKey}`;
  for (let i = 0; i < 50; i++) {
    const rawBody = JSON.stringify({
      code: 3,
      shop_id: 'PERF-SHOP-001',
      msg_id: `PERF-LIVE-MSG-${i}`,
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        ordersn: `PERF-LIVE-ORD-${i}`,
        order_status: 'READY_TO_SHIP',
        update_time: Math.floor(Date.now() / 1000),
        total_amount: 199000,
        item_list: [
          {
            item_id: `PERF-ITEM-${i}`,
            model_id: `PERF-MODEL-${i}`,
            model_sku: `PERF-SKU-${i}`,
            item_name: `Performance Product ${i}`,
            model_quantity_purchased: 1,
            model_discounted_price: 199000,
          },
        ],
      },
    });
    const sig = computeShopeeWebhookSignature(
      webhookUrl,
      rawBody,
      webhookSecret,
    );
    const t0 = performance.now();
    await webhooksService.ingestWebhook({
      provider: 'SHOPEE',
      connectionKey: connection.connectionKey,
      rawBody,
      headers: { authorization: sig },
      webhookUrl,
    });
    webhookLatencies.push(performance.now() - t0);
  }

  // 2. Measure Duplicate Webhook Burst (100 concurrent duplicate deliveries)
  const dupRawBody = JSON.stringify({
    code: 3,
    shop_id: 'PERF-SHOP-001',
    msg_id: 'PERF-DUP-BURST-MSG',
    timestamp: Math.floor(Date.now() / 1000),
    data: {
      ordersn: 'PERF-DUP-BURST-ORD',
      order_status: 'READY_TO_SHIP',
    },
  });
  const dupSig = computeShopeeWebhookSignature(
    webhookUrl,
    dupRawBody,
    webhookSecret,
  );
  const dupLatencies: number[] = [];
  await Promise.all(
    Array.from({ length: 100 }, async () => {
      const t0 = performance.now();
      await webhooksService.ingestWebhook({
        provider: 'SHOPEE',
        connectionKey: connection.connectionKey,
        rawBody: dupRawBody,
        headers: { authorization: dupSig },
        webhookUrl,
      });
      dupLatencies.push(performance.now() - t0);
    }),
  );

  // 3. Measure Batch SKU Mapping Lookup (50 iterations of 25-line order batch lookup)
  const mappingLookupLatencies: number[] = [];
  for (let i = 0; i < 50; i++) {
    const itemIds = Array.from(
      { length: 25 },
      (_, k) => `PERF-ITEM-${(i * 25 + k) % 5000}`,
    );
    const t0 = performance.now();
    await dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        TENANT_ID,
      ]);
      await em.getRepository(SkuMappingEntity).find({
        where: {
          tenantId: TENANT_ID,
          connectionId: connection.id,
          externalItemId: In(itemIds),
        },
      });
    });
    mappingLookupLatencies.push(performance.now() - t0);
  }

  // 4. Measure Order Normalization + Canonical Sales Import (30 orders)
  const orderImportLatencies: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    await orderSyncService.importOrderByExternalId({
      tenantId: TENANT_ID,
      connectionId: connection.id,
      externalOrderId: `PERF-IMPORT-ORD-${i}`,
      inlineOrderPayload: {
        ordersn: `PERF-IMPORT-ORD-${i}`,
        order_status: 'READY_TO_SHIP',
        update_time: Math.floor(Date.now() / 1000),
        total_amount: 199000,
        item_list: [
          {
            item_id: `PERF-ITEM-${i}`,
            model_id: `PERF-MODEL-${i}`,
            model_sku: `PERF-SKU-${i}`,
            item_name: `Performance Product ${i}`,
            model_quantity_purchased: 1,
            model_discounted_price: 199000,
          },
        ],
      },
    });
    orderImportLatencies.push(performance.now() - t0);
  }

  // 5. Measure Sync Job Claiming with FOR UPDATE SKIP LOCKED (25 batches of 2 jobs)
  const jobClaimLatencies: number[] = [];
  for (let i = 0; i < 25; i++) {
    const t0 = performance.now();
    const claimed = await syncJobsService.claimAndProcessBatch({
      tenantId: TENANT_ID,
      workerId: `perf-worker-${i % 4}`,
      batchSize: 2,
      leaseDurationMs: 60_000,
    });
    jobClaimLatencies.push(performance.now() - t0);
    if (claimed.claimedCount === 0) break;
  }

  // 6. Measure Inventory Coalescing Burst (100 rapid updates across 5 variants -> 5 outbound publications)
  const burstUpdates = Array.from({ length: 100 }, (_, i) => ({
    tenantId: TENANT_ID,
    internalVariantId: variantIds[i % 5],
    warehouseId: WAREHOUSE_ID,
    onHandQty: 400 - i,
    reservedQty: 5,
    stockVersion: 100 + i,
  }));
  const coalesceStart = performance.now();
  await inventorySyncService.coalesceInventoryBurstAndPublish(burstUpdates);
  const coalesceTotalMs = Number(
    (performance.now() - coalesceStart).toFixed(2),
  );

  // 7. Capture EXPLAIN (ANALYZE, BUFFERS) plans on hot queries
  const explainPlans = await dataSource.transaction(async (em) => {
    await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
    await em.query(
      `SELECT set_config('app.webhook_connection_key', $1, true)`,
      [connection.connectionKey],
    );

    const connTbl = qualifiedTable(em.connection, 'channel_connections');
    const inboxTbl = qualifiedTable(em.connection, 'webhook_inbox_events');
    const mappingTbl = qualifiedTable(em.connection, 'sku_mappings');
    const jobsTbl = qualifiedTable(em.connection, 'sync_jobs');
    const refsTbl = qualifiedTable(em.connection, 'channel_order_refs');

    const q1 = await em.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, tenant_id, provider, status FROM ${connTbl}
       WHERE connection_key = $1 AND provider = 'SHOPEE' LIMIT 1`,
      [connection.connectionKey],
    );

    const q2 = await em.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, processing_status FROM ${inboxTbl}
       WHERE tenant_id = $1 AND connection_id = $2 AND deduplication_key = $3`,
      [
        TENANT_ID,
        connection.id,
        'SHOPEE:PERF-SHOP-001:ORDER_STATUS_UPDATE:HIST-EVT-2500',
      ],
    );

    const q3 = await em.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, internal_variant_id, internal_sku_code, status FROM ${mappingTbl}
       WHERE tenant_id = $1 AND connection_id = $2 AND external_item_id = $3 AND external_sku_id = $4`,
      [TENANT_ID, connection.id, 'PERF-ITEM-2500', 'PERF-MODEL-2500'],
    );

    const q4 = await em.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id FROM ${jobsTbl}
       WHERE tenant_id = $1 AND status IN ('PENDING', 'RETRY_SCHEDULED') AND next_retry_at <= NOW()
       ORDER BY priority DESC, next_retry_at ASC, created_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [TENANT_ID],
    );

    const q5 = await em.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT id, internal_order_id, sync_status, normalized_status FROM ${refsTbl}
       WHERE tenant_id = $1 AND connection_id = $2 AND external_order_id = $3`,
      [TENANT_ID, connection.id, 'HIST-ORD-1200'],
    );

    return {
      webhookConnectionLookup: q1.map((r: any) => r['QUERY PLAN']).join('\n'),
      webhookInboxDedupLookup: q2.map((r: any) => r['QUERY PLAN']).join('\n'),
      skuMappingLookup: q3.map((r: any) => r['QUERY PLAN']).join('\n'),
      syncJobSkipLockedPoll: q4.map((r: any) => r['QUERY PLAN']).join('\n'),
      channelOrderRefLookup: q5.map((r: any) => r['QUERY PLAN']).join('\n'),
    };
  });

  const summary = {
    seedDurationMs: seedMs,
    webhookIngestion: summarizeLatencies(webhookLatencies),
    duplicateWebhookBurst100: summarizeLatencies(dupLatencies),
    batchSkuMappingLookup25Lines: summarizeLatencies(mappingLookupLatencies),
    orderNormalizationAndImport: summarizeLatencies(orderImportLatencies),
    syncJobClaimSkipLocked: summarizeLatencies(jobClaimLatencies),
    inventoryBurstCoalescing100To5Ms: coalesceTotalMs,
    explainPlans,
  };

  console.log(JSON.stringify(summary, null, 2));
  await dataSource.destroy();
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
