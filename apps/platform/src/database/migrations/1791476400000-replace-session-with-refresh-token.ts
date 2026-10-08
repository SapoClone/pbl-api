import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR-0004 step 4: opaque, rotating refresh tokens (refresh_token) replace
 * the session table. Existing sessions are dropped, so every user has to log
 * in again once after this migration.
 */
export class ReplaceSessionWithRefreshToken1791476400000
  implements MigrationInterface
{
  name = 'ReplaceSessionWithRefreshToken1791476400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_token" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "family_id" uuid NOT NULL,
        "subject_type" character varying(32) NOT NULL,
        "subject_id" uuid NOT NULL,
        "tenant_id" uuid,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_refresh_token_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_refresh_token_token_hash" ON "refresh_token" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_token_family_id" ON "refresh_token" ("family_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "session" DROP CONSTRAINT "FK_session_user"
    `);
    await queryRunner.query(`
      DROP TABLE "session"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "hash" character varying(255) NOT NULL,
        "user_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_session_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "session"
      ADD CONSTRAINT "FK_session_user" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      DROP INDEX "IDX_refresh_token_family_id"
    `);
    await queryRunner.query(`
      DROP INDEX "UQ_refresh_token_token_hash"
    `);
    await queryRunner.query(`
      DROP TABLE "refresh_token"
    `);
  }
}
