import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the platform admin needs to manage stores (platform admin design, contract 04): a human-readable store code,
 * the reason a store was locked, the plans, subscriptions with their history and hand-recorded payments, and the usage
 * counters the plan limits are checked against.
 *
 * Codes (TN0001, SUB-0001, PAY-00001) are issued by the application, not by sequences, so the entity-synchronised local
 * stack gets them too. Existing stores get a code (TN0001... by creation date), an `active` `free` subscription that does not expire and a
 * usage row. The three seeded plans are the design's examples; an admin edits them (open question 1 of the design).
 */
export class CreatePlanSubscriptionAndTenantAdminFields1792700000000
  implements MigrationInterface
{
  name = 'CreatePlanSubscriptionAndTenantAdminFields1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- tenant: code and lock reason
    await queryRunner.query(`
      ALTER TABLE "tenant"
        ADD COLUMN "code" character varying(10),
        ADD COLUMN "suspended_reason" character varying(500),
        ADD COLUMN "suspended_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      UPDATE "tenant" t SET "code" = 'TN' || lpad(n.rn::text, 4, '0')
      FROM (
        SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "tenant"
      ) n
      WHERE n."id" = t."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant" ALTER COLUMN "code" SET NOT NULL
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tenant_code" ON "tenant" ("code")`,
    );

    // ---- account: an owner created by an admin has no password until they set one
    await queryRunner.query(
      `ALTER TABLE "account" ALTER COLUMN "password" DROP NOT NULL`,
    );

    // ---- plan
    await queryRunner.query(`
      CREATE TABLE "plan" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(30) NOT NULL,
        "name" character varying(100) NOT NULL,
        "description" character varying(255),
        "price_monthly" bigint NOT NULL DEFAULT 0,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "is_featured" boolean NOT NULL DEFAULT false,
        "quota_branches" integer NOT NULL,
        "quota_users" integer NOT NULL,
        "quota_products" integer NOT NULL,
        "quota_storage_mb" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_plan_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_plan_code" UNIQUE ("code"),
        CONSTRAINT "CHK_plan_status" CHECK ("status" IN ('active', 'hidden')),
        CONSTRAINT "CHK_plan_price" CHECK ("price_monthly" >= 0),
        CONSTRAINT "CHK_plan_quotas" CHECK (
          "quota_branches" >= 0 AND "quota_users" >= 0 AND "quota_products" >= 0 AND "quota_storage_mb" >= 0
        )
      )
    `);
    await queryRunner.query(`
      INSERT INTO "plan"
        ("code", "name", "description", "price_monthly", "status", "is_featured",
         "quota_branches", "quota_users", "quota_products", "quota_storage_mb", "created_by", "updated_by")
      VALUES
        ('free', 'Free', 'Cho cửa hàng mới bắt đầu', 0, 'active', false, 1, 3, 100, 1024, 'system', 'system'),
        ('basic', 'Basic', 'Cho cửa hàng nhỏ', 299000, 'active', false, 2, 10, 2000, 10240, 'system', 'system'),
        ('pro', 'Pro', 'Dành cho chuỗi cửa hàng', 599000, 'active', true, 5, 30, 10000, 51200, 'system', 'system')
    `);

    // ---- subscription: a store has at most one current row; closed ones stay as history
    await queryRunner.query(`
      CREATE TABLE "subscription" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(12) NOT NULL,
        "tenant_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "billing_cycle" character varying(20) NOT NULL DEFAULT 'monthly',
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL,
        CONSTRAINT "PK_subscription_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_code" UNIQUE ("code"),
        CONSTRAINT "FK_subscription_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id"),
        CONSTRAINT "FK_subscription_plan" FOREIGN KEY ("plan_id") REFERENCES "plan" ("id"),
        CONSTRAINT "CHK_subscription_status" CHECK (
          "status" IN ('trialing', 'active', 'past_due', 'expired', 'cancelled')
        ),
        CONSTRAINT "CHK_subscription_cycle" CHECK ("billing_cycle" IN ('monthly', 'yearly'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_plan" ON "subscription" ("plan_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_subscription_current_tenant" ON "subscription" ("tenant_id")
      WHERE "status" IN ('trialing', 'active', 'past_due')
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_tenant" ON "subscription" ("tenant_id", "started_at" DESC)`,
    );
    await queryRunner.query(`
      INSERT INTO "subscription" ("code", "tenant_id", "plan_id", "status", "started_at", "created_by", "updated_by")
      SELECT 'SUB-' || lpad(row_number() OVER (ORDER BY t."created_at", t."id")::text, 4, '0'), t."id",
        (SELECT "id" FROM "plan" WHERE "code" = 'free'), 'active', t."created_at", 'system', 'system'
      FROM "tenant" t
    `);

    // ---- subscription_event: the history on the detail screen
    await queryRunner.query(`
      CREATE TABLE "subscription_event" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "subscription_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "event_type" character varying(20) NOT NULL,
        "plan_code" character varying(30) NOT NULL,
        "effective_until" date,
        "actor_type" character varying(20) NOT NULL,
        "actor_id" character varying,
        "note" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_event_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_event_subscription" FOREIGN KEY ("subscription_id")
          REFERENCES "subscription" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_subscription_event_type" CHECK (
          "event_type" IN ('created', 'renewed', 'upgraded', 'downgraded', 'expired', 'cancelled')
        ),
        CONSTRAINT "CHK_subscription_event_actor" CHECK (
          "actor_type" IN ('system', 'account', 'platform_admin')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_event_subscription" ON "subscription_event" ("subscription_id", "created_at" DESC)`,
    );
    await queryRunner.query(`
      INSERT INTO "subscription_event"
        ("subscription_id", "tenant_id", "event_type", "plan_code", "actor_type", "created_at")
      SELECT s."id", s."tenant_id", 'created', 'free', 'system', s."started_at" FROM "subscription" s
    `);

    // ---- subscription_payment: recorded by hand (contract 04, D6)
    await queryRunner.query(`
      CREATE TABLE "subscription_payment" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(12) NOT NULL,
        "subscription_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "method" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'paid',
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        "note" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" character varying NOT NULL,
        CONSTRAINT "PK_subscription_payment_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_payment_code" UNIQUE ("code"),
        CONSTRAINT "FK_subscription_payment_subscription" FOREIGN KEY ("subscription_id")
          REFERENCES "subscription" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_subscription_payment_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_subscription_payment_method" CHECK ("method" IN ('transfer', 'cash', 'other')),
        CONSTRAINT "CHK_subscription_payment_status" CHECK ("status" IN ('paid', 'pending', 'failed')),
        CONSTRAINT "CHK_subscription_payment_period" CHECK ("period_end" > "period_start")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_payment_subscription" ON "subscription_payment" ("subscription_id", "period_end" DESC)`,
    );

    // ---- tenant_usage: what the plan limits are compared with. Platform counts branches and members; catalog
    // reports products and storage by event (usage step of the design).
    await queryRunner.query(`
      CREATE TABLE "tenant_usage" (
        "tenant_id" uuid NOT NULL,
        "branches_used" integer NOT NULL DEFAULT 0,
        "users_used" integer NOT NULL DEFAULT 0,
        "products_used" integer NOT NULL DEFAULT 0,
        "storage_mb_used" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_usage_tenant_id" PRIMARY KEY ("tenant_id"),
        CONSTRAINT "FK_tenant_usage_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO "tenant_usage" ("tenant_id", "branches_used", "users_used")
      SELECT t."id",
        (SELECT count(*) FROM "branch" b WHERE b."tenant_id" = t."id" AND b."deleted_at" IS NULL),
        (SELECT count(*) FROM "account_tenant" m WHERE m."tenant_id" = t."id")
      FROM "tenant" t
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "account" SET "password" = '!' WHERE "password" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "account" ALTER COLUMN "password" SET NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "tenant_usage"`);
    await queryRunner.query(`DROP TABLE "subscription_payment"`);
    await queryRunner.query(`DROP TABLE "subscription_event"`);
    await queryRunner.query(`DROP TABLE "subscription"`);
    await queryRunner.query(`DROP TABLE "plan"`);
    await queryRunner.query(`DROP INDEX "UQ_tenant_code"`);
    await queryRunner.query(`
      ALTER TABLE "tenant"
        DROP COLUMN "suspended_at", DROP COLUMN "suspended_reason", DROP COLUMN "code"
    `);
  }
}
