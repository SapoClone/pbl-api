import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { DataSource } from 'typeorm';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import {
  ChannelOrderRefEntity,
  IntegrationAuditLogEntity,
  SyncConflictEntity,
} from '../../infrastructure/persistence/integration.entities';
import { OrderSyncService } from '../order-sync/order-sync.service';
import { SkuMappingService } from '../sku-mapping/sku-mapping.service';
import { ResolveSyncConflictDto } from './conflicts.dto';

@Injectable()
export class ConflictsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly skuMappingService: SkuMappingService,
    private readonly orderSyncService: OrderSyncService,
  ) {}

  async listConflicts(filters?: {
    connectionId?: string;
    status?: string;
    conflictType?: string;
  }): Promise<SyncConflictEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (filters?.connectionId) where.connectionId = filters.connectionId;
      if (filters?.status) where.status = filters.status;
      if (filters?.conflictType) where.conflictType = filters.conflictType;
      return em.getRepository(SyncConflictEntity).find({
        where,
        order: { createdAt: 'DESC' },
      });
    });
  }

  async getConflictById(conflictId: string): Promise<SyncConflictEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conflict = await em.getRepository(SyncConflictEntity).findOne({
        where: { id: conflictId, tenantId },
      });
      if (!conflict) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CONFLICT_NOT_FOUND,
          `Sync conflict ${conflictId} not found`,
          404,
        );
      }
      return conflict;
    });
  }

  async resolveConflict(
    conflictId: string,
    actorId: string,
    dto: ResolveSyncConflictDto,
  ) {
    const tenantId = TenantContext.require();
    const conflict = await this.getConflictById(conflictId);
    if (conflict.status !== 'OPEN') {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CONFLICT_ALREADY_RESOLVED,
        `Sync conflict ${conflictId} is already ${conflict.status}`,
        409,
      );
    }

    // If operator supplied an internalVariantId for an unmapped SKU conflict, create the SKU mapping first
    if (
      dto.internalVariantId &&
      conflict.externalItemId &&
      conflict.externalSkuId
    ) {
      await this.skuMappingService.createMapping(actorId, {
        connectionId: conflict.connectionId,
        externalItemId: conflict.externalItemId,
        externalSkuId: conflict.externalSkuId,
        internalVariantId: dto.internalVariantId,
      });
    }

    const updatedConflict = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const row = await em.getRepository(SyncConflictEntity).findOne({
        where: { id: conflictId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CONFLICT_NOT_FOUND,
          `Sync conflict ${conflictId} not found`,
          404,
        );
      }
      row.status = dto.resolutionStatus;
      row.resolutionAction = dto.resolutionAction;
      row.resolutionNotes = dto.resolutionNotes ?? null;
      row.resolvedBy = actorId;
      row.resolvedAt = new Date();
      await em.save(SyncConflictEntity, row);

      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: row.connectionId,
          actorId,
          action: 'CONFLICT_RESOLVED',
          targetType: 'SYNC_CONFLICT',
          targetId: row.id,
          metadata: {
            conflictType: row.conflictType,
            resolutionStatus: row.status,
            resolutionAction: row.resolutionAction,
          },
        }),
      );

      return row;
    });

    let retryResult = null;
    if (dto.retryAfterResolve && updatedConflict.externalOrderId) {
      retryResult = await this.retryConflictOrderImport(
        tenantId,
        updatedConflict,
        actorId,
      );
    }

    return {
      conflict: updatedConflict,
      retryResult,
    };
  }

  async retryConflict(conflictId: string, actorId: string) {
    const tenantId = TenantContext.require();
    const conflict = await this.getConflictById(conflictId);
    if (!conflict.externalOrderId) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.VALIDATION_ERROR,
        `Conflict ${conflictId} is not linked to an external order`,
        400,
      );
    }

    const retryResult = await this.retryConflictOrderImport(
      tenantId,
      conflict,
      actorId,
    );

    if (
      retryResult.statusOutcome === 'IMPORTED' ||
      retryResult.statusOutcome === 'STATUS_UPDATED'
    ) {
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        await em.update(
          SyncConflictEntity,
          { id: conflict.id, tenantId },
          {
            status: 'RESOLVED',
            resolutionAction: 'RETRY_SUCCEEDED',
            resolvedBy: actorId,
            resolvedAt: new Date(),
          },
        );
      });
    }

    const refreshed = await this.getConflictById(conflictId);
    return {
      conflict: refreshed,
      retryResult,
    };
  }

  private async retryConflictOrderImport(
    tenantId: string,
    conflict: SyncConflictEntity,
    actorId: string,
  ) {
    const orderRef = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      if (conflict.channelOrderRefId) {
        return em.getRepository(ChannelOrderRefEntity).findOne({
          where: { id: conflict.channelOrderRefId, tenantId },
        });
      }
      return em.getRepository(ChannelOrderRefEntity).findOne({
        where: {
          tenantId,
          connectionId: conflict.connectionId,
          externalOrderId: conflict.externalOrderId!,
        },
      });
    });

    const res = await this.orderSyncService.importOrderByExternalId({
      tenantId,
      connectionId: conflict.connectionId,
      externalOrderId: conflict.externalOrderId!,
      inlineOrderPayload: orderRef?.rawOrderSnapshot,
    });

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: conflict.connectionId,
          actorId,
          action: 'CONFLICT_RETRIED',
          targetType: 'SYNC_CONFLICT',
          targetId: conflict.id,
          metadata: {
            externalOrderId: conflict.externalOrderId,
            statusOutcome: res.statusOutcome,
          },
        }),
      );
    });

    return res;
  }
}
