import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform admins (ADR-0022): the operators who manage every store. A separate identity from `account`: its own
 * email and password, never a store membership. `password` is null until the admin sets one (an invited admin).
 * The first `super_admin` is created by the bootstrap command, not by a migration, so no password or fixed email
 * lives in the repository.
 */
export class CreatePlatformAdmin1792600000000 implements MigrationInterface {
  name = 'CreatePlatformAdmin1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_admin" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password" character varying,
        "name" character varying(100) NOT NULL DEFAULT '',
        "role" character varying(20) NOT NULL DEFAULT 'admin',
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "failed_login_count" integer NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMP WITH TIME ZONE,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_platform_admin_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_platform_admin_role" CHECK ("role" IN ('super_admin', 'admin')),
        CONSTRAINT "CHK_platform_admin_status" CHECK ("status" IN ('active', 'disabled'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_platform_admin_email" ON "platform_admin" ("email") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_admin"`);
  }
}
