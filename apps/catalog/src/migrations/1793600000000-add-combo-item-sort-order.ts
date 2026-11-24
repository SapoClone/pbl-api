import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `combo_items` (created with the first catalog migration, never written until now) gets the display order of the
 * components, which `PUT /products/:id/combo-items` sets from the order of the request.
 */
export class AddComboItemSortOrder1793600000000 implements MigrationInterface {
  name = 'AddComboItemSortOrder1793600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'combo_items');
    await queryRunner.query(
      `ALTER TABLE ${table} ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'combo_items');
    await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN "sort_order"`);
  }
}
