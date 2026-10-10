import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0 tenancy: user → account (name, phone, status), add tenant,
 * account_tenant and branch, and drop the post boilerplate. Existing
 * accounts keep working and simply have no store yet.
 */
export class IntroduceTenancy1791563000000 implements MigrationInterface {
  name = 'IntroduceTenancy1791563000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "FK_post_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "post"`);

    await queryRunner.query(`ALTER TABLE "user" RENAME TO "account"`);
    await queryRunner.query(
      `ALTER TABLE "account" RENAME CONSTRAINT "PK_user_id" TO "PK_account_id"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_user_username"`);
    await queryRunner.query(
      `ALTER INDEX "UQ_user_email" RENAME TO "UQ_account_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "account" DROP COLUMN "username", DROP COLUMN "bio", DROP COLUMN "image"`,
    );
    await queryRunner.query(`
      ALTER TABLE "account"
        ADD "name" character varying(100) NOT NULL DEFAULT '',
        ADD "phone" character varying(20),
        ADD "status" character varying(20) NOT NULL DEFAULT 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(150) NOT NULL,
        "subdomain" character varying(30) NOT NULL,
        "phone" character varying(20),
        "email" character varying(255),
        "address" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_tenant_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tenant_subdomain" ON "tenant" ("subdomain") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "account_tenant" (
        "account_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "role" character varying(32) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_tenant" PRIMARY KEY ("account_id", "tenant_id"),
        CONSTRAINT "FK_account_tenant_account" FOREIGN KEY ("account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_account_tenant_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "branch" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(150) NOT NULL,
        "code" character varying(20) NOT NULL,
        "address" character varying(255),
        "phone" character varying(20),
        "is_warehouse" boolean NOT NULL DEFAULT true,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_branch_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_branch_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_branch_tenant_id" ON "branch" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_branch_tenant_code" ON "branch" ("tenant_id", "code") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "branch"`);
    await queryRunner.query(`DROP TABLE "account_tenant"`);
    await queryRunner.query(`DROP TABLE "tenant"`);

    await queryRunner.query(
      `ALTER TABLE "account" DROP COLUMN "name", DROP COLUMN "phone", DROP COLUMN "status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "account"
        ADD "username" character varying(50),
        ADD "bio" character varying NOT NULL DEFAULT '',
        ADD "image" character varying NOT NULL DEFAULT ''
    `);
    await queryRunner.query(
      `ALTER INDEX "UQ_account_email" RENAME TO "UQ_user_email"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_username" ON "account" ("username") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "account" RENAME CONSTRAINT "PK_account_id" TO "PK_user_id"`,
    );
    await queryRunner.query(`ALTER TABLE "account" RENAME TO "user"`);

    await queryRunner.query(`
      CREATE TABLE "post" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "description" character varying,
        "content" character varying,
        "user_id" uuid NOT NULL,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_post_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "post"
      ADD CONSTRAINT "FK_post_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }
}
