import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { qualifiedTable } from '@pbl/events';
import { DataSource, EntityManager } from 'typeorm';

/** The answer a suspended store gets from every entry point that accepts work from outside a user session (D35) */
export const TENANT_SUSPENDED = 'TENANT_SUSPENDED';

/** True when the projection says the store is suspended; no row means active (fail open) */
export async function isTenantSuspended(
  source: DataSource | EntityManager,
  tenantId: string,
): Promise<boolean> {
  const connection = source instanceof DataSource ? source : source.connection;
  const rows: { status: string }[] = await source.query(
    `SELECT "status" FROM ${qualifiedTable(connection, 'tenant_status')} WHERE "tenant_id" = $1`,
    [tenantId],
  );
  return rows[0]?.status === 'suspended';
}

/**
 * Asks the `tenant_status` projection whether a store is suspended. No row means active (fail open): the projection is
 * fed by events, and a store must not be locked out because an event has not arrived. Event consumers do not call this:
 * they keep draining, so nothing is lost while a store is suspended.
 */
@Injectable()
export class TenantStatusService {
  private readonly logger = new Logger(TenantStatusService.name);

  constructor(private readonly dataSource: DataSource) {}

  async isSuspended(tenantId: string): Promise<boolean> {
    return isTenantSuspended(this.dataSource, tenantId);
  }

  /** 403 `TENANT_SUSPENDED` for a suspended store; `source` names the entry point for the log */
  async assertActive(tenantId: string, source: string): Promise<void> {
    if (!(await this.isSuspended(tenantId))) return;
    this.logger.warn(`Refused ${source} for suspended tenant ${tenantId}`);
    throw new ForbiddenException({
      statusCode: 403,
      errorCode: TENANT_SUSPENDED,
      message: 'This store is suspended',
    });
  }
}
