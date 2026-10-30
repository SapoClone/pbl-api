import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  INTEGRATION_RECONCILIATION_DISCREPANCY_DETECTED,
  IntegrationReconciliationDiscrepancyPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import { nextIntegrationCode } from '../../infrastructure/persistence/integration-code.generator';
import {
  ChannelConnectionEntity,
  ChannelInventoryPublicationEntity,
  ChannelOrderRefEntity,
  IntegrationDeadLetterEventEntity,
  IntegrationReconciliationIssueEntity,
  IntegrationReconciliationRunEntity,
  IntegrationStockProjectionEntity,
  SyncJobEntity,
} from '../../infrastructure/persistence/integration.entities';
import { ProviderRateLimiterService } from '../../infrastructure/rate-limiting/provider-rate-limiter.service';
import { InventorySyncService } from '../inventory-sync/inventory-sync.service';
import { OrderSyncService } from '../order-sync/order-sync.service';
import { TriggerReconciliationRunDto } from './reconciliation.dto';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderSyncService: OrderSyncService,
    private readonly inventorySyncService: InventorySyncService,
    private readonly rateLimiter: ProviderRateLimiterService,
    private readonly outbox: EventOutbox,
  ) {}

  async executeReconciliationRun(
    actorId: string,
    dto: TriggerReconciliationRunDto,
  ) {
    const tenantId = TenantContext.require();
    const runType = dto.runType ?? 'INCREMENTAL';
    const autoRecover = dto.autoRecoverSafeItems !== false;
    const now = new Date();
    const windowStart = new Date(now.getTime() - 24 * 3600 * 1000);

    // Step 1: Create reconciliation_runs header
    const { run, connections } = await this.dataSource.transaction(
      async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const code = await nextIntegrationCode(em, tenantId, 'REC');
        const whereConn: Record<string, unknown> = { tenantId };
        if (dto.connectionId) {
          whereConn.id = dto.connectionId;
        }
        const conns = await em
          .getRepository(ChannelConnectionEntity)
          .find({ where: whereConn });
        if (dto.connectionId && conns.length === 0) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
            `Connection ${dto.connectionId} not found`,
            404,
          );
        }

        const createdRun = em.create(IntegrationReconciliationRunEntity, {
          id: randomUUID(),
          tenantId,
          code,
          connectionId: dto.connectionId ?? null,
          provider: conns.length === 1 ? conns[0].provider : null,
          runType,
          status: 'RUNNING',
          windowStart,
          windowEnd: now,
          recordsExamined: 0,
          matchedCount: 0,
          mismatchCount: 0,
          autoRecoveredCount: 0,
          startedAt: now,
          completedAt: null,
          triggeredBy: actorId,
        });
        await em.save(IntegrationReconciliationRunEntity, createdRun);
        return { run: createdRun, connections: conns };
      },
    );

    let recordsExamined = 0;
    let matchedCount = 0;
    let mismatchCount = 0;
    let autoRecoveredCount = 0;
    const detectedIssues: Array<{
      connectionId: string | null;
      provider: 'SHOPEE' | 'LAZADA' | null;
      issueType: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      externalRef: string | null;
      internalRef: string | null;
      expectedState: Record<string, unknown>;
      observedState: Record<string, unknown>;
      status: 'OPEN' | 'RESOLVED';
      resolutionNotes?: string;
    }> = [];

    // Step 2: Poll connected channels for missed/lost webhooks (Category 1 / Test Q)
    for (const conn of connections) {
      recordsExamined += 1;
      if (
        conn.status === 'TOKEN_EXPIRED' ||
        conn.status === 'REAUTH_REQUIRED'
      ) {
        mismatchCount += 1;
        detectedIssues.push({
          connectionId: conn.id,
          provider: conn.provider,
          issueType: 'PROVIDER_CREDENTIALS_EXPIRED',
          severity: 'CRITICAL',
          externalRef: conn.externalShopId,
          internalRef: conn.id,
          expectedState: { status: 'CONNECTED' },
          observedState: { status: conn.status, error: conn.lastErrorCode },
          status: 'OPEN',
        });
        continue;
      }

      if (conn.status === 'CONNECTED') {
        try {
          const pollSummary =
            await this.orderSyncService.pollUpdatedOrdersForConnection({
              tenantId,
              connectionId: conn.id,
              windowStart,
              windowEnd: now,
            });
          recordsExamined += pollSummary.polledCount;
          matchedCount += pollSummary.replayedCount;
          if (pollSummary.importedCount > 0) {
            autoRecoveredCount += pollSummary.importedCount;
            detectedIssues.push({
              connectionId: conn.id,
              provider: conn.provider,
              issueType: 'MISSED_WEBHOOK_ORDER_RECOVERED',
              severity: 'MEDIUM',
              externalRef: conn.externalShopId,
              internalRef: conn.id,
              expectedState: { importedViaWebhook: true },
              observedState: {
                recoveredOrderCount: pollSummary.importedCount,
              },
              status: 'RESOLVED',
              resolutionNotes: `Auto-imported ${pollSummary.importedCount} missed external order(s) via incremental polling`,
            });
          }
        } catch {
          // Continue examining local state even if live polling is blocked
        }
      }
    }

    // Step 3: Inspect ChannelOrderRefs (Categories 2, 3, 4, 5 — including Test S lost-response recovery)
    const orderRefs = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (dto.connectionId) where.connectionId = dto.connectionId;
      return em.getRepository(ChannelOrderRefEntity).find({ where });
    });

    for (const ref of orderRefs) {
      recordsExamined += 1;
      if (ref.syncStatus === 'IMPORTED' && ref.internalOrderId) {
        matchedCount += 1;
        continue;
      }

      // Category 2: Order stuck in IMPORTING without confirmed internalOrderId (Test S)
      if (
        ref.syncStatus === 'IMPORTING' &&
        !ref.internalOrderId &&
        autoRecover
      ) {
        const recovered = await this.orderSyncService.importOrderByExternalId({
          tenantId,
          connectionId: ref.connectionId,
          externalOrderId: ref.externalOrderId,
          inlineOrderPayload: ref.rawOrderSnapshot,
        });
        if (recovered.orderRef.internalOrderId) {
          autoRecoveredCount += 1;
          matchedCount += 1;
          detectedIssues.push({
            connectionId: ref.connectionId,
            provider: ref.provider,
            issueType: 'UNCONFIRMED_ORDER_REF_RECOVERED',
            severity: 'MEDIUM',
            externalRef: ref.externalOrderId,
            internalRef: recovered.orderRef.internalOrderId,
            expectedState: { syncStatus: 'IMPORTED' },
            observedState: { previousSyncStatus: 'IMPORTING' },
            status: 'RESOLVED',
            resolutionNotes:
              'Recovered canonical Sales order using original idempotency reference without duplicate order creation',
          });
          continue;
        }
      }

      mismatchCount += 1;
      detectedIssues.push({
        connectionId: ref.connectionId,
        provider: ref.provider,
        issueType: `ORDER_${ref.syncStatus}`,
        severity: 'HIGH',
        externalRef: ref.externalOrderId,
        internalRef: ref.internalOrderId,
        expectedState: { syncStatus: 'IMPORTED' },
        observedState: {
          syncStatus: ref.syncStatus,
          errorCode: ref.lastErrorCode,
        },
        status: 'OPEN',
      });
    }

    // Step 4: Inspect ChannelInventoryPublications for UNKNOWN_OUTCOME / FAILED or remote drift (Category 6 / Test J & Test K)
    const publications = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (dto.connectionId) where.connectionId = dto.connectionId;
      return em
        .getRepository(ChannelInventoryPublicationEntity)
        .find({ where });
    });

    for (const pub of publications) {
      recordsExamined += 1;
      const remoteSimulated = this.rateLimiter.getSimulatedRemoteStock(
        pub.connectionId,
        pub.externalItemId,
        pub.externalSkuId,
      );
      const hasDrift =
        pub.status === 'FAILED' ||
        pub.status === 'UNKNOWN_OUTCOME' ||
        (remoteSimulated !== undefined &&
          remoteSimulated.quantity !== pub.targetPublishedQty);

      if (!hasDrift) {
        matchedCount += 1;
        continue;
      }

      if (autoRecover) {
        const proj = await this.dataSource.transaction(async (em) => {
          await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
            tenantId,
          ]);
          return em.getRepository(IntegrationStockProjectionEntity).findOne({
            where: { tenantId, skuId: pub.internalVariantId },
          });
        });

        if (proj) {
          const nextVer =
            Math.max(
              Number(proj.stockVersion),
              Number(pub.stockVersion),
              Number(pub.lastPublishedStockVersion),
            ) + 1;
          const repub =
            await this.inventorySyncService.recordStockChangeAndPublish({
              tenantId,
              internalVariantId: pub.internalVariantId,
              warehouseId: proj.warehouseId,
              onHandQty: Number(proj.onHandQty),
              reservedQty: Number(proj.reservedQty),
              stockVersion: nextVer,
              connectionId: pub.connectionId,
            });
          const succeeded = repub.publications.some(
            (p) => p.status === 'SUCCEEDED',
          );
          if (succeeded) {
            autoRecoveredCount += 1;
            matchedCount += 1;
            detectedIssues.push({
              connectionId: pub.connectionId,
              provider: pub.provider,
              issueType: 'INVENTORY_PUBLICATION_RECONCILED',
              severity: 'MEDIUM',
              externalRef: `${pub.externalItemId}:${pub.externalSkuId}`,
              internalRef: pub.internalVariantId,
              expectedState: { publishedQty: pub.targetPublishedQty },
              observedState: {
                previousStatus: pub.status,
                remoteQtyBefore: remoteSimulated?.quantity ?? null,
              },
              status: 'RESOLVED',
              resolutionNotes:
                'Reconciled and converged external marketplace stock to latest internal sellable quantity',
            });
            continue;
          }
        }
      }

      mismatchCount += 1;
      detectedIssues.push({
        connectionId: pub.connectionId,
        provider: pub.provider,
        issueType: 'INVENTORY_PUBLICATION_DISCREPANCY',
        severity: 'HIGH',
        externalRef: `${pub.externalItemId}:${pub.externalSkuId}`,
        internalRef: pub.internalVariantId,
        expectedState: {
          status: 'SUCCEEDED',
          targetPublishedQty: pub.targetPublishedQty,
        },
        observedState: {
          status: pub.status,
          lastConfirmedQty: pub.lastConfirmedQty,
          remoteQty: remoteSimulated?.quantity ?? null,
        },
        status: 'OPEN',
      });
    }

    // Step 5: Inspect stuck jobs & dead-lettered events (Categories 9 & 11)
    const { dlqEvents, stuckJobs } = await this.dataSource.transaction(
      async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const dlq = await em
          .getRepository(IntegrationDeadLetterEventEntity)
          .find({
            where: { tenantId, status: 'DEAD_LETTERED' },
          });
        const running = await em.getRepository(SyncJobEntity).find({
          where: { tenantId, status: 'RUNNING' },
        });
        const stuck = running.filter(
          (j) =>
            j.leaseExpiresAt !== null &&
            j.leaseExpiresAt.getTime() <= Date.now(),
        );
        return { dlqEvents: dlq, stuckJobs: stuck };
      },
    );

    for (const d of dlqEvents) {
      recordsExamined += 1;
      mismatchCount += 1;
      detectedIssues.push({
        connectionId: d.connectionId,
        provider: d.provider,
        issueType: 'DEAD_LETTERED_EVENT_UNRESOLVED',
        severity: 'HIGH',
        externalRef: d.idempotencyKey,
        internalRef: d.sourceId,
        expectedState: { status: 'PROCESSED' },
        observedState: {
          status: d.status,
          errorCode: d.errorCode,
          attemptCount: d.attemptCount,
        },
        status: 'OPEN',
      });
    }

    for (const s of stuckJobs) {
      recordsExamined += 1;
      mismatchCount += 1;
      detectedIssues.push({
        connectionId: s.connectionId,
        provider: s.provider,
        issueType: 'SYNC_JOB_LEASE_EXPIRED',
        severity: 'MEDIUM',
        externalRef: s.idempotencyKey,
        internalRef: s.id,
        expectedState: { status: 'COMPLETED' },
        observedState: {
          status: s.status,
          leaseOwner: s.leaseOwner,
          leaseExpiresAt: s.leaseExpiresAt?.toISOString() ?? null,
        },
        status: 'OPEN',
      });
    }

    // Step 6: Persist reconciliation run completion & issues
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const savedIssues: IntegrationReconciliationIssueEntity[] = [];
      for (const item of detectedIssues) {
        const issue = em.create(IntegrationReconciliationIssueEntity, {
          id: randomUUID(),
          tenantId,
          runId: run.id,
          connectionId: item.connectionId,
          provider: item.provider,
          issueType: item.issueType,
          severity: item.severity,
          externalRef: item.externalRef,
          internalRef: item.internalRef,
          expectedState: item.expectedState,
          observedState: item.observedState,
          status: item.status,
          resolutionNotes: item.resolutionNotes ?? null,
          resolvedBy: item.status === 'RESOLVED' ? 'auto-reconciler' : null,
          resolvedAt: item.status === 'RESOLVED' ? new Date() : null,
          relatedSyncJobId: null,
        });
        await em.save(IntegrationReconciliationIssueEntity, issue);
        savedIssues.push(issue);

        if (issue.status === 'OPEN') {
          await this.outbox.enqueue(
            em,
            INTEGRATION_RECONCILIATION_DISCREPANCY_DETECTED,
            {
              tenantId,
              aggregateId: run.id,
              actor: { id: actorId, type: 'account' },
              payload: {
                runId: run.id,
                issueId: issue.id,
                connectionId: issue.connectionId,
                provider: issue.provider,
                issueType: issue.issueType,
                severity: issue.severity,
                externalRef: issue.externalRef,
                internalRef: issue.internalRef,
                occurredAt: new Date().toISOString(),
              } satisfies IntegrationReconciliationDiscrepancyPayload,
            },
          );
        }
      }

      run.status = 'COMPLETED';
      run.recordsExamined = recordsExamined;
      run.matchedCount = matchedCount;
      run.mismatchCount = mismatchCount;
      run.autoRecoveredCount = autoRecoveredCount;
      run.completedAt = new Date();
      await em.save(IntegrationReconciliationRunEntity, run);

      return {
        run,
        issues: savedIssues,
      };
    });
  }

  async listReconciliationRuns(): Promise<
    IntegrationReconciliationRunEntity[]
  > {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em.getRepository(IntegrationReconciliationRunEntity).find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
    });
  }

  async getReconciliationRunById(runId: string) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const run = await em
        .getRepository(IntegrationReconciliationRunEntity)
        .findOne({
          where: { id: runId, tenantId },
        });
      if (!run) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.RECONCILIATION_RUN_NOT_FOUND,
          `Reconciliation run ${runId} not found`,
          404,
        );
      }
      const issues = await em
        .getRepository(IntegrationReconciliationIssueEntity)
        .find({
          where: { runId: run.id, tenantId },
          order: { createdAt: 'ASC' },
        });
      return { run, issues };
    });
  }
}
