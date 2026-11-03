import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform admin store management (ADR-0022):
 * - `tenant.code`, the readable platform-wide code (TN0001, ...), backfilled by creation order and unique across all
 *   rows, deleted stores included, so a code is never reused;
 * - `suspended_reason` and `suspended_at`, set when an admin locks a store and cleared when it is reactivated.
 */
export class AddTenantCodeAndSuspension1792700000000
  implements MigrationInterface
{
  name = 'AddTenantCodeAndSuspension1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant"
        ADD "code" character varying(20),
        ADD "suspended_reason" character varying(500),
        ADD "suspended_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      UPDATE "tenant" t
      SET "code" = 'TN' || lpad(numbered.n::text, 4, '0')
      FROM (
        SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "tenant"
      ) numbered
      WHERE t."id" = numbered."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "tenant" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tenant_code" ON "tenant" ("code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tenant_code"`);
    await queryRunner.query(`
      ALTER TABLE "tenant"
        DROP COLUMN "suspended_at",
        DROP COLUMN "suspended_reason",
        DROP COLUMN "code"
    `);
  }
}
