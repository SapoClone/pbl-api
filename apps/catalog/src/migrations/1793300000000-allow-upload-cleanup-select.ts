import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the upload cleanup job find unused uploads in every store. Row-level security hides `uploads` from a session
 * without `app.tenant_id`, so the job sets `app.uploads_cleanup_scheduler` to read them, then deletes each one with
 * that upload's tenant set. SELECT only.
 */
export class AllowUploadCleanupSelect1793300000000
  implements MigrationInterface
{
  name = 'AllowUploadCleanupSelect1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY "uploads_cleanup_select_policy" ON ${qualifiedTable(queryRunner, 'uploads')}
        FOR SELECT
        USING (current_setting('app.uploads_cleanup_scheduler', true) = 'on')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "uploads_cleanup_select_policy" ON ${qualifiedTable(queryRunner, 'uploads')}`,
    );
  }
}
