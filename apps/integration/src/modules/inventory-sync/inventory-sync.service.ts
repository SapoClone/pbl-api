import { Injectable } from '@nestjs/common';
import {
  INTEGRATION_INVENTORY_PUBLICATION_FAILED,
  INTEGRATION_INVENTORY_PUBLICATION_SUCCEEDED,
  IntegrationInventoryPublicationEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { roundVnd } from '../../common/money';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  calculateChannelPublishableQuantity,
  shouldApplyInventoryStockVersion,
} from '../../domain/integration-domain';
import {
  ChannelConnectionEntity,
  ChannelInventoryPublicationEntity,
  IntegrationCatalogVariantEntity,
  IntegrationStockProjectionEntity,
  SkuMappingEntity,
} from '../../infrastructure/persistence/integration.entities';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ConnectionsService } from '../connections/connections.service';

export interface PublishVariantStockInput {
  tenantId: string;
  internalVariantId: string;
  warehouseId?: string;
  onHandQty: number;
  reservedQty: number;
  stockVersion: number;
  connectionId?: string;
}

export interface PublishVariantStockResult {
  internalVariantId: string;
  stockVersion: number;
  publications: Array<{
    publicationId: string;
    connectionId: string;
    mappingId: string;
    externalItemId: string;
    externalSkuId: string;
    targetPublishedQty: number;
    status: 'SUCCEEDED' | 'STALE_SKIPPED' | 'FAILED' | 'UNKNOWN_OUTCOME';
    reason?: string;
  }>;
}

@Injectable()
export class InventorySyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectionsService: ConnectionsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly outbox: EventOutbox,
  ) {}

  /**
   * Upserts the local stock projection and publishes sellable quantities
   * to all active mapped channels, enforcing stale-version protection and coalescing.
   */
  async recordStockChangeAndPublish(
    input: PublishVariantStockInput,
  ): Promise<PublishVariantStockResult> {
    const warehouseId =
      input.warehouseId ?? '00000000-0000-4000-8000-000000000001';

    // Step 1: Upsert projection and prepare publication intents under advisory lock per variant
    const intents = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        input.tenantId,
      ]);
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [input.tenantId, `inv-pub:${input.internalVariantId}`],
      );

      let projection = await em
        .getRepository(IntegrationStockProjectionEntity)
        .findOne({
          where: {
            tenantId: input.tenantId,
            warehouseId,
            skuId: input.internalVariantId,
          },
          lock: { mode: 'pessimistic_write' },
        });

      const available = Math.max(
        0,
        Math.floor(input.onHandQty - input.reservedQty),
      );
      if (!projection) {
        projection = em.create(IntegrationStockProjectionEntity, {
          id: randomUUID(),
          tenantId: input.tenantId,
          warehouseId,
          skuId: input.internalVariantId,
          onHandQty: input.onHandQty.toFixed(3),
          reservedQty: input.reservedQty.toFixed(3),
          availableQty: available,
          stockVersion: String(input.stockVersion),
          sourceOccurredAt: new Date(),
        });
        await em.save(IntegrationStockProjectionEntity, projection);
      } else if (input.stockVersion >= Number(projection.stockVersion)) {
        projection.onHandQty = input.onHandQty.toFixed(3);
        projection.reservedQty = input.reservedQty.toFixed(3);
        projection.availableQty = available;
        projection.stockVersion = String(input.stockVersion);
        projection.sourceOccurredAt = new Date();
        await em.save(IntegrationStockProjectionEntity, projection);
      }

      const mappingWhere: Record<string, unknown> = {
        tenantId: input.tenantId,
        internalVariantId: input.internalVariantId,
        status: 'ACTIVE',
      };
      if (input.connectionId) {
        mappingWhere.connectionId = input.connectionId;
      }

      const mappings = await em.getRepository(SkuMappingEntity).find({
        where: mappingWhere,
      });

      const prepared: Array<{
        pub: ChannelInventoryPublicationEntity;
        mapping: SkuMappingEntity;
        connection: ChannelConnectionEntity;
        staleSkipped: boolean;
      }> = [];

      for (const mapping of mappings) {
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: mapping.connectionId, tenantId: input.tenantId },
        });
        if (!conn || conn.status !== 'CONNECTED') {
          continue;
        }

        const calc = calculateChannelPublishableQuantity({
          onHandQty: input.onHandQty,
          reservedQty: input.reservedQty,
          safetyBuffer: conn.safetyStockBuffer,
          allocationPercent: conn.stockAllocationPercent,
        });

        let pub = await em
          .getRepository(ChannelInventoryPublicationEntity)
          .findOne({
            where: {
              tenantId: input.tenantId,
              connectionId: conn.id,
              mappingId: mapping.id,
            },
            lock: { mode: 'pessimistic_write' },
          });

        if (!pub) {
          pub = em.create(ChannelInventoryPublicationEntity, {
            id: randomUUID(),
            tenantId: input.tenantId,
            connectionId: conn.id,
            provider: conn.provider,
            mappingId: mapping.id,
            internalVariantId: mapping.internalVariantId,
            externalItemId: mapping.externalItemId,
            externalSkuId: mapping.externalSkuId,
            availableQtySnapshot: calc.availableQty,
            safetyBufferSnapshot: conn.safetyStockBuffer,
            allocationPercentSnapshot: conn.stockAllocationPercent,
            targetPublishedQty: calc.publishableQty,
            lastConfirmedQty: null,
            stockVersion: String(input.stockVersion),
            lastPublishedStockVersion: '0',
            status: 'PUBLISHING',
            attemptCount: 1,
            providerRequestId: null,
            lastError: null,
            publishedAt: null,
          });
          await em.save(ChannelInventoryPublicationEntity, pub);
          prepared.push({
            pub,
            mapping,
            connection: conn,
            staleSkipped: false,
          });
          continue;
        }

        const lastPubVer = Number(pub.lastPublishedStockVersion);
        const currentTargetVer = Number(pub.stockVersion);
        if (
          !shouldApplyInventoryStockVersion(
            Math.max(lastPubVer, currentTargetVer),
            input.stockVersion,
          ) &&
          pub.status === 'SUCCEEDED'
        ) {
          prepared.push({
            pub,
            mapping,
            connection: conn,
            staleSkipped: true,
          });
          continue;
        }

        pub.availableQtySnapshot = calc.availableQty;
        pub.safetyBufferSnapshot = conn.safetyStockBuffer;
        pub.allocationPercentSnapshot = conn.stockAllocationPercent;
        pub.targetPublishedQty = calc.publishableQty;
        pub.stockVersion = String(input.stockVersion);
        pub.status = 'PUBLISHING';
        pub.attemptCount += 1;
        await em.save(ChannelInventoryPublicationEntity, pub);

        prepared.push({
          pub,
          mapping,
          connection: conn,
          staleSkipped: false,
        });
      }

      return prepared;
    });

    const results: PublishVariantStockResult['publications'] = [];

    for (const item of intents) {
      if (item.staleSkipped) {
        results.push({
          publicationId: item.pub.id,
          connectionId: item.connection.id,
          mappingId: item.mapping.id,
          externalItemId: item.mapping.externalItemId,
          externalSkuId: item.mapping.externalSkuId,
          targetPublishedQty: item.pub.targetPublishedQty,
          status: 'STALE_SKIPPED',
          reason: `Stale stock version ${input.stockVersion} <= last published version ${item.pub.lastPublishedStockVersion}`,
        });
        continue;
      }

      try {
        const creds =
          await this.connectionsService.getDecryptedCredentialsForWorker(
            input.tenantId,
            item.connection.id,
          );
        const adapter = this.providerRegistry.getAdapter(
          item.connection.provider,
        );

        const pubResult = await adapter.publishInventoryStock({
          tenantId: input.tenantId,
          connectionId: item.connection.id,
          externalShopId: item.connection.externalShopId,
          externalItemId: item.mapping.externalItemId,
          externalSkuId: item.mapping.externalSkuId,
          externalSkuCode: item.mapping.externalSkuCode,
          quantity: item.pub.targetPublishedQty,
          stockVersion: input.stockVersion,
          accessToken: creds.accessToken,
          partnerSecret: creds.webhookSecret,
          partnerId: creds.partnerId,
        });

        await this.dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            input.tenantId,
          ]);
          const row = await em
            .getRepository(ChannelInventoryPublicationEntity)
            .findOne({
              where: { id: item.pub.id, tenantId: input.tenantId },
              lock: { mode: 'pessimistic_write' },
            });
          if (
            row &&
            Number(row.lastPublishedStockVersion) <= input.stockVersion
          ) {
            row.status = 'SUCCEEDED';
            row.lastConfirmedQty = pubResult.confirmedQuantity;
            row.lastPublishedStockVersion = String(input.stockVersion);
            row.providerRequestId = pubResult.providerRequestId;
            row.lastError = null;
            row.publishedAt = new Date();
            await em.save(ChannelInventoryPublicationEntity, row);

            await em.update(
              ChannelConnectionEntity,
              { id: item.connection.id, tenantId: input.tenantId },
              {
                lastInventorySyncAt: row.publishedAt,
                lastSyncAt: row.publishedAt,
              },
            );

            await this.outbox.enqueue(
              em,
              INTEGRATION_INVENTORY_PUBLICATION_SUCCEEDED,
              {
                tenantId: input.tenantId,
                aggregateId: row.id,
                actor: { id: 'integration-worker', type: 'service' },
                payload: {
                  publicationId: row.id,
                  connectionId: row.connectionId,
                  provider: row.provider,
                  mappingId: row.mappingId,
                  internalVariantId: row.internalVariantId,
                  externalItemId: row.externalItemId,
                  externalSkuId: row.externalSkuId,
                  publishedQuantity: row.targetPublishedQty,
                  stockVersion: input.stockVersion,
                  status: 'SUCCEEDED',
                  occurredAt: row.publishedAt.toISOString(),
                } satisfies IntegrationInventoryPublicationEventPayload,
              },
            );
          }
        });

        results.push({
          publicationId: item.pub.id,
          connectionId: item.connection.id,
          mappingId: item.mapping.id,
          externalItemId: item.mapping.externalItemId,
          externalSkuId: item.mapping.externalSkuId,
          targetPublishedQty: item.pub.targetPublishedQty,
          status: 'SUCCEEDED',
        });
      } catch (error) {
        const isUnknownOutcome =
          error instanceof IntegrationDomainError &&
          error.code ===
            IntegrationDomainErrorCode.PROVIDER_TIMEOUT_UNKNOWN_OUTCOME;
        const status = isUnknownOutcome ? 'UNKNOWN_OUTCOME' : 'FAILED';
        const errMsg = error instanceof Error ? error.message : String(error);

        await this.dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            input.tenantId,
          ]);
          const row = await em
            .getRepository(ChannelInventoryPublicationEntity)
            .findOne({
              where: { id: item.pub.id, tenantId: input.tenantId },
              lock: { mode: 'pessimistic_write' },
            });
          if (row) {
            row.status = status;
            row.lastError = errMsg;
            await em.save(ChannelInventoryPublicationEntity, row);

            await this.outbox.enqueue(
              em,
              INTEGRATION_INVENTORY_PUBLICATION_FAILED,
              {
                tenantId: input.tenantId,
                aggregateId: row.id,
                actor: { id: 'integration-worker', type: 'service' },
                payload: {
                  publicationId: row.id,
                  connectionId: row.connectionId,
                  provider: row.provider,
                  mappingId: row.mappingId,
                  internalVariantId: row.internalVariantId,
                  externalItemId: row.externalItemId,
                  externalSkuId: row.externalSkuId,
                  publishedQuantity: row.targetPublishedQty,
                  stockVersion: input.stockVersion,
                  status: 'FAILED',
                  reason: errMsg,
                  occurredAt: new Date().toISOString(),
                } satisfies IntegrationInventoryPublicationEventPayload,
              },
            );
          }
        });

        results.push({
          publicationId: item.pub.id,
          connectionId: item.connection.id,
          mappingId: item.mapping.id,
          externalItemId: item.mapping.externalItemId,
          externalSkuId: item.mapping.externalSkuId,
          targetPublishedQty: item.pub.targetPublishedQty,
          status,
          reason: errMsg,
        });
      }
    }

    return {
      internalVariantId: input.internalVariantId,
      stockVersion: input.stockVersion,
      publications: results,
    };
  }

  /**
   * Synchronizes all active mappings for a connection against current `integration_stock_projections`.
   */
  async syncAllInventoryForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<{ syncedVariants: number }> {
    const mappings = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(SkuMappingEntity).find({
        where: { tenantId, connectionId, status: 'ACTIVE' },
      });
    });

    const variantIds = Array.from(
      new Set(mappings.map((m) => m.internalVariantId)),
    );
    let syncedVariants = 0;

    for (const variantId of variantIds) {
      const proj = await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        return em.getRepository(IntegrationStockProjectionEntity).findOne({
          where: { tenantId, skuId: variantId },
        });
      });
      if (proj) {
        await this.recordStockChangeAndPublish({
          tenantId,
          internalVariantId: variantId,
          warehouseId: proj.warehouseId,
          onHandQty: Number(proj.onHandQty),
          reservedQty: Number(proj.reservedQty),
          stockVersion: Number(proj.stockVersion) + 1,
          connectionId,
        });
        syncedVariants += 1;
      }
    }

    return { syncedVariants };
  }

  /**
   * Synchronizes external product listings for a connection:
   * - Fetches remote variations via provider adapter.
   * - Updates existing mappings to `listingSyncStatus = 'SYNCED'`.
   * - Creates exact-SKU auto-mappings (`EXACT_SKU_AUTO`) when an unmapped remote variation has an exact `externalSkuCode` matching an active internal Catalog variant's `skuCode`.
   */
  async syncProductListingsForConnection(
    tenantId: string,
    connectionId: string,
    actorId = 'integration-worker',
  ): Promise<{
    examinedListings: number;
    syncedExistingMappings: number;
    autoMappedCount: number;
  }> {
    const creds =
      await this.connectionsService.getDecryptedCredentialsForWorker(
        tenantId,
        connectionId,
      );
    const adapter = this.providerRegistry.getAdapter(creds.connection.provider);

    const listings = await adapter.fetchExternalListings({
      tenantId,
      connectionId,
      externalShopId: creds.connection.externalShopId,
      accessToken: creds.accessToken,
      partnerSecret: creds.webhookSecret,
      partnerId: creds.partnerId,
    });

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      let syncedExistingMappings = 0;
      let autoMappedCount = 0;
      const now = new Date();

      for (const item of listings) {
        const existing = await em.getRepository(SkuMappingEntity).findOne({
          where: {
            tenantId,
            connectionId,
            externalItemId: item.externalItemId,
            externalSkuId: item.externalSkuId,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (existing) {
          existing.externalProductName = item.externalProductName;
          existing.externalPrice = roundVnd(item.price);
          existing.listingSyncStatus = 'SYNCED';
          existing.lastSyncedAt = now;
          await em.save(SkuMappingEntity, existing);
          syncedExistingMappings += 1;
          continue;
        }

        // Strict exact-SKU auto-mapping rule (never fuzzy-match product names)
        if (item.externalSkuCode) {
          const catalogVariant = await em
            .getRepository(IntegrationCatalogVariantEntity)
            .findOne({
              where: {
                tenantId,
                skuCode: item.externalSkuCode.trim(),
                status: 'ACTIVE',
              },
            });
          if (catalogVariant) {
            const autoMapped = em.create(SkuMappingEntity, {
              id: randomUUID(),
              tenantId,
              connectionId,
              provider: creds.connection.provider,
              externalItemId: item.externalItemId,
              externalSkuId: item.externalSkuId,
              externalSkuCode: item.externalSkuCode.trim(),
              externalProductName: item.externalProductName,
              internalProductId: catalogVariant.productId,
              internalVariantId: catalogVariant.variantId,
              internalSkuCode: catalogVariant.skuCode,
              mappingMode: 'EXACT_SKU_AUTO',
              mappingVersion: 1,
              status: 'ACTIVE',
              listingSyncStatus: 'SYNCED',
              externalPrice: roundVnd(item.price),
              lastSyncedAt: now,
              createdBy: actorId,
              updatedBy: actorId,
            });
            await em.save(SkuMappingEntity, autoMapped);
            autoMappedCount += 1;
          }
        }
      }

      return {
        examinedListings: listings.length,
        syncedExistingMappings,
        autoMappedCount,
      };
    });
  }

  /**
   * Coalesces a burst of rapid inventory stock changes by `(tenantId, internalVariantId)`,
   * superseding intermediate versions and publishing only the latest stock version per variant (Test T).
   */
  async coalesceInventoryBurstAndPublish(
    updates: PublishVariantStockInput[],
  ): Promise<PublishVariantStockResult[]> {
    const latestByVariant = new Map<string, PublishVariantStockInput>();
    for (const u of updates) {
      const key = `${u.tenantId}:${u.internalVariantId}`;
      const existing = latestByVariant.get(key);
      if (!existing || u.stockVersion >= existing.stockVersion) {
        latestByVariant.set(key, u);
      }
    }

    const results: PublishVariantStockResult[] = [];
    for (const latest of latestByVariant.values()) {
      const res = await this.recordStockChangeAndPublish(latest);
      results.push(res);
    }
    return results;
  }
}
