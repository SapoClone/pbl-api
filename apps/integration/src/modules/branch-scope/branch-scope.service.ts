import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import {
  ChannelConnectionEntity,
  IntegrationReconciliationRunEntity,
  SkuMappingEntity,
  SyncConflictEntity,
  SyncJobEntity,
} from '../../infrastructure/persistence/integration.entities';

/**
 * Branch scope (ADR-0020). A channel connection is applied to one branch
 * (`channel_connections.branch_id`); mappings, jobs, conflicts and
 * reconciliation runs reach a branch through their `connection_id`.
 *
 * `branches` is the value of `@AllowedBranches()`: null means every branch.
 * An inaccessible connection (or one that belongs to an inaccessible branch)
 * answers 404, so its existence is not leaked. Webhook ingestion and the
 * background job runner are not scoped: they carry no member.
 */
@Injectable()
export class BranchScopeService {
  constructor(private readonly dataSource: DataSource) {}

  /** 404 when the branch is outside the member's scope. */
  assertBranch(branches: string[] | null, branchId: string): void {
    if (branches !== null && !branches.includes(branchId)) {
      throw new NotFoundException();
    }
  }

  /** 404 when the connection is missing or belongs to a branch outside the scope. */
  async assertConnection(
    branches: string[] | null,
    connectionId: string | null | undefined,
  ): Promise<void> {
    if (branches === null || !connectionId) return;
    const allowed = await this.allowedConnectionIds(branches);
    if (!allowed.has(connectionId)) throw new NotFoundException();
  }

  /** 404 unless the entity row exists in the tenant and its connection is in scope. */
  async assertEntity(
    branches: string[] | null,
    entity: EntityTarget<ObjectLiteral>,
    id: string,
  ): Promise<void> {
    if (branches === null) return;
    const tenantId = TenantContext.require();
    const row = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em
        .getRepository(entity)
        .findOne({ where: { id, tenantId } as never });
    });
    // A missing row falls through to the service, which answers its own 404.
    if (!row) return;
    const connectionId = (row as { connectionId?: string | null }).connectionId;
    if (!connectionId) throw new NotFoundException();
    await this.assertConnection(branches, connectionId);
  }

  assertMapping(branches: string[] | null, id: string) {
    return this.assertEntity(branches, SkuMappingEntity, id);
  }

  assertJob(branches: string[] | null, id: string) {
    return this.assertEntity(branches, SyncJobEntity, id);
  }

  assertConflict(branches: string[] | null, id: string) {
    return this.assertEntity(branches, SyncConflictEntity, id);
  }

  assertRun(branches: string[] | null, id: string) {
    return this.assertEntity(branches, IntegrationReconciliationRunEntity, id);
  }

  /** Keeps only the rows whose connection is in scope (rows without one are store-wide: hidden). */
  async filterRows<T extends { connectionId?: string | null }>(
    branches: string[] | null,
    rows: T[],
  ): Promise<T[]> {
    if (branches === null) return rows;
    const allowed = await this.allowedConnectionIds(branches);
    return rows.filter((r) => !!r.connectionId && allowed.has(r.connectionId));
  }

  /** A run over every connection of the store needs the whole store. */
  assertStoreWide(branches: string[] | null): void {
    if (branches !== null) {
      throw new ForbiddenException(
        'A connectionId is required for a member limited to some branches',
      );
    }
  }

  private async allowedConnectionIds(branches: string[]): Promise<Set<string>> {
    if (branches.length === 0) return new Set();
    const tenantId = TenantContext.require();
    const rows = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      return em
        .getRepository(ChannelConnectionEntity)
        .createQueryBuilder('c')
        .select('c.id', 'id')
        .where('c.tenantId = :tenantId', { tenantId })
        .andWhere('c.branchId IN (:...branches)', { branches })
        .getRawMany<{ id: string }>();
    });
    return new Set(rows.map((r) => r.id));
  }
}
