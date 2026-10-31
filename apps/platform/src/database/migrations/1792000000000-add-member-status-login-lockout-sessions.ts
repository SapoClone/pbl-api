import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First-wave platform screens:
 * - account_tenant gets `status` (active|locked) and a per-store readable
 *   `code` (NV001, ...), backfilled by join order;
 * - account gets the login-lockout columns and `last_login_at`;
 * - refresh_token gets the client's user agent and ip, shown in the session list.
 */
export class AddMemberStatusLoginLockoutSessions1792000000000
  implements MigrationInterface
{
  name = 'AddMemberStatusLoginLockoutSessions1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "account_tenant"
        ADD "status" character varying(20) NOT NULL DEFAULT 'active',
        ADD "code" character varying(20)
    `);
    await queryRunner.query(`
      UPDATE "account_tenant" at
      SET "code" = 'NV' || lpad(numbered.n::text, 3, '0')
      FROM (
        SELECT "account_id", "tenant_id",
               row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "account_id") AS n
        FROM "account_tenant"
      ) numbered
      WHERE at."account_id" = numbered."account_id" AND at."tenant_id" = numbered."tenant_id"
    `);
    await queryRunner.query(
      `ALTER TABLE "account_tenant" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_account_tenant_tenant_code" ON "account_tenant" ("tenant_id", "code")`,
    );

    await queryRunner.query(`
      ALTER TABLE "account"
        ADD "last_login_at" TIMESTAMP WITH TIME ZONE,
        ADD "failed_login_count" integer NOT NULL DEFAULT 0,
        ADD "locked_until" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_token"
        ADD "user_agent" character varying(255),
        ADD "ip" character varying(45)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_token" DROP COLUMN "user_agent", DROP COLUMN "ip"`,
    );
    await queryRunner.query(`
      ALTER TABLE "account"
        DROP COLUMN "last_login_at",
        DROP COLUMN "failed_login_count",
        DROP COLUMN "locked_until"
    `);
    await queryRunner.query(`DROP INDEX "UQ_account_tenant_tenant_code"`);
    await queryRunner.query(
      `ALTER TABLE "account_tenant" DROP COLUMN "status", DROP COLUMN "code"`,
    );
  }
}
