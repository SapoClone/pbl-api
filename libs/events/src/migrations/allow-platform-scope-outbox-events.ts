import { MigrationInterface, QueryRunner } from 'typeorm';
import { qualifiedTable } from './table-name';

/**
 * A platform-scope event (an admin action that belongs to no store) has no tenant: `outbox_event.tenant_id` becomes
 * nullable. The outbox has no row-level security, so nothing else changes. `down` removes such rows first.
 */
export class AllowPlatformScopeOutboxEvents1793500000001
  implements MigrationInterface
{
  name = 'AllowPlatformScopeOutboxEvents1793500000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ${qualifiedTable(queryRunner, 'outbox_event')} ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'outbox_event');
    await queryRunner.query(`DELETE FROM ${table} WHERE "tenant_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE ${table} ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
  }
}
