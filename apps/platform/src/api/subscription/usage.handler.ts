import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  CATALOG_USAGE_CHANGED,
  CatalogUsageChangedPayload,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { TenantUsageEntity } from './entities/tenant-usage.entity';
import { tableOf } from './sql';

/** Products and storage of a store come from catalog (it owns them); platform keeps them in `tenant_usage` for the admin */
@Injectable()
export class UsageHandler {
  /**
   * Catalog sends absolute numbers, so the row takes the event as is. An event measured before the row's last update
   * (redelivered, reordered) is ignored. A store without a row (older than the subscription tables) gets one.
   */
  @OnEvent(CATALOG_USAGE_CHANGED.type)
  async onCatalogUsage(
    event: EventEnvelope<CatalogUsageChangedPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const { products, storageMb, measuredAt } = event.payload;
    await manager.query(
      `INSERT INTO ${tableOf(manager, TenantUsageEntity)} AS u
         ("tenant_id", "products_used", "storage_mb_used", "updated_at")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "products_used" = EXCLUDED."products_used",
         "storage_mb_used" = EXCLUDED."storage_mb_used",
         "updated_at" = EXCLUDED."updated_at"
       WHERE u."updated_at" < EXCLUDED."updated_at"`,
      [event.tenantId, products, storageMb, new Date(measuredAt)],
    );
  }
}
