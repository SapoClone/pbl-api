import { MigrationInterface, QueryRunner } from 'typeorm';

/** Support sessions (ADR-0025): a platform admin's read-only look into one store. The token is never stored. */
export class CreateSupportSession1793200000000 implements MigrationInterface {
  name = 'CreateSupportSession1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "support_session" (
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_by" character varying NOT NULL,
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(14) NOT NULL,
        "tenant_id" uuid NOT NULL,
        "admin_id" uuid NOT NULL,
        "reason" character varying(500) NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ended_at" TIMESTAMP WITH TIME ZONE,
        "ended_by" character varying(10),
        "idempotency_key" character varying(100),
        CONSTRAINT "PK_support_session_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_support_session_code" UNIQUE ("code"),
        CONSTRAINT "CHK_support_session_ended_by" CHECK ("ended_by" IN ('admin', 'expiry')),
        CONSTRAINT "CHK_support_session_end_pair" CHECK (("ended_at" IS NULL) = ("ended_by" IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_support_session_open" ON "support_session" ("admin_id", "tenant_id") WHERE "ended_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_support_session_idempotency" ON "support_session" ("admin_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_support_session_tenant" ON "support_session" ("tenant_id", "started_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "support_session"`);
  }
}
