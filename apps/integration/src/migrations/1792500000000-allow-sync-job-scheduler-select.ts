import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the sync job worker find which stores have jobs due. Row-level security hides `sync_jobs` from a session
 * without `app.tenant_id`, so the worker sets `app.sync_job_scheduler` to read them; it then claims and runs each
 * store's jobs with that store's tenant set. SELECT only, like `webhook_routing_select_policy`.
 */
export class AllowSyncJobSchedulerSelect1792500000000
  implements MigrationInterface
{
  name = 'AllowSyncJobSchedulerSelect1792500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY "sync_job_scheduler_select_policy" ON ${qualifiedTable(queryRunner, 'sync_jobs')}
        FOR SELECT
        USING (current_setting('app.sync_job_scheduler', true) = 'on')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "sync_job_scheduler_select_policy" ON ${qualifiedTable(queryRunner, 'sync_jobs')}`,
    );
  }
}
