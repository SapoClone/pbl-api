import { MigrationInterface, QueryRunner } from 'typeorm';

/** What each scheduled shift is for and who is in charge of what in it: a name, a duty and a note. */
export class AddDutyToStaffSchedule1793000000000 implements MigrationInterface {
  name = 'AddDutyToStaffSchedule1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_schedule"
        ADD COLUMN "name" character varying(50),
        ADD COLUMN "duty" character varying(20) NOT NULL DEFAULT 'sales',
        ADD COLUMN "note" character varying(200),
        ADD CONSTRAINT "CHK_staff_schedule_duty"
          CHECK ("duty" IN ('shift_lead', 'cashier', 'sales', 'warehouse', 'delivery', 'other'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_schedule"
        DROP CONSTRAINT "CHK_staff_schedule_duty",
        DROP COLUMN "note",
        DROP COLUMN "duty",
        DROP COLUMN "name"
    `);
  }
}
