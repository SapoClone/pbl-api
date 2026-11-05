import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `account.code` (US00001, backfilled by sign-up order, nullable so a direct insert still works) for the admin's users
 * screen, and `platform_setting`, one row per setting key (contract 04, "System settings").
 */
export class AddAccountCodeAndPlatformSetting1792900000000
  implements MigrationInterface
{
  name = 'AddAccountCodeAndPlatformSetting1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account" ADD COLUMN "code" character varying(10)`,
    );
    await queryRunner.query(`
      UPDATE "account" a SET "code" = 'US' || lpad(n.rn::text, 5, '0')
      FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "account") n
      WHERE n."id" = a."id"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_code" ON "account" ("code") WHERE "code" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "platform_setting" (
        "key" character varying(64) NOT NULL,
        "value" jsonb NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_platform_setting_key" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_setting"`);
    await queryRunner.query(`DROP INDEX "UQ_account_code"`);
    await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "code"`);
  }
}
