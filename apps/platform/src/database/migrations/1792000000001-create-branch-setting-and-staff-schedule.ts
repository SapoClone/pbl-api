import { MigrationInterface, QueryRunner } from 'typeorm';

/** branch_setting (1-1 with branch, created lazily) and staff_schedule. */
export class CreateBranchSettingAndStaffSchedule1792000000001
  implements MigrationInterface
{
  name = 'CreateBranchSettingAndStaffSchedule1792000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "branch_setting" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "invoice_prefix" character varying(20) NOT NULL DEFAULT 'HD',
        "invoice_template_code" character varying(30),
        "default_tax_rate" numeric(5,2) NOT NULL DEFAULT 0,
        "allowed_payment_methods" text[] NOT NULL DEFAULT '{cash,transfer,card}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_branch_setting_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_branch_setting_branch_id" UNIQUE ("branch_id"),
        CONSTRAINT "FK_branch_setting_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id"),
        CONSTRAINT "FK_branch_setting_branch" FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_branch_setting_tenant_id" ON "branch_setting" ("tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "staff_schedule" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "weekday" smallint NOT NULL,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_staff_schedule_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_staff_schedule_weekday" CHECK ("weekday" BETWEEN 1 AND 7),
        CONSTRAINT "CHK_staff_schedule_time" CHECK ("start_time" < "end_time"),
        CONSTRAINT "FK_staff_schedule_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id"),
        CONSTRAINT "FK_staff_schedule_account" FOREIGN KEY ("account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_staff_schedule_branch" FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_schedule_tenant_account" ON "staff_schedule" ("tenant_id", "account_id", "weekday")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_schedule_branch_id" ON "staff_schedule" ("branch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_schedule"`);
    await queryRunner.query(`DROP TABLE "branch_setting"`);
  }
}
