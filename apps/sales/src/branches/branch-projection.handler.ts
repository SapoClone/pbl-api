import { Injectable, Logger } from '@nestjs/common';
import { EventEnvelope, TenantScopedRepository } from '@pbl/common';
import {
  BranchEventPayload,
  PLATFORM_BRANCH_CREATED,
  PLATFORM_BRANCH_UPDATED,
} from '@pbl/contracts';
import { OnEvent } from '@pbl/events';
import { EntityManager } from 'typeorm';
import { BranchProjectionEntity } from './branch-projection.entity';

/** Keeps `branch_projection` in step with the branch events of platform */
@Injectable()
export class BranchProjectionHandler {
  private readonly logger = new Logger(BranchProjectionHandler.name);

  @OnEvent(PLATFORM_BRANCH_CREATED.type)
  onCreated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.apply(event, manager);
  }

  @OnEvent(PLATFORM_BRANCH_UPDATED.type)
  onUpdated(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    return this.apply(event, manager);
  }

  /**
   * Upserts the row. Runs in the context of the event's tenant, so the scoped
   * repository never reads or overwrites another tenant's row, and an event
   * older than the row (redelivered, reordered) is ignored.
   */
  private async apply(
    event: EventEnvelope<BranchEventPayload>,
    manager: EntityManager,
  ): Promise<void> {
    const branch = event.payload;
    const projections = TenantScopedRepository.forEntity(
      manager,
      BranchProjectionEntity,
    );
    const sourceUpdatedAt = new Date(branch.updatedAt);
    const existing = await projections.findOne({
      where: { branchId: branch.id },
    });
    if (
      existing &&
      existing.sourceUpdatedAt.getTime() > sourceUpdatedAt.getTime()
    ) {
      this.logger.debug(`Ignoring a stale event for branch ${branch.id}`);
      return;
    }
    await projections.save(
      Object.assign(existing ?? new BranchProjectionEntity(), {
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
        isWarehouse: branch.isWarehouse,
        status: branch.status,
        sourceUpdatedAt,
        syncedAt: new Date(),
      }),
    );
  }
}
