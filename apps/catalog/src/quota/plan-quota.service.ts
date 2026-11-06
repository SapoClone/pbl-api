import { Injectable, Logger } from '@nestjs/common';
import { TenantContext, TenantScopedRepository } from '@pbl/common';
import {
  CATALOG_USAGE_CHANGED,
  CatalogUsageChangedPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { EntityManager, IsNull, Not } from 'typeorm';
import { CatalogDomainError, CatalogErrorCode } from '../domain/catalog-domain';
import {
  ProductEntity,
  ProductStatus,
  TenantPlanQuotaEntity,
  UploadEntity,
} from '../infrastructure/persistence/catalog.entities';

const MB = 1024 * 1024;

/**
 * Plan limits for what catalog owns: products and stored files (platform admin design, "Quota enforcement"). Call it
 * inside the transaction that adds the row: the advisory lock serialises two adds of the same store, so both cannot
 * slip through at limit - 1. Over the limit it answers 409 `Q001` with `details: { key, used, limit, planCode }`.
 */
@Injectable()
export class PlanQuotaService {
  private readonly logger = new Logger(PlanQuotaService.name);
  /** Tenants already warned about: one WARN per store and process, not one per request */
  private readonly warnedNoRow = new Set<string>();

  constructor(private readonly outbox: EventOutbox) {}

  async assertCanAddProducts(em: EntityManager, adding = 1): Promise<void> {
    const quota = await this.lockAndLoad(em, 'products');
    if (!quota) return;
    const used = await this.productsUsed(em);
    if (used + adding <= quota.quotaProducts) return;
    throw this.limitReached(
      'products',
      used,
      quota.quotaProducts,
      quota.planCode,
      `The ${quota.planCode} plan allows at most ${quota.quotaProducts} products`,
    );
  }

  /** `bytes` is the file about to be stored */
  async assertCanStore(em: EntityManager, bytes: number): Promise<void> {
    const quota = await this.lockAndLoad(em, 'storage');
    if (!quota) return;
    const usedBytes = await this.storageBytesUsed(em);
    if (usedBytes + bytes <= quota.quotaStorageMb * MB) return;
    throw this.limitReached(
      'storageGb',
      round2(usedBytes / (1024 * MB)),
      round2(quota.quotaStorageMb / 1024),
      quota.planCode,
      `The ${quota.planCode} plan allows at most ${round2(quota.quotaStorageMb / 1024)} GB of files`,
    );
  }

  /** Tells platform what the store uses now (absolute numbers), in the transaction that changed it */
  async announceUsage(em: EntityManager): Promise<void> {
    const payload: CatalogUsageChangedPayload = {
      products: await this.productsUsed(em),
      storageMb: Math.ceil((await this.storageBytesUsed(em)) / MB),
      measuredAt: new Date().toISOString(),
    };
    await this.outbox.add(em, CATALOG_USAGE_CHANGED, payload);
  }

  private async lockAndLoad(
    em: EntityManager,
    key: string,
  ): Promise<TenantPlanQuotaEntity | null> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `quota:${TenantContext.require()}:${key}`,
    ]);
    const quota = await TenantScopedRepository.forEntity(
      em,
      TenantPlanQuotaEntity,
    ).findOne({ where: {} });
    if (!quota) this.warnNoRow(TenantContext.require());
    return quota;
  }

  /**
   * A store with no `tenant_plan_quota` row stays unlimited (fail-open) until platform's plan event reaches us; the
   * `POST /platform/api/v1/admin/subscriptions/resync` call closes the gap for stores that predate the events.
   */
  private warnNoRow(tenantId: string): void {
    if (this.warnedNoRow.has(tenantId)) return;
    this.warnedNoRow.add(tenantId);
    this.logger.warn(
      `Tenant ${tenantId} has no plan quota row: its limits are not enforced until platform resyncs plans`,
    );
  }

  private productsUsed(em: EntityManager): Promise<number> {
    return em.count(ProductEntity, {
      where: {
        tenantId: TenantContext.require(),
        deletedAt: IsNull(),
        status: Not<ProductStatus>('ARCHIVED'),
      },
    });
  }

  private async storageBytesUsed(em: EntityManager): Promise<number> {
    const row = await em
      .createQueryBuilder(UploadEntity, 'u')
      .select('COALESCE(SUM(u.storedSize), 0)', 'bytes')
      .where('u.tenantId = :tenantId', { tenantId: TenantContext.require() })
      // every stored file counts until it is deleted: attached images and import files too (D34)
      .andWhere(`u.status IN ('UPLOADED', 'ATTACHED')`)
      .getRawOne<{ bytes: string }>();
    return Number(row?.bytes ?? 0);
  }

  private limitReached(
    key: string,
    used: number,
    limit: number,
    planCode: string,
    message: string,
  ): CatalogDomainError {
    return new CatalogDomainError(
      CatalogErrorCode.PLAN_LIMIT_REACHED,
      message,
      'CONFLICT',
      { key, used, limit, planCode },
    );
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
