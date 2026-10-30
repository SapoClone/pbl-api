import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  INTEGRATION_SKU_MAPPING_CREATED,
  INTEGRATION_SKU_MAPPING_UPDATED,
  IntegrationSkuMappingEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, In, QueryFailedError } from 'typeorm';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import {
  ChannelConnectionEntity,
  IntegrationAuditLogEntity,
  IntegrationCatalogVariantEntity,
  SkuMappingEntity,
} from '../../infrastructure/persistence/integration.entities';
import { CreateSkuMappingDto, UpdateSkuMappingDto } from './sku-mapping.dto';

@Injectable()
export class SkuMappingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
  ) {}

  async createMapping(
    actorId: string,
    dto: CreateSkuMappingDto,
  ): Promise<SkuMappingEntity> {
    const tenantId = TenantContext.require();
    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: dto.connectionId, tenantId },
        });
        if (!conn) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
            `Channel connection ${dto.connectionId} not found in tenant`,
            404,
          );
        }

        const variant = await em
          .getRepository(IntegrationCatalogVariantEntity)
          .findOne({
            where: { variantId: dto.internalVariantId, tenantId },
          });
        if (!variant) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.INTERNAL_VARIANT_NOT_FOUND,
            `Internal Catalog variant ${dto.internalVariantId} does not exist in current tenant`,
            404,
          );
        }
        if (variant.status !== 'ACTIVE') {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE,
            `Internal Catalog variant ${variant.skuCode} (${dto.internalVariantId}) is ${variant.status} and cannot be mapped`,
            409,
          );
        }

        const existing = await em.getRepository(SkuMappingEntity).findOne({
          where: {
            tenantId,
            connectionId: conn.id,
            externalItemId: dto.externalItemId.trim(),
            externalSkuId: dto.externalSkuId.trim(),
          },
        });
        if (existing) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.SKU_MAPPING_CONFLICT,
            `External SKU (${dto.externalItemId} / ${dto.externalSkuId}) is already mapped to internal variant ${existing.internalSkuCode}`,
            409,
            { existingMappingId: existing.id },
          );
        }

        const now = new Date();
        const mapping = em.create(SkuMappingEntity, {
          id: randomUUID(),
          tenantId,
          connectionId: conn.id,
          provider: conn.provider,
          externalItemId: dto.externalItemId.trim(),
          externalSkuId: dto.externalSkuId.trim(),
          externalSkuCode: dto.externalSkuCode?.trim() ?? null,
          externalProductName: dto.externalProductName?.trim() ?? variant.name,
          internalProductId: variant.productId,
          internalVariantId: variant.variantId,
          internalSkuCode: variant.skuCode,
          mappingMode: dto.mappingMode ?? 'MANUAL',
          mappingVersion: 1,
          status: 'ACTIVE',
          listingSyncStatus: 'MAPPED',
          externalPrice:
            dto.externalPrice !== undefined
              ? dto.externalPrice.toFixed(2)
              : variant.basePrice,
          lastSyncedAt: now,
          createdBy: actorId,
          updatedBy: actorId,
        });
        await em.save(SkuMappingEntity, mapping);

        await em.save(
          IntegrationAuditLogEntity,
          em.create(IntegrationAuditLogEntity, {
            tenantId,
            connectionId: conn.id,
            actorId,
            action: 'SKU_MAPPING_CREATED',
            targetType: 'SKU_MAPPING',
            targetId: mapping.id,
            metadata: {
              externalItemId: mapping.externalItemId,
              externalSkuId: mapping.externalSkuId,
              internalVariantId: mapping.internalVariantId,
              internalSkuCode: mapping.internalSkuCode,
              mappingVersion: mapping.mappingVersion,
            },
          }),
        );

        await this.outbox.enqueue(em, INTEGRATION_SKU_MAPPING_CREATED, {
          tenantId,
          aggregateId: mapping.id,
          actor: { id: actorId, type: 'account' },
          payload: {
            mappingId: mapping.id,
            connectionId: mapping.connectionId,
            provider: mapping.provider,
            externalItemId: mapping.externalItemId,
            externalSkuId: mapping.externalSkuId,
            externalSkuCode: mapping.externalSkuCode,
            internalVariantId: mapping.internalVariantId,
            internalSkuCode: mapping.internalSkuCode,
            mappingVersion: mapping.mappingVersion,
            status: mapping.status,
            occurredAt: now.toISOString(),
          } satisfies IntegrationSkuMappingEventPayload,
        });

        return mapping;
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        String((err as any).code) === '23505'
      ) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SKU_MAPPING_CONFLICT,
          `Duplicate external SKU mapping for (${dto.externalItemId}, ${dto.externalSkuId})`,
          409,
        );
      }
      throw err;
    }
  }

  async listMappings(filters?: {
    connectionId?: string;
    internalVariantId?: string;
    status?: string;
  }): Promise<SkuMappingEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (filters?.connectionId) where.connectionId = filters.connectionId;
      if (filters?.internalVariantId) {
        where.internalVariantId = filters.internalVariantId;
      }
      if (filters?.status) where.status = filters.status;
      return em.getRepository(SkuMappingEntity).find({
        where,
        order: { createdAt: 'DESC' },
      });
    });
  }

  async getMappingById(mappingId: string): Promise<SkuMappingEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const mapping = await em.getRepository(SkuMappingEntity).findOne({
        where: { id: mappingId, tenantId },
      });
      if (!mapping) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SKU_MAPPING_NOT_FOUND,
          `SKU mapping ${mappingId} not found`,
          404,
        );
      }
      return mapping;
    });
  }

  async updateMapping(
    mappingId: string,
    actorId: string,
    dto: UpdateSkuMappingDto,
  ): Promise<SkuMappingEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const mapping = await em.getRepository(SkuMappingEntity).findOne({
        where: { id: mappingId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!mapping) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SKU_MAPPING_NOT_FOUND,
          `SKU mapping ${mappingId} not found`,
          404,
        );
      }

      if (
        dto.internalVariantId &&
        dto.internalVariantId !== mapping.internalVariantId
      ) {
        const variant = await em
          .getRepository(IntegrationCatalogVariantEntity)
          .findOne({
            where: { variantId: dto.internalVariantId, tenantId },
          });
        if (!variant) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.INTERNAL_VARIANT_NOT_FOUND,
            `Internal Catalog variant ${dto.internalVariantId} not found in tenant`,
            404,
          );
        }
        if (variant.status !== 'ACTIVE') {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE,
            `Internal Catalog variant ${variant.skuCode} is ${variant.status}`,
            409,
          );
        }
        mapping.internalVariantId = variant.variantId;
        mapping.internalProductId = variant.productId;
        mapping.internalSkuCode = variant.skuCode;
      }

      if (dto.externalSkuCode !== undefined) {
        mapping.externalSkuCode = dto.externalSkuCode.trim();
      }
      if (dto.externalProductName !== undefined) {
        mapping.externalProductName = dto.externalProductName.trim();
      }
      if (dto.status !== undefined) {
        mapping.status = dto.status;
      }
      if (dto.externalPrice !== undefined) {
        mapping.externalPrice = dto.externalPrice.toFixed(2);
      }

      mapping.mappingVersion += 1;
      mapping.updatedBy = actorId;
      await em.save(SkuMappingEntity, mapping);

      const now = new Date();
      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: mapping.connectionId,
          actorId,
          action: 'SKU_MAPPING_UPDATED',
          targetType: 'SKU_MAPPING',
          targetId: mapping.id,
          metadata: {
            internalVariantId: mapping.internalVariantId,
            internalSkuCode: mapping.internalSkuCode,
            mappingVersion: mapping.mappingVersion,
            status: mapping.status,
          },
        }),
      );

      await this.outbox.enqueue(em, INTEGRATION_SKU_MAPPING_UPDATED, {
        tenantId,
        aggregateId: mapping.id,
        actor: { id: actorId, type: 'account' },
        payload: {
          mappingId: mapping.id,
          connectionId: mapping.connectionId,
          provider: mapping.provider,
          externalItemId: mapping.externalItemId,
          externalSkuId: mapping.externalSkuId,
          externalSkuCode: mapping.externalSkuCode,
          internalVariantId: mapping.internalVariantId,
          internalSkuCode: mapping.internalSkuCode,
          mappingVersion: mapping.mappingVersion,
          status: mapping.status,
          occurredAt: now.toISOString(),
        } satisfies IntegrationSkuMappingEventPayload,
      });

      return mapping;
    });
  }

  async deleteMapping(
    mappingId: string,
    actorId: string,
  ): Promise<{ deleted: boolean; id: string }> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const mapping = await em.getRepository(SkuMappingEntity).findOne({
        where: { id: mappingId, tenantId },
      });
      if (!mapping) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.SKU_MAPPING_NOT_FOUND,
          `SKU mapping ${mappingId} not found`,
          404,
        );
      }
      await em.getRepository(SkuMappingEntity).delete({
        id: mapping.id,
        tenantId,
      });
      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: mapping.connectionId,
          actorId,
          action: 'SKU_MAPPING_DELETED',
          targetType: 'SKU_MAPPING',
          targetId: mapping.id,
          metadata: {
            externalItemId: mapping.externalItemId,
            externalSkuId: mapping.externalSkuId,
            internalSkuCode: mapping.internalSkuCode,
          },
        }),
      );
      return { deleted: true, id: mapping.id };
    });
  }

  /**
   * Batch resolves external SKU lines for a connection without N+1 queries.
   */
  async resolveBatchMappings(
    tenantId: string,
    connectionId: string,
    externalPairs: Array<{ externalItemId: string; externalSkuId: string }>,
  ): Promise<Map<string, SkuMappingEntity>> {
    if (externalPairs.length === 0) {
      return new Map();
    }
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const itemIds = Array.from(
        new Set(externalPairs.map((p) => p.externalItemId)),
      );
      const mappings = await em.getRepository(SkuMappingEntity).find({
        where: {
          tenantId,
          connectionId,
          externalItemId: In(itemIds),
        },
      });
      const map = new Map<string, SkuMappingEntity>();
      for (const m of mappings) {
        map.set(`${m.externalItemId}:${m.externalSkuId}`, m);
      }
      return map;
    });
  }
}
