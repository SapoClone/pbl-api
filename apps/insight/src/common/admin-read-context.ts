import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '@pbl/auth';
import { DataSource, EntityManager } from 'typeorm';

/** The transaction-local Postgres setting the admin read policies look at */
export const ADMIN_READ_SETTING = 'app.admin_read';

/**
 * The cross-tenant read path of the platform admin for insight tables (ADR-0022: never widen
 * `TenantScopedRepository`, never a superuser connection).
 *
 * How it works: tables under FORCED row-level security get one extra, SELECT-only policy that opens on
 * `current_setting('app.admin_read') = 'on'` (`enableAdminReadPolicy`, below). This class is the only code that sets
 * that setting, transaction-locally, in a READ ONLY transaction, and only for a caller whose verified token is a
 * platform admin's (routes carry `@RequirePlatformAdmin()`, which already refused every other token; this re-checks).
 * A store request, an event handler and a request with no admin context never set it, so they still see their own
 * tenant only (proved as the restricted role in `apps/insight/test/audit-log-platform-scope.int-spec.ts`).
 *
 * Usage, in an admin service of insight:
 *
 *   constructor(private readonly adminRead: AdminReadContext) {}
 *   list(admin: AuthUser, query) {
 *     return this.adminRead.run(admin, (em) => em.query(`SELECT ... FROM ${qualifiedTable(ds, 't')} ...`));
 *   }
 *
 * `admin` is the route's `@CurrentUser()`. Writes are impossible inside (READ ONLY).
 */
@Injectable()
export class AdminReadContext {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    admin: Pick<AuthUser, 'subjectType'>,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (admin?.subjectType !== 'platform_admin') throw new ForbiddenException();
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await manager.query(`SELECT set_config($1, 'on', true)`, [
        ADMIN_READ_SETTING,
      ]);
      return work(manager);
    });
  }
}

/**
 * Migration helper: adds the SELECT-only admin read policy to a table that is under FORCED row-level security. The
 * table's own tenant policy stays; policies are OR-ed, so a store still sees only its rows.
 */
export async function enableAdminReadPolicy(
  queryable: { query: DataSource['query'] },
  qualifiedTableName: string,
  policyName = 'admin_read_policy',
): Promise<void> {
  await queryable.query(
    `DROP POLICY IF EXISTS "${policyName}" ON ${qualifiedTableName}`,
  );
  await queryable.query(`
    CREATE POLICY "${policyName}" ON ${qualifiedTableName} FOR SELECT
    USING (current_setting('${ADMIN_READ_SETTING}', true) = 'on')`);
}
