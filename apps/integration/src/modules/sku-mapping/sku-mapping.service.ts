import { Injectable, Optional } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  INTEGRATION_SKU_MAPPING_CREATED,
  INTEGRATION_SKU_MAPPING_UPDATED,
  IntegrationSkuMappingEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, In, QueryFailedError } from 'typeorm';
import { roundVnd } from '../../common/money';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
} from '../../domain/integration-domain';
import {
  ChannelConnectionEntity,
  IntegrationAuditLogEntity,
  IntegrationCatalogVariantEntity,
  SkuMappingEntity,
  SyncConflictEntity,
} from '../../infrastructure/persistence/integration.entities';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { ConnectionsService } from '../connections/connections.service';
import {
  AutoMatchSkuMappingsDto,
  CreateSkuMappingDto,
  UpdateSkuMappingDto,
} from './sku-mapping.dto';

export interface AutoMatchCandidateView {
  externalItemId: string;
  externalSkuId: string;
  externalSkuCode: string | null;
  externalProductName: string;
  externalPrice: number | null;
  source: 'MARKETPLACE_LISTING' | 'OPEN_CONFLICT';
  conflictId?: string | null;
  matched: boolean;
  confidence: 'EXACT_SKU' | 'NORMALIZED_SKU' | 'BARCODE' | 'UNMATCHED';
  internalVariantId: string | null;
  internalProductId: string | null;
  internalSkuCode: string | null;
  internalVariantName: string | null;
  internalBasePrice: number | null;
  priceDelta: number | null;
}

@Injectable()
export class SkuMappingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: EventOutbox,
    @Optional() private readonly connectionsService?: ConnectionsService,
    @Optional() private readonly providerRegistry?: ProviderRegistryService,
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
              ? dto.externalPrice
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
        mapping.externalPrice = dto.externalPrice;
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

  private normalizeSkuToken(raw?: string | null): string {
    if (!raw) return '';
    return raw
      .trim()
      .toUpperCase()
      .replace(/^(LAZ|SHP|LZD|SHOP)[-_]/, '')
      .replace(/[^A-Z0-9]/g, '');
  }

  async autoMatchMappings(actorId: string, dto: AutoMatchSkuMappingsDto) {
    const tenantId = TenantContext.require();
    const dryRun = dto.dryRun !== false;

    // If commit mode with explicit user-confirmed pairs, create them atomically
    if (!dryRun && dto.selectedPairs && dto.selectedPairs.length > 0) {
      return this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: dto.connectionId, tenantId },
        });
        if (!conn) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
            `Channel connection ${dto.connectionId} not found`,
            404,
          );
        }

        const variantIds = [
          ...new Set(dto.selectedPairs!.map((p) => p.internalVariantId)),
        ];
        const variants = await em
          .getRepository(IntegrationCatalogVariantEntity)
          .find({
            where: { tenantId, variantId: In(variantIds), status: 'ACTIVE' },
          });
        const variantById = new Map(variants.map((v) => [v.variantId, v]));

        const createdMappings: SkuMappingEntity[] = [];
        let skippedCount = 0;
        const now = new Date();

        for (const pair of dto.selectedPairs!) {
          const variant = variantById.get(pair.internalVariantId);
          if (!variant) {
            skippedCount += 1;
            continue;
          }
          const existing = await em.getRepository(SkuMappingEntity).findOne({
            where: {
              tenantId,
              connectionId: conn.id,
              externalItemId: pair.externalItemId.trim(),
              externalSkuId: pair.externalSkuId.trim(),
            },
          });
          if (existing) {
            skippedCount += 1;
            continue;
          }

          const mapping = em.create(SkuMappingEntity, {
            id: randomUUID(),
            tenantId,
            connectionId: conn.id,
            provider: conn.provider,
            externalItemId: pair.externalItemId.trim(),
            externalSkuId: pair.externalSkuId.trim(),
            externalSkuCode: pair.externalSkuCode?.trim() ?? variant.skuCode,
            externalProductName:
              pair.externalProductName?.trim() ?? variant.name,
            internalProductId: variant.productId,
            internalVariantId: variant.variantId,
            internalSkuCode: variant.skuCode,
            mappingMode: 'EXACT_SKU_AUTO',
            mappingVersion: 1,
            status: 'ACTIVE',
            listingSyncStatus: 'MAPPED',
            externalPrice:
              pair.externalPrice !== undefined
                ? roundVnd(pair.externalPrice)
                : variant.basePrice,
            lastSyncedAt: now,
            createdBy: actorId,
            updatedBy: actorId,
          });
          await em.save(SkuMappingEntity, mapping);
          createdMappings.push(mapping);

          // Auto-resolve matching open UNMAPPED_SKU conflicts if any
          await em.update(
            SyncConflictEntity,
            {
              tenantId,
              connectionId: conn.id,
              externalItemId: mapping.externalItemId,
              externalSkuId: mapping.externalSkuId,
              status: 'OPEN',
            },
            {
              status: 'RESOLVED',
              resolutionAction: 'AUTO_MATCHED_SKU',
              resolutionNotes: `Auto-matched to internal SKU ${variant.skuCode}`,
              resolvedBy: actorId,
              resolvedAt: now,
            },
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
        }

        await em.save(
          IntegrationAuditLogEntity,
          em.create(IntegrationAuditLogEntity, {
            tenantId,
            connectionId: conn.id,
            actorId,
            action: 'SKU_AUTO_MATCH_BATCH',
            targetType: 'CHANNEL_CONNECTION',
            targetId: conn.id,
            metadata: {
              createdCount: createdMappings.length,
              skippedCount,
            },
          }),
        );

        return {
          dryRun: false,
          connectionId: conn.id,
          createdCount: createdMappings.length,
          skippedCount,
          mappings: createdMappings,
        };
      });
    }

    // Scan external listings (best-effort if connected) + open UNMAPPED_SKU conflicts
    let fetchedListings: Array<{
      externalItemId: string;
      externalSkuId: string;
      externalSkuCode: string | null;
      externalProductName: string;
      price: number;
    }> = [];

    if (this.connectionsService && this.providerRegistry) {
      try {
        const creds =
          await this.connectionsService.getDecryptedCredentialsForWorker(
            tenantId,
            dto.connectionId,
          );
        if (creds.accessToken) {
          const adapter = this.providerRegistry.getAdapter(
            creds.connection.provider,
          );
          fetchedListings = await adapter.fetchExternalListings({
            tenantId,
            connectionId: dto.connectionId,
            externalShopId: creds.connection.externalShopId,
            accessToken: creds.accessToken,
            partnerId: creds.partnerId,
            partnerSecret: creds.webhookSecret,
          });
        }
      } catch {
        // Gracefully fall back to open conflicts & catalog candidates if provider is offline/paused
      }
    }

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: dto.connectionId, tenantId },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${dto.connectionId} not found`,
          404,
        );
      }

      const [existingMappings, openConflicts, catalogVariants] =
        await Promise.all([
          em.getRepository(SkuMappingEntity).find({
            where: { tenantId, connectionId: conn.id },
          }),
          em.getRepository(SyncConflictEntity).find({
            where: {
              tenantId,
              connectionId: conn.id,
              conflictType: 'SKU_UNMAPPED',
              status: 'OPEN',
            },
          }),
          em.getRepository(IntegrationCatalogVariantEntity).find({
            where: { tenantId, status: 'ACTIVE' },
          }),
        ]);

      const mappedPairKeys = new Set(
        existingMappings.map((m) => `${m.externalItemId}:${m.externalSkuId}`),
      );

      const exactBySku = new Map<string, IntegrationCatalogVariantEntity>();
      const normBySku = new Map<string, IntegrationCatalogVariantEntity>();
      const exactByBarcode = new Map<string, IntegrationCatalogVariantEntity>();

      for (const v of catalogVariants) {
        exactBySku.set(v.skuCode.trim().toUpperCase(), v);
        const norm = this.normalizeSkuToken(v.skuCode);
        if (norm && !normBySku.has(norm)) {
          normBySku.set(norm, v);
        }
        if (v.barcode?.trim()) {
          exactByBarcode.set(v.barcode.trim().toUpperCase(), v);
        }
      }

      const candidateMap = new Map<
        string,
        {
          externalItemId: string;
          externalSkuId: string;
          externalSkuCode: string | null;
          externalProductName: string;
          externalPrice: number | null;
          source: 'MARKETPLACE_LISTING' | 'OPEN_CONFLICT';
          conflictId?: string | null;
        }
      >();

      let alreadyMappedCount = 0;
      for (const item of fetchedListings) {
        const key = `${item.externalItemId}:${item.externalSkuId}`;
        if (mappedPairKeys.has(key)) {
          alreadyMappedCount += 1;
          continue;
        }
        candidateMap.set(key, {
          externalItemId: item.externalItemId,
          externalSkuId: item.externalSkuId,
          externalSkuCode: item.externalSkuCode,
          externalProductName: item.externalProductName,
          externalPrice: roundVnd(item.price),
          source: 'MARKETPLACE_LISTING',
          conflictId: null,
        });
      }

      for (const conflict of openConflicts) {
        const extItem = conflict.externalItemId ?? 'UNKNOWN_ITEM';
        const extSku = conflict.externalSkuId ?? 'UNKNOWN_SKU';
        const key = `${extItem}:${extSku}`;
        if (mappedPairKeys.has(key) || candidateMap.has(key)) continue;
        const d = conflict.details ?? {};
        const sellerSku =
          typeof d.externalSkuCode === 'string'
            ? d.externalSkuCode
            : typeof d.sellerSku === 'string'
              ? d.sellerSku
              : extSku;
        const prodName =
          typeof d.externalProductName === 'string'
            ? d.externalProductName
            : typeof d.productName === 'string'
              ? d.productName
              : `SKU xung đột đơn ${conflict.externalOrderId ?? conflict.code}`;
        const extPrice =
          typeof d.unitPrice === 'number' ? roundVnd(d.unitPrice) : null;
        candidateMap.set(key, {
          externalItemId: extItem,
          externalSkuId: extSku,
          externalSkuCode: sellerSku,
          externalProductName: prodName,
          externalPrice: extPrice,
          source: 'OPEN_CONFLICT',
          conflictId: conflict.id,
        });
      }

      const suggestions: AutoMatchCandidateView[] = [];
      for (const cand of candidateMap.values()) {
        const rawCode = (cand.externalSkuCode ?? cand.externalSkuId).trim();
        const upperCode = rawCode.toUpperCase();
        const normCode = this.normalizeSkuToken(rawCode);

        let matchedVariant: IntegrationCatalogVariantEntity | undefined;
        let confidence: AutoMatchCandidateView['confidence'] = 'UNMATCHED';

        if (upperCode && exactBySku.has(upperCode)) {
          matchedVariant = exactBySku.get(upperCode);
          confidence = 'EXACT_SKU';
        } else if (upperCode && exactByBarcode.has(upperCode)) {
          matchedVariant = exactByBarcode.get(upperCode);
          confidence = 'BARCODE';
        } else if (normCode && normBySku.has(normCode)) {
          matchedVariant = normBySku.get(normCode);
          confidence = 'NORMALIZED_SKU';
        }

        suggestions.push({
          externalItemId: cand.externalItemId,
          externalSkuId: cand.externalSkuId,
          externalSkuCode: cand.externalSkuCode,
          externalProductName: cand.externalProductName,
          externalPrice: cand.externalPrice,
          source: cand.source,
          conflictId: cand.conflictId ?? null,
          matched: Boolean(matchedVariant),
          confidence,
          internalVariantId: matchedVariant?.variantId ?? null,
          internalProductId: matchedVariant?.productId ?? null,
          internalSkuCode: matchedVariant?.skuCode ?? null,
          internalVariantName: matchedVariant?.name ?? null,
          internalBasePrice: matchedVariant?.basePrice ?? null,
          priceDelta:
            matchedVariant && cand.externalPrice !== null
              ? cand.externalPrice - matchedVariant.basePrice
              : null,
        });
      }

      suggestions.sort((a, b) => Number(b.matched) - Number(a.matched));
      const matchedPairs = suggestions.filter(
        (s) => s.matched && s.internalVariantId,
      );

      if (!dryRun) {
        return this.autoMatchMappings(actorId, {
          connectionId: conn.id,
          dryRun: false,
          selectedPairs: matchedPairs.map((m) => ({
            externalItemId: m.externalItemId,
            externalSkuId: m.externalSkuId,
            externalSkuCode: m.externalSkuCode ?? undefined,
            externalProductName: m.externalProductName,
            externalPrice: m.externalPrice ?? undefined,
            internalVariantId: m.internalVariantId!,
          })),
        });
      }

      return {
        dryRun: true,
        connectionId: conn.id,
        totalScanned: suggestions.length + alreadyMappedCount,
        alreadyMappedCount,
        matchedCount: matchedPairs.length,
        unmatchedCount: suggestions.length - matchedPairs.length,
        suggestions,
      };
    });
  }
}
