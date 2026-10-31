import { Injectable } from '@nestjs/common';
import {
  INTEGRATION_EXTERNAL_ORDER_IMPORTED,
  INTEGRATION_EXTERNAL_ORDER_MAPPING_REQUIRED,
  INTEGRATION_EXTERNAL_ORDER_RECEIVED,
  IntegrationExternalOrderEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  evaluateExternalStatusProgression,
  getNormalizedStatusRank,
} from '../../domain/integration-domain';
import { nextIntegrationCode } from '../../infrastructure/persistence/integration-code.generator';
import {
  ChannelConnectionEntity,
  ChannelOrderRefEntity,
  IntegrationCatalogVariantEntity,
  SkuMappingEntity,
  SyncConflictEntity,
  SyncCursorEntity,
} from '../../infrastructure/persistence/integration.entities';
import { SalesOrderClient } from '../../infrastructure/sales-client/sales-order.client';
import type { NormalizedExternalOrder } from '../../providers/contracts/provider.contracts';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ConnectionsService } from '../connections/connections.service';

export interface ResolvedOrderLineMapping {
  externalItemId: string;
  externalSkuId: string;
  mappingId: string;
  mappingVersion: number;
  internalVariantId: string;
  internalSkuCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
}

export interface OrderImportExecutionResult {
  orderRef: ChannelOrderRefEntity;
  replayed: boolean;
  statusOutcome:
    | 'IMPORTED'
    | 'SHORTAGE_HOLD'
    | 'MAPPING_REQUIRED'
    | 'STATUS_UPDATED'
    | 'IGNORE_STALE'
    | 'CONFLICT_RECONCILIATION_REQUIRED';
  conflictId?: string;
}

@Injectable()
export class OrderSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectionsService: ConnectionsService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly salesOrderClient: SalesOrderClient,
    private readonly outbox: EventOutbox,
  ) {}

  async importOrderByExternalId(params: {
    tenantId: string;
    connectionId: string;
    externalOrderId: string;
    inlineOrderPayload?: Record<string, unknown>;
  }): Promise<OrderImportExecutionResult> {
    const creds =
      await this.connectionsService.getDecryptedCredentialsForWorker(
        params.tenantId,
        params.connectionId,
      );
    const adapter = this.providerRegistry.getAdapter(creds.connection.provider);

    let normalizedOrder: NormalizedExternalOrder;
    if (
      params.inlineOrderPayload &&
      (Array.isArray((params.inlineOrderPayload as any).item_list) ||
        Array.isArray((params.inlineOrderPayload as any).order_items) ||
        Array.isArray((params.inlineOrderPayload as any).lines))
    ) {
      normalizedOrder = adapter.normalizeOrderPayload(
        params.inlineOrderPayload,
        creds.connection.externalShopId,
      );
    } else {
      normalizedOrder = await adapter.fetchOrderDetails({
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        externalShopId: creds.connection.externalShopId,
        externalOrderId: params.externalOrderId,
        accessToken: creds.accessToken,
        partnerSecret: creds.webhookSecret,
        partnerId: creds.partnerId,
      });
    }

    return this.importNormalizedOrder(
      params.tenantId,
      creds.connection,
      normalizedOrder,
    );
  }

  async importNormalizedOrder(
    tenantId: string,
    connection: ChannelConnectionEntity,
    normalizedOrder: NormalizedExternalOrder,
  ): Promise<OrderImportExecutionResult> {
    // Phase 1: Serialize on (tenantId, connectionId, externalOrderId), evaluate state & resolve SKU mappings
    const prep = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [
          tenantId,
          `ord-sync:${connection.id}:${normalizedOrder.externalOrderId}`,
        ],
      );

      let orderRef = await em.getRepository(ChannelOrderRefEntity).findOne({
        where: {
          tenantId,
          connectionId: connection.id,
          externalOrderId: normalizedOrder.externalOrderId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      const incomingRank = getNormalizedStatusRank(
        normalizedOrder.normalizedStatus,
      );

      // Case A: Order was already imported into Sales -> evaluate status progression
      if (
        orderRef &&
        orderRef.internalOrderId &&
        (orderRef.syncStatus === 'IMPORTED' ||
          orderRef.syncStatus === 'SHORTAGE_HOLD')
      ) {
        const evalResult = evaluateExternalStatusProgression({
          currentStatus: orderRef.normalizedStatus,
          currentRank: orderRef.statusRank,
          incomingStatus: normalizedOrder.normalizedStatus,
          currentExternalUpdatedAt: orderRef.externalUpdatedAt,
          incomingExternalUpdatedAt: normalizedOrder.externalUpdatedAt,
        });

        if (evalResult.outcome === 'IGNORE_STALE') {
          return {
            action: 'DONE' as const,
            result: {
              orderRef,
              replayed: true,
              statusOutcome: 'IGNORE_STALE' as const,
            },
          };
        }

        if (evalResult.outcome === 'CONFLICT_RECONCILIATION_REQUIRED') {
          const conflictCode = await nextIntegrationCode(em, tenantId, 'CNF');
          const conflict = em.create(SyncConflictEntity, {
            id: randomUUID(),
            tenantId,
            code: conflictCode,
            connectionId: connection.id,
            provider: connection.provider,
            conflictType: 'ORDER_STATE_CONFLICT',
            severity: 'HIGH',
            status: 'OPEN',
            externalOrderId: normalizedOrder.externalOrderId,
            channelOrderRefId: orderRef.id,
            details: {
              currentNormalizedStatus: orderRef.normalizedStatus,
              incomingNormalizedStatus: normalizedOrder.normalizedStatus,
              reason: evalResult.reason,
            },
          });
          await em.save(SyncConflictEntity, conflict);

          orderRef.syncStatus = 'CONFLICT';
          orderRef.lastErrorCode =
            IntegrationDomainErrorCode.EXTERNAL_ORDER_STATE_CONFLICT;
          orderRef.lastErrorMessage = evalResult.reason ?? null;
          await em.save(ChannelOrderRefEntity, orderRef);

          return {
            action: 'DONE' as const,
            result: {
              orderRef,
              replayed: false,
              statusOutcome: 'CONFLICT_RECONCILIATION_REQUIRED' as const,
              conflictId: conflict.id,
            },
          };
        }

        // Valid forward status progression
        await this.salesOrderClient.transitionCanonicalOrderStatus({
          tenantId,
          internalOrderId: orderRef.internalOrderId,
          targetNormalizedStatus: normalizedOrder.normalizedStatus,
        });
        orderRef.externalStatus = normalizedOrder.externalStatus;
        orderRef.normalizedStatus = normalizedOrder.normalizedStatus;
        orderRef.statusRank = evalResult.targetRank;
        orderRef.externalUpdatedAt = normalizedOrder.externalUpdatedAt;
        orderRef.lastSyncedAt = new Date();
        orderRef.version += 1;
        await em.save(ChannelOrderRefEntity, orderRef);

        return {
          action: 'DONE' as const,
          result: {
            orderRef,
            replayed: false,
            statusOutcome: 'STATUS_UPDATED' as const,
          },
        };
      }

      // Case B: New order or previously unmapped/in-flight order
      // Preserve immutable mapping snapshot if already captured on an in-flight IMPORTING order (Test R)
      let resolvedLines: ResolvedOrderLineMapping[] = [];
      const existingSnapshotLines = (
        orderRef?.mappingSnapshot as { lines?: ResolvedOrderLineMapping[] }
      )?.lines;

      if (
        orderRef &&
        orderRef.syncStatus === 'IMPORTING' &&
        Array.isArray(existingSnapshotLines) &&
        existingSnapshotLines.length === normalizedOrder.lines.length
      ) {
        resolvedLines = existingSnapshotLines;
      } else {
        const itemIds = Array.from(
          new Set(normalizedOrder.lines.map((l) => l.externalItemId)),
        );
        const mappings = await em.getRepository(SkuMappingEntity).find({
          where: {
            tenantId,
            connectionId: connection.id,
            externalItemId: In(itemIds),
          },
        });
        const mappingMap = new Map<string, SkuMappingEntity>();
        for (const m of mappings) {
          mappingMap.set(`${m.externalItemId}:${m.externalSkuId}`, m);
        }

        const variantIds = Array.from(
          new Set(mappings.map((m) => m.internalVariantId)),
        );
        const variants =
          variantIds.length > 0
            ? await em.getRepository(IntegrationCatalogVariantEntity).find({
                where: {
                  tenantId,
                  variantId: In(variantIds),
                },
              })
            : [];
        const variantMap = new Map(variants.map((v) => [v.variantId, v]));

        for (const line of normalizedOrder.lines) {
          const mapping = mappingMap.get(
            `${line.externalItemId}:${line.externalSkuId}`,
          );
          if (!mapping || mapping.status !== 'ACTIVE') {
            return await this.recordMappingConflictInTx(em, {
              tenantId,
              connection,
              normalizedOrder,
              existingOrderRef: orderRef,
              conflictType: !mapping ? 'SKU_UNMAPPED' : 'SKU_INACTIVE',
              unmappedLine: line,
              reason: !mapping
                ? `External SKU (${line.externalItemId} / ${line.externalSkuId}) is not mapped`
                : `SKU mapping for (${line.externalItemId} / ${line.externalSkuId}) is ${mapping.status}`,
            });
          }

          const catalogVariant = variantMap.get(mapping.internalVariantId);
          if (catalogVariant && catalogVariant.status !== 'ACTIVE') {
            return await this.recordMappingConflictInTx(em, {
              tenantId,
              connection,
              normalizedOrder,
              existingOrderRef: orderRef,
              conflictType: 'SKU_INACTIVE',
              unmappedLine: line,
              reason: `Internal Catalog variant ${mapping.internalSkuCode} is ${catalogVariant.status}`,
            });
          }

          resolvedLines.push({
            externalItemId: line.externalItemId,
            externalSkuId: line.externalSkuId,
            mappingId: mapping.id,
            mappingVersion: mapping.mappingVersion,
            internalVariantId: mapping.internalVariantId,
            internalSkuCode: mapping.internalSkuCode,
            itemName: line.itemName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineDiscount: line.lineDiscount,
          });
        }
      }

      const now = new Date();
      if (!orderRef) {
        orderRef = em.create(ChannelOrderRefEntity, {
          id: randomUUID(),
          tenantId,
          connectionId: connection.id,
          provider: connection.provider,
          externalShopId: normalizedOrder.externalShopId,
          externalOrderId: normalizedOrder.externalOrderId,
          internalOrderId: null,
          internalOrderCode: null,
          syncStatus: 'IMPORTING',
          externalStatus: normalizedOrder.externalStatus,
          normalizedStatus: normalizedOrder.normalizedStatus,
          statusRank: incomingRank,
          externalUpdatedAt: normalizedOrder.externalUpdatedAt,
          buyerName: normalizedOrder.buyerName,
          currency: normalizedOrder.currency,
          totalAmount: toMoney(normalizedOrder.totalAmount),
          shippingFee: toMoney(normalizedOrder.shippingFee),
          paymentMethod: normalizedOrder.paymentMethod,
          rawOrderSnapshot: normalizedOrder.rawPayload,
          mappingSnapshot: {
            capturedAt: now.toISOString(),
            lines: resolvedLines,
          },
          shortageDetails: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          version: 1,
          lastSyncedAt: now,
        });
        await em.save(ChannelOrderRefEntity, orderRef);

        await this.outbox.enqueue(em, INTEGRATION_EXTERNAL_ORDER_RECEIVED, {
          tenantId,
          aggregateId: orderRef.id,
          actor: { id: 'integration-worker', type: 'service' },
          payload: {
            channelOrderRefId: orderRef.id,
            connectionId: connection.id,
            provider: connection.provider,
            externalShopId: normalizedOrder.externalShopId,
            externalOrderId: normalizedOrder.externalOrderId,
            internalOrderId: null,
            syncStatus: orderRef.syncStatus,
            externalStatus: orderRef.externalStatus,
            normalizedStatus: orderRef.normalizedStatus,
            occurredAt: now.toISOString(),
          } satisfies IntegrationExternalOrderEventPayload,
        });
      } else {
        orderRef.syncStatus = 'IMPORTING';
        orderRef.mappingSnapshot = {
          capturedAt: now.toISOString(),
          lines: resolvedLines,
        };
        orderRef.lastErrorCode = null;
        orderRef.lastErrorMessage = null;
        orderRef.version += 1;
        await em.save(ChannelOrderRefEntity, orderRef);
      }

      return {
        action: 'CALL_SALES' as const,
        orderRefId: orderRef.id,
        resolvedLines,
      };
    });

    if (prep.action === 'DONE') {
      return prep.result;
    }

    // Phase 2: Invoke canonical Sales order intake with deterministic idempotency key
    const salesResult =
      await this.salesOrderClient.createOrRecoverOmnichannelOrder({
        tenantId,
        connectionId: connection.id,
        provider: connection.provider,
        externalShopId: normalizedOrder.externalShopId,
        externalOrderId: normalizedOrder.externalOrderId,
        branchId: connection.branchId,
        warehouseId: connection.warehouseId,
        buyerName: normalizedOrder.buyerName,
        currency: normalizedOrder.currency,
        shippingFee: normalizedOrder.shippingFee,
        paymentMethod: normalizedOrder.paymentMethod,
        normalizedStatus: normalizedOrder.normalizedStatus,
        autoConfirm: normalizedOrder.normalizedStatus !== 'UNPAID',
        lines: prep.resolvedLines.map((l) => ({
          variantId: l.internalVariantId,
          skuCode: l.internalSkuCode,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount,
        })),
        idempotencyKey: `omni-ord:${tenantId}:${connection.id}:${normalizedOrder.externalOrderId}`,
      });

    // Phase 3: Persist canonical Sales order reference & handle any stock shortage exception
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [
          tenantId,
          `ord-sync:${connection.id}:${normalizedOrder.externalOrderId}`,
        ],
      );

      const orderRef = await em.getRepository(ChannelOrderRefEntity).findOne({
        where: { id: prep.orderRefId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!orderRef) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.RECONCILIATION_REQUIRED,
          `ChannelOrderRef ${prep.orderRefId} missing after Sales order creation`,
          500,
        );
      }

      const now = new Date();
      orderRef.internalOrderId = salesResult.internalOrderId;
      orderRef.internalOrderCode = salesResult.internalOrderCode;
      orderRef.lastSyncedAt = now;
      orderRef.version += 1;

      let conflictId: string | undefined;
      if (salesResult.shortageDetected) {
        orderRef.syncStatus = 'SHORTAGE_HOLD';
        orderRef.shortageDetails = { shortages: salesResult.shortages };
        orderRef.lastErrorCode = 'STOCK_INSUFFICIENT';
        orderRef.lastErrorMessage =
          'Order imported into Sales in PENDING state due to insufficient available stock';

        const conflictCode = await nextIntegrationCode(em, tenantId, 'CNF');
        const conflict = em.create(SyncConflictEntity, {
          id: randomUUID(),
          tenantId,
          code: conflictCode,
          connectionId: connection.id,
          provider: connection.provider,
          conflictType: 'STOCK_INSUFFICIENT',
          severity: 'HIGH',
          status: 'OPEN',
          externalOrderId: normalizedOrder.externalOrderId,
          channelOrderRefId: orderRef.id,
          details: {
            internalOrderId: salesResult.internalOrderId,
            shortages: salesResult.shortages,
          },
        });
        await em.save(SyncConflictEntity, conflict);
        conflictId = conflict.id;
      } else {
        orderRef.syncStatus = 'IMPORTED';
        orderRef.shortageDetails = null;
        orderRef.lastErrorCode = null;
        orderRef.lastErrorMessage = null;
      }

      await em.save(ChannelOrderRefEntity, orderRef);

      // Update connection lastOrderSyncAt
      await em.update(
        ChannelConnectionEntity,
        { id: connection.id, tenantId },
        { lastOrderSyncAt: now, lastSyncAt: now },
      );

      await this.outbox.enqueue(em, INTEGRATION_EXTERNAL_ORDER_IMPORTED, {
        tenantId,
        aggregateId: orderRef.id,
        actor: { id: 'integration-worker', type: 'service' },
        payload: {
          channelOrderRefId: orderRef.id,
          connectionId: connection.id,
          provider: connection.provider,
          externalShopId: normalizedOrder.externalShopId,
          externalOrderId: normalizedOrder.externalOrderId,
          internalOrderId: orderRef.internalOrderId,
          syncStatus: orderRef.syncStatus,
          externalStatus: orderRef.externalStatus,
          normalizedStatus: orderRef.normalizedStatus,
          occurredAt: now.toISOString(),
        } satisfies IntegrationExternalOrderEventPayload,
      });

      return {
        orderRef,
        replayed: salesResult.replayed,
        statusOutcome: salesResult.shortageDetected
          ? 'SHORTAGE_HOLD'
          : 'IMPORTED',
        conflictId,
      };
    });
  }

  /**
   * Incremental order polling with safe overlap window (Section 20 / Test B & Test Q).
   */
  async pollUpdatedOrdersForConnection(params: {
    tenantId: string;
    connectionId: string;
    windowStart?: Date;
    windowEnd?: Date;
  }): Promise<{
    polledCount: number;
    importedCount: number;
    replayedCount: number;
    conflictCount: number;
    cursorUpdatedTo: string;
  }> {
    const creds =
      await this.connectionsService.getDecryptedCredentialsForWorker(
        params.tenantId,
        params.connectionId,
      );
    const adapter = this.providerRegistry.getAdapter(creds.connection.provider);

    const cursorInfo = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);
      return em.getRepository(SyncCursorEntity).findOne({
        where: {
          tenantId: params.tenantId,
          connectionId: params.connectionId,
          cursorType: 'ORDER_POLL',
        },
      });
    });

    const now = new Date();
    const defaultStart = cursorInfo?.windowEnd
      ? new Date(cursorInfo.windowEnd.getTime() - 5 * 60 * 1000) // 5-minute safety overlap
      : new Date(now.getTime() - 24 * 3600 * 1000);
    const windowStart = params.windowStart ?? defaultStart;
    const windowEnd = params.windowEnd ?? now;

    const polled = await adapter.pollUpdatedOrders({
      tenantId: params.tenantId,
      connectionId: params.connectionId,
      externalShopId: creds.connection.externalShopId,
      windowStart,
      windowEnd,
      cursor: cursorInfo?.cursorValue ?? null,
      accessToken: creds.accessToken,
      partnerSecret: creds.webhookSecret,
      partnerId: creds.partnerId,
    });

    let importedCount = 0;
    let replayedCount = 0;
    let conflictCount = 0;

    for (const order of polled.orders) {
      const res = await this.importNormalizedOrder(
        params.tenantId,
        creds.connection,
        order,
      );
      if (res.replayed || res.statusOutcome === 'IGNORE_STALE') {
        replayedCount += 1;
      } else if (
        res.statusOutcome === 'MAPPING_REQUIRED' ||
        res.statusOutcome === 'SHORTAGE_HOLD' ||
        res.statusOutcome === 'CONFLICT_RECONCILIATION_REQUIRED'
      ) {
        conflictCount += 1;
      } else {
        importedCount += 1;
      }
    }

    // Advance durable cursor only after all orders in window are processed
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);
      let cursor = await em.getRepository(SyncCursorEntity).findOne({
        where: {
          tenantId: params.tenantId,
          connectionId: params.connectionId,
          cursorType: 'ORDER_POLL',
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cursor) {
        cursor = em.create(SyncCursorEntity, {
          id: randomUUID(),
          tenantId: params.tenantId,
          connectionId: params.connectionId,
          provider: creds.connection.provider,
          cursorType: 'ORDER_POLL',
          cursorValue: polled.nextCursor ?? windowEnd.toISOString(),
          windowStart,
          windowEnd,
          lastSyncedAt: now,
        });
      } else {
        cursor.cursorValue = polled.nextCursor ?? windowEnd.toISOString();
        cursor.windowStart = windowStart;
        cursor.windowEnd = windowEnd;
        cursor.lastSyncedAt = now;
      }
      await em.save(SyncCursorEntity, cursor);
    });

    return {
      polledCount: polled.orders.length,
      importedCount,
      replayedCount,
      conflictCount,
      cursorUpdatedTo: windowEnd.toISOString(),
    };
  }

  private async recordMappingConflictInTx(
    em: any,
    params: {
      tenantId: string;
      connection: ChannelConnectionEntity;
      normalizedOrder: NormalizedExternalOrder;
      existingOrderRef: ChannelOrderRefEntity | null;
      conflictType: 'SKU_UNMAPPED' | 'SKU_INACTIVE';
      unmappedLine: NormalizedExternalOrder['lines'][number];
      reason: string;
    },
  ) {
    const now = new Date();
    let orderRef = params.existingOrderRef;
    if (!orderRef) {
      orderRef = em.create(ChannelOrderRefEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        connectionId: params.connection.id,
        provider: params.connection.provider,
        externalShopId: params.normalizedOrder.externalShopId,
        externalOrderId: params.normalizedOrder.externalOrderId,
        internalOrderId: null,
        internalOrderCode: null,
        syncStatus: 'MAPPING_REQUIRED',
        externalStatus: params.normalizedOrder.externalStatus,
        normalizedStatus: params.normalizedOrder.normalizedStatus,
        statusRank: getNormalizedStatusRank(
          params.normalizedOrder.normalizedStatus,
        ),
        externalUpdatedAt: params.normalizedOrder.externalUpdatedAt,
        buyerName: params.normalizedOrder.buyerName,
        currency: params.normalizedOrder.currency,
        totalAmount: toMoney(params.normalizedOrder.totalAmount),
        shippingFee: toMoney(params.normalizedOrder.shippingFee),
        paymentMethod: params.normalizedOrder.paymentMethod,
        rawOrderSnapshot: params.normalizedOrder.rawPayload,
        mappingSnapshot: null,
        shortageDetails: null,
        lastErrorCode:
          params.conflictType === 'SKU_UNMAPPED'
            ? IntegrationDomainErrorCode.EXTERNAL_SKU_UNKNOWN
            : IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE,
        lastErrorMessage: params.reason,
        version: 1,
        lastSyncedAt: now,
      });
    } else {
      orderRef.syncStatus = 'MAPPING_REQUIRED';
      orderRef.lastErrorCode =
        params.conflictType === 'SKU_UNMAPPED'
          ? IntegrationDomainErrorCode.EXTERNAL_SKU_UNKNOWN
          : IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE;
      orderRef.lastErrorMessage = params.reason;
      orderRef.version += 1;
      orderRef.lastSyncedAt = now;
    }
    await em.save(ChannelOrderRefEntity, orderRef);

    // Check if an OPEN conflict already exists for this order & SKU
    let conflict = await em.getRepository(SyncConflictEntity).findOne({
      where: {
        tenantId: params.tenantId,
        connectionId: params.connection.id,
        externalOrderId: params.normalizedOrder.externalOrderId,
        externalItemId: params.unmappedLine.externalItemId,
        externalSkuId: params.unmappedLine.externalSkuId,
        status: 'OPEN',
      },
    });
    if (!conflict) {
      const code = await nextIntegrationCode(em, params.tenantId, 'CNF');
      conflict = em.create(SyncConflictEntity, {
        id: randomUUID(),
        tenantId: params.tenantId,
        code,
        connectionId: params.connection.id,
        provider: params.connection.provider,
        conflictType: params.conflictType,
        severity: 'HIGH',
        status: 'OPEN',
        externalOrderId: params.normalizedOrder.externalOrderId,
        externalItemId: params.unmappedLine.externalItemId,
        externalSkuId: params.unmappedLine.externalSkuId,
        channelOrderRefId: orderRef.id,
        details: {
          reason: params.reason,
          unmappedLine: params.unmappedLine,
        },
      });
      await em.save(SyncConflictEntity, conflict);
    }

    await this.outbox.enqueue(em, INTEGRATION_EXTERNAL_ORDER_MAPPING_REQUIRED, {
      tenantId: params.tenantId,
      aggregateId: orderRef.id,
      actor: { id: 'integration-worker', type: 'service' },
      payload: {
        channelOrderRefId: orderRef.id,
        connectionId: params.connection.id,
        provider: params.connection.provider,
        externalShopId: params.normalizedOrder.externalShopId,
        externalOrderId: params.normalizedOrder.externalOrderId,
        internalOrderId: null,
        syncStatus: 'MAPPING_REQUIRED',
        externalStatus: orderRef.externalStatus,
        normalizedStatus: orderRef.normalizedStatus,
        reason: params.reason,
        occurredAt: now.toISOString(),
      } satisfies IntegrationExternalOrderEventPayload,
    });

    return {
      action: 'DONE' as const,
      result: {
        orderRef,
        replayed: false,
        statusOutcome: 'MAPPING_REQUIRED' as const,
        conflictId: conflict.id,
      },
    };
  }
}
