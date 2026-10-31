import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  INTEGRATION_SYNC_JOB_COMPLETED,
  INTEGRATION_SYNC_JOB_FAILED,
  IntegrationSyncJobEventPayload,
} from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  MarketplaceProvider,
  SyncJobType,
  calculateBackoffDelayMs,
  classifyIntegrationError,
} from '../../domain/integration-domain';
import { nextIntegrationCode } from '../../infrastructure/persistence/integration-code.generator';
import {
  ChannelConnectionEntity,
  IntegrationAuditLogEntity,
  IntegrationDeadLetterEventEntity,
  SyncJobEntity,
} from '../../infrastructure/persistence/integration.entities';
import { ConnectionsService } from '../connections/connections.service';
import { InventorySyncService } from '../inventory-sync/inventory-sync.service';
import { OrderSyncService } from '../order-sync/order-sync.service';

export interface EnqueueSyncJobInput {
  tenantId: string;
  connectionId: string;
  jobType: SyncJobType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  correlationId?: string;
}

@Injectable()
export class SyncJobsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly connectionsService: ConnectionsService,
    private readonly orderSyncService: OrderSyncService,
    private readonly inventorySyncService: InventorySyncService,
    private readonly outbox: EventOutbox,
  ) {}

  async enqueueSyncJob(
    input: EnqueueSyncJobInput,
  ): Promise<{ job: SyncJobEntity; deduplicated: boolean }> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        input.tenantId,
      ]);
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [input.tenantId, `job-idem:${input.idempotencyKey}`],
      );

      const existing = await em.getRepository(SyncJobEntity).findOne({
        where: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing) {
        return { job: existing, deduplicated: true };
      }

      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: input.connectionId, tenantId: input.tenantId },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Connection ${input.connectionId} not found`,
          404,
        );
      }

      const code = await nextIntegrationCode(em, input.tenantId, 'JOB');
      const job = em.create(SyncJobEntity, {
        id: randomUUID(),
        tenantId: input.tenantId,
        code,
        connectionId: conn.id,
        provider: conn.provider,
        jobType: input.jobType,
        idempotencyKey: input.idempotencyKey,
        status: 'PENDING',
        priority: input.priority ?? 10,
        payload: input.payload ?? {},
        resultSummary: null,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 4,
        nextRetryAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCategory: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        correlationId: input.correlationId ?? null,
      });
      await em.save(SyncJobEntity, job);

      return { job, deduplicated: false };
    });
  }

  /**
   * Claims up to `batchSize` eligible jobs (including expired leases from crashed workers — Test M)
   * using PostgreSQL `FOR UPDATE SKIP LOCKED` and executes them.
   */
  async claimAndProcessBatch(params: {
    tenantId: string;
    workerId?: string;
    batchSize?: number;
    leaseDurationMs?: number;
    simulateCrashAfterClaim?: boolean;
  }): Promise<{ claimedCount: number; jobs: SyncJobEntity[] }> {
    const workerId = params.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    const batchSize = params.batchSize ?? 10;
    const leaseDurationMs = params.leaseDurationMs ?? 30_000;

    const claimedJobs = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        params.tenantId,
      ]);
      const table = qualifiedTable(em.connection, 'sync_jobs');
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

      const rows: Array<{ id: string }> = await em.query(
        `
        SELECT id
        FROM ${table}
        WHERE tenant_id = $1
          AND (
            (status IN ('PENDING', 'RETRY_SCHEDULED') AND next_retry_at <= $2::timestamptz)
            OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $2::timestamptz)
          )
        ORDER BY priority DESC, next_retry_at ASC, created_at ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
        `,
        [params.tenantId, now.toISOString(), batchSize],
      );

      const claimed: SyncJobEntity[] = [];
      for (const r of rows) {
        const job = await em.getRepository(SyncJobEntity).findOne({
          where: { id: r.id, tenantId: params.tenantId },
        });
        if (!job) continue;
        job.status = 'RUNNING';
        job.leaseOwner = workerId;
        job.leaseExpiresAt = leaseExpiresAt;
        job.attemptCount += 1;
        job.startedAt = job.startedAt ?? now;
        await em.save(SyncJobEntity, job);
        claimed.push(job);
      }
      return claimed;
    });

    if (params.simulateCrashAfterClaim) {
      return { claimedCount: claimedJobs.length, jobs: claimedJobs };
    }

    const processed: SyncJobEntity[] = [];
    for (const job of claimedJobs) {
      const updated = await this.executeClaimedJob(job, workerId);
      processed.push(updated);
    }

    return { claimedCount: claimedJobs.length, jobs: processed };
  }

  async executeJobById(
    tenantId: string,
    jobId: string,
    workerId = `worker-${randomUUID().slice(0, 8)}`,
  ): Promise<SyncJobEntity> {
    const claimed = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const job = await em.getRepository(SyncJobEntity).findOne({
        where: { id: jobId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SYNC_JOB_NOT_FOUND,
          `Sync job ${jobId} not found`,
          404,
        );
      }
      const now = new Date();
      if (
        job.status === 'RUNNING' &&
        job.leaseOwner &&
        job.leaseOwner !== workerId &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt.getTime() > now.getTime()
      ) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SYNC_JOB_ALREADY_RUNNING,
          `Sync job ${jobId} is currently leased by ${job.leaseOwner}`,
          409,
        );
      }
      if (job.status === 'COMPLETED') {
        return { alreadyCompleted: true as const, job };
      }

      job.status = 'RUNNING';
      job.leaseOwner = workerId;
      job.leaseExpiresAt = new Date(now.getTime() + 30_000);
      job.attemptCount += 1;
      job.startedAt = job.startedAt ?? now;
      await em.save(SyncJobEntity, job);

      return { alreadyCompleted: false as const, job };
    });

    if (claimed.alreadyCompleted) {
      return claimed.job;
    }

    return this.executeClaimedJob(claimed.job, workerId);
  }

  private async executeClaimedJob(
    job: SyncJobEntity,
    workerId: string,
  ): Promise<SyncJobEntity> {
    try {
      let resultSummary: Record<string, unknown> = {};
      const payload = job.payload ?? {};

      if (job.jobType === 'ORDER_IMPORT') {
        const externalOrderId = String(payload.externalOrderId ?? '');
        const importRes = await this.orderSyncService.importOrderByExternalId({
          tenantId: job.tenantId,
          connectionId: job.connectionId!,
          externalOrderId,
          inlineOrderPayload: payload.rawOrder as
            | Record<string, unknown>
            | undefined,
        });
        if (importRes.statusOutcome === 'MAPPING_REQUIRED') {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.EXTERNAL_SKU_UNKNOWN,
            `Order ${externalOrderId} requires SKU mapping resolution`,
            409,
            { conflictId: importRes.conflictId },
          );
        }
        resultSummary = {
          channelOrderRefId: importRes.orderRef.id,
          internalOrderId: importRes.orderRef.internalOrderId,
          statusOutcome: importRes.statusOutcome,
          replayed: importRes.replayed,
        };
      } else if (job.jobType === 'ORDER_POLL') {
        resultSummary =
          await this.orderSyncService.pollUpdatedOrdersForConnection({
            tenantId: job.tenantId,
            connectionId: job.connectionId!,
          });
      } else if (job.jobType === 'INVENTORY_PUBLICATION') {
        if (payload.internalVariantId) {
          const pubRes =
            await this.inventorySyncService.recordStockChangeAndPublish({
              tenantId: job.tenantId,
              internalVariantId: String(payload.internalVariantId),
              warehouseId: payload.warehouseId
                ? String(payload.warehouseId)
                : undefined,
              onHandQty: Number(payload.onHandQty ?? 0),
              reservedQty: Number(payload.reservedQty ?? 0),
              stockVersion: Number(payload.stockVersion ?? 1),
              connectionId: job.connectionId ?? undefined,
            });
          resultSummary = { ...pubRes };
        } else {
          resultSummary =
            await this.inventorySyncService.syncAllInventoryForConnection(
              job.tenantId,
              job.connectionId!,
            );
        }
      } else if (
        job.jobType === 'PRODUCT_MAPPING_SYNC' ||
        job.jobType === 'PRODUCT_PUBLICATION'
      ) {
        resultSummary =
          await this.inventorySyncService.syncProductListingsForConnection(
            job.tenantId,
            job.connectionId!,
            workerId,
          );
      } else if (job.jobType === 'CONNECTION_TOKEN_REFRESH') {
        const refreshRes = await TenantContext.run(job.tenantId, () =>
          this.connectionsService.refreshCredentials(
            job.connectionId!,
            workerId,
            { workerId },
          ),
        );
        resultSummary = {
          refreshed: refreshRes.refreshed,
          status: refreshRes.status,
        };
      }

      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          job.tenantId,
        ]);
        const current = await em.getRepository(SyncJobEntity).findOne({
          where: { id: job.id, tenantId: job.tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) return job;

        const now = new Date();
        current.status = 'COMPLETED';
        current.resultSummary = resultSummary;
        current.leaseOwner = null;
        current.leaseExpiresAt = null;
        current.errorCategory = null;
        current.lastErrorCode = null;
        current.lastErrorMessage = null;
        current.completedAt = now;
        await em.save(SyncJobEntity, current);

        await this.outbox.enqueue(em, INTEGRATION_SYNC_JOB_COMPLETED, {
          tenantId: current.tenantId,
          aggregateId: current.id,
          actor: { id: workerId, type: 'service' },
          payload: {
            jobId: current.id,
            connectionId: current.connectionId,
            provider: current.provider,
            jobType: current.jobType,
            status: 'COMPLETED',
            attemptCount: current.attemptCount,
            occurredAt: now.toISOString(),
          } satisfies IntegrationSyncJobEventPayload,
        });

        return current;
      });
    } catch (error) {
      const classified = classifyIntegrationError(error);
      const errMsg = error instanceof Error ? error.message : String(error);

      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          job.tenantId,
        ]);
        const current = await em.getRepository(SyncJobEntity).findOne({
          where: { id: job.id, tenantId: job.tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) return job;

        const now = new Date();
        current.leaseOwner = null;
        current.leaseExpiresAt = null;
        current.errorCategory = classified.category;
        current.lastErrorCode = classified.code;
        current.lastErrorMessage = errMsg;

        const canRetry =
          classified.retryable && current.attemptCount < current.maxAttempts;

        if (canRetry) {
          const delayMs = calculateBackoffDelayMs({
            attemptCount: current.attemptCount,
            retryAfterSeconds: classified.retryAfterSeconds,
          });
          current.status = 'RETRY_SCHEDULED';
          current.nextRetryAt = new Date(now.getTime() + delayMs);
          await em.save(SyncJobEntity, current);
          return current;
        }

        // Route to Dead-Letter Queue (Section 19 / Test N)
        current.status = 'DEAD_LETTERED';
        current.completedAt = now;
        await em.save(SyncJobEntity, current);

        let dlq = await em
          .getRepository(IntegrationDeadLetterEventEntity)
          .findOne({
            where: {
              tenantId: current.tenantId,
              sourceType: 'SYNC_JOB',
              sourceId: current.id,
            },
          });
        if (!dlq) {
          dlq = em.create(IntegrationDeadLetterEventEntity, {
            id: randomUUID(),
            tenantId: current.tenantId,
            connectionId: current.connectionId,
            provider: current.provider as MarketplaceProvider | null,
            sourceType: 'SYNC_JOB',
            sourceId: current.id,
            idempotencyKey: current.idempotencyKey,
            payload: current.payload,
            errorCategory: classified.category,
            errorCode: classified.code,
            errorMessage: errMsg,
            attemptCount: current.attemptCount,
            status: 'DEAD_LETTERED',
          });
        } else {
          dlq.errorCategory = classified.category;
          dlq.errorCode = classified.code;
          dlq.errorMessage = errMsg;
          dlq.attemptCount = current.attemptCount;
          dlq.status = 'DEAD_LETTERED';
        }
        await em.save(IntegrationDeadLetterEventEntity, dlq);

        await this.outbox.enqueue(em, INTEGRATION_SYNC_JOB_FAILED, {
          tenantId: current.tenantId,
          aggregateId: current.id,
          actor: { id: workerId, type: 'service' },
          payload: {
            jobId: current.id,
            connectionId: current.connectionId,
            provider: current.provider,
            jobType: current.jobType,
            status: 'DEAD_LETTERED',
            attemptCount: current.attemptCount,
            errorCategory: classified.category,
            errorMessage: errMsg,
            occurredAt: now.toISOString(),
          } satisfies IntegrationSyncJobEventPayload,
        });

        return current;
      });
    }
  }

  async listSyncJobs(filters?: {
    connectionId?: string;
    status?: string;
    jobType?: string;
  }): Promise<SyncJobEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (filters?.connectionId) where.connectionId = filters.connectionId;
      if (filters?.status) where.status = filters.status;
      if (filters?.jobType) where.jobType = filters.jobType;
      return em.getRepository(SyncJobEntity).find({
        where,
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });
  }

  async getSyncJobById(jobId: string): Promise<SyncJobEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const job = await em.getRepository(SyncJobEntity).findOne({
        where: { id: jobId, tenantId },
      });
      if (!job) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SYNC_JOB_NOT_FOUND,
          `Sync job ${jobId} not found`,
          404,
        );
      }
      return job;
    });
  }

  /**
   * Authorized operator replay of a failed or dead-lettered sync job (Test N).
   */
  async retrySyncJob(
    jobId: string,
    actorId: string,
    options?: { reason?: string; executeImmediately?: boolean },
  ): Promise<SyncJobEntity> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const job = await em.getRepository(SyncJobEntity).findOne({
        where: { id: jobId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SYNC_JOB_NOT_FOUND,
          `Sync job ${jobId} not found`,
          404,
        );
      }

      const now = new Date();
      job.status = 'PENDING';
      job.nextRetryAt = now;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.maxAttempts = Math.max(job.maxAttempts, job.attemptCount + 3);
      await em.save(SyncJobEntity, job);

      // If in DLQ, mark DLQ entry as REPLAYED
      const dlq = await em
        .getRepository(IntegrationDeadLetterEventEntity)
        .findOne({
          where: {
            tenantId,
            sourceType: 'SYNC_JOB',
            sourceId: job.id,
          },
        });
      if (dlq) {
        dlq.status = 'REPLAYED';
        dlq.replayedBy = actorId;
        dlq.replayedAt = now;
        await em.save(IntegrationDeadLetterEventEntity, dlq);
      }

      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: job.connectionId,
          actorId,
          action: 'SYNC_JOB_REPLAYED',
          targetType: 'SYNC_JOB',
          targetId: job.id,
          metadata: {
            jobType: job.jobType,
            reason: options?.reason ?? 'Manual operator replay',
          },
        }),
      );
    });

    if (options?.executeImmediately !== false) {
      return this.executeJobById(tenantId, jobId, `replay-${actorId}`);
    }
    return this.getSyncJobById(jobId);
  }
}
