import { Injectable } from '@nestjs/common';
import { EventEnvelope } from '@pbl/common';
import {
  BranchEventPayload,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_BRANCH_UPDATED,
  PLATFORM_TENANT_CREATED,
  PLATFORM_TENANT_UPDATED,
  TenantEventPayload,
} from '@pbl/contracts';
import { OnEvent, qualifiedTable } from '@pbl/events';
import { EntityManager } from 'typeorm';

/**
 * Keeps `tenant_projection` and `branch_projection` (names only) in step with platform. One upsert statement per
 * event, ignored when older than the row held, so redelivery and reordering are harmless (the inbox already drops
 * exact duplicates).
 */
@Injectable()
export class NameProjectionHandler {
  @OnEvent(PLATFORM_TENANT_CREATED.type)
  onTenantCreated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.upsertTenant(event, manager);
  }

  @OnEvent(PLATFORM_TENANT_UPDATED.type)
  onTenantUpdated(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.upsertTenant(event, manager);
  }

  @OnEvent(PLATFORM_BRANCH_CREATED.type)
  onBranchCreated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.upsertBranch(event, manager);
  }

  @OnEvent(PLATFORM_BRANCH_UPDATED.type)
  onBranchUpdated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.upsertBranch(event, manager);
  }

  private async upsertTenant(
    event: EventEnvelope<TenantEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const table = qualifiedTable(manager.connection, 'tenant_projection');
    const p = event.payload;
    await manager.query(
      `INSERT INTO ${table} ("tenant_id", "name", "source_updated_at") VALUES ($1, $2, $3)
       ON CONFLICT ("tenant_id") DO UPDATE
         SET "name" = EXCLUDED."name", "source_updated_at" = EXCLUDED."source_updated_at"
         WHERE ${table}."source_updated_at" <= EXCLUDED."source_updated_at"`,
      [p.id, p.name, new Date(p.updatedAt)],
    );
  }

  private async upsertBranch(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const table = qualifiedTable(manager.connection, 'branch_projection');
    const p = event.payload;
    await manager.query(
      `INSERT INTO ${table} ("branch_id", "tenant_id", "name", "source_updated_at") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("branch_id") DO UPDATE
         SET "name" = EXCLUDED."name", "source_updated_at" = EXCLUDED."source_updated_at"
         WHERE ${table}."source_updated_at" <= EXCLUDED."source_updated_at"`,
      [p.id, event.tenantId, p.name, new Date(p.updatedAt)],
    );
  }
}
