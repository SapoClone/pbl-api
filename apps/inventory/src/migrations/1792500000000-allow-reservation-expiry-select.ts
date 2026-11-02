import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the reservation expiry job find warehouse holds past their time in every store. Row-level security hides
 * `warehouse_reservation` from a session without `app.tenant_id`, so the job sets `app.reservation_expiry_scheduler`
 * to read them, then expires each hold with that hold's tenant set. SELECT only.
 */
export class AllowReservationExpirySelect1792500000000
  implements MigrationInterface
{
  name = 'AllowReservationExpirySelect1792500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY "reservation_expiry_select_policy" ON ${qualifiedTable(queryRunner, 'warehouse_reservation')}
        FOR SELECT
        USING (current_setting('app.reservation_expiry_scheduler', true) = 'on')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "reservation_expiry_select_policy" ON ${qualifiedTable(queryRunner, 'warehouse_reservation')}`,
    );
  }
}
