import { DataSource, EntityManager } from 'typeorm';

/**
 * The transaction-local setting that opens the admin read path (ADR-0022). Policies named
 * `admin_read_select_policy` let a session that sets it to `on` SELECT rows of every store, and nothing else:
 * they are `FOR SELECT`, so a write still needs the store's own `app.tenant_id`.
 *
 * Only `AdminIntegrationService` calls `runAsAdminRead`, and only from handlers behind `@RequirePlatformAdmin`.
 * The setting is bound with `set_config(..., true)`, so it ends with the transaction and never leaks to another
 * request on the pooled connection.
 */
export const ADMIN_READ_SETTING = 'app.admin_read';

/** Tables the admin read policy is added to (migration `AddAdminReadAndProjections`) */
export const ADMIN_READ_TABLES = [
  'channel_connections',
  'connection_credentials',
  'sync_jobs',
  'webhook_inbox_events',
  'sku_mappings',
  'integration_catalog_variants',
] as const;

export const ADMIN_READ_POLICY = 'admin_read_select_policy';

/** The SQL of the policy, shared by the migration and the tests */
export const adminReadPolicySql = (qualifiedTableName: string): string =>
  `CREATE POLICY "${ADMIN_READ_POLICY}" ON ${qualifiedTableName}
     FOR SELECT
     USING (current_setting('${ADMIN_READ_SETTING}', true) = 'on')`;

/** Runs `work` in a transaction that may read every store's rows (read only, by policy) */
export async function runAsAdminRead<T>(
  dataSource: DataSource,
  work: (em: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (em) => {
    await em.query(`SELECT set_config('${ADMIN_READ_SETTING}', 'on', true)`);
    return work(em);
  });
}
