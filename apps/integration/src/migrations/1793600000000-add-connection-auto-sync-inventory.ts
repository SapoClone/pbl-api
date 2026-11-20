import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConnectionAutoSyncInventory1793600000000
  implements MigrationInterface
{
  name = 'AddConnectionAutoSyncInventory1793600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const connections = qualifiedTable(queryRunner, 'channel_connections');
    await queryRunner.query(`
      ALTER TABLE ${connections}
        ADD COLUMN IF NOT EXISTS "auto_sync_inventory" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const connections = qualifiedTable(queryRunner, 'channel_connections');
    await queryRunner.query(`
      ALTER TABLE ${connections}
        DROP COLUMN IF EXISTS "auto_sync_inventory"
    `);
  }
}
