import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateM4CustomerCore1791900000200 implements MigrationInterface {
  name = 'CreateM4CustomerCore1791900000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    const codeSeq = t('customer_code_sequence');
    const groups = t('customer_groups');
    const tiers = t('membership_tiers');
    const customers = t('customers');
    const addresses = t('customer_addresses');
    const loyaltySettings = t('loyalty_settings');
    const loyaltyAccounts = t('loyalty_accounts');
    const loyaltyTx = t('loyalty_transactions');
    const loyaltyHolds = t('loyalty_holds');
    const purchaseProj = t('customer_purchase_projections');
    const mergeHistory = t('customer_merge_history');
    const dataJobs = t('customer_data_jobs');

    // 1. Atomic tenant-scoped sequence counter
    await queryRunner.query(`
      CREATE TABLE ${codeSeq} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "seq_key" character varying(64) NOT NULL,
        "last_value" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_code_sequence_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_code_sequence_tenant_key" UNIQUE ("tenant_id", "seq_key")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codeSeq);

    // 2. Customer Groups
    await queryRunner.query(`
      CREATE TABLE ${groups} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" text NULL,
        "default_discount_rate" numeric(5,2) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_groups_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_groups_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_customer_groups_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_customer_groups_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "CHK_customer_groups_discount" CHECK ("default_discount_rate" >= 0 AND "default_discount_rate" <= 100)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_customer_groups_tenant_name"
      ON ${groups} ("tenant_id", LOWER("name"))
    `);
    await enableTenantRlsPolicy(queryRunner, groups);

    // 3. Membership Tiers
    await queryRunner.query(`
      CREATE TABLE ${tiers} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "min_points" integer NOT NULL DEFAULT 0,
        "discount_rate" numeric(5,2) NOT NULL DEFAULT 0,
        "benefits_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_membership_tiers_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_membership_tiers_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_membership_tiers_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_membership_tiers_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "CHK_membership_tiers_bounds" CHECK (
          "min_points" >= 0 AND "discount_rate" >= 0 AND "discount_rate" <= 100
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_tiers_qualification"
      ON ${tiers} ("tenant_id", "status", "min_points" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, tiers);

    // 4. Customers
    await queryRunner.query(`
      CREATE TABLE ${customers} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "customer_group_id" uuid NULL,
        "membership_tier_id" uuid NULL,
        "name" character varying(160) NOT NULL,
        "phone" character varying(32) NULL,
        "phone_normalized" character varying(24) NULL,
        "email" character varying(160) NULL,
        "gender" character varying(16) NULL,
        "date_of_birth" date NULL,
        "source" character varying(32) NOT NULL DEFAULT 'POS',
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "debt_limit" numeric(18,2) NOT NULL DEFAULT 2000000.00,
        "current_debt" numeric(18,2) NOT NULL DEFAULT 0.00,
        "note" text NULL,
        "merged_into_customer_id" uuid NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_customers_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customers_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_customers_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "FK_customers_group"
          FOREIGN KEY ("tenant_id", "customer_group_id") REFERENCES ${groups}("tenant_id", "id") ON DELETE SET NULL,
        CONSTRAINT "FK_customers_tier"
          FOREIGN KEY ("tenant_id", "membership_tier_id") REFERENCES ${tiers}("tenant_id", "id") ON DELETE SET NULL,
        CONSTRAINT "CHK_customers_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ANONYMIZED')),
        CONSTRAINT "CHK_customers_debt_limit" CHECK ("debt_limit" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_customers_tenant_phone"
      ON ${customers} ("tenant_id", "phone_normalized")
      WHERE "phone_normalized" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customers_tenant_status_created"
      ON ${customers} ("tenant_id", "status", "created_at" DESC, "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customers_tenant_group_status"
      ON ${customers} ("tenant_id", "customer_group_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customers_tenant_email"
      ON ${customers} ("tenant_id", "email")
      WHERE "email" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await enableTenantRlsPolicy(queryRunner, customers);

    // 5. Customer Addresses
    await queryRunner.query(`
      CREATE TABLE ${addresses} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "recipient_name" character varying(160) NOT NULL,
        "phone" character varying(32) NULL,
        "phone_normalized" character varying(24) NULL,
        "address_line" character varying(255) NOT NULL,
        "ward" character varying(120) NULL,
        "district" character varying(120) NULL,
        "province" character varying(120) NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_addresses_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_addresses_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "FK_customer_addresses_customer"
          FOREIGN KEY ("tenant_id", "customer_id") REFERENCES ${customers}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_customer_addresses_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_customer_addresses_single_default"
      ON ${addresses} ("tenant_id", "customer_id")
      WHERE "is_default" = true AND "status" = 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_addresses_customer"
      ON ${addresses} ("tenant_id", "customer_id", "status")
    `);
    await enableTenantRlsPolicy(queryRunner, addresses);

    // 6. Loyalty Settings
    await queryRunner.query(`
      CREATE TABLE ${loyaltySettings} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "earn_amount_per_point" numeric(18,2) NOT NULL DEFAULT 10000.00,
        "redeem_value_per_point" numeric(18,2) NOT NULL DEFAULT 1000.00,
        "min_redeem_points" integer NOT NULL DEFAULT 10,
        "max_redeem_points_per_order" integer NULL DEFAULT 10000,
        "hold_ttl_seconds" integer NOT NULL DEFAULT 900,
        "points_expiration_days" integer NULL,
        "version" integer NOT NULL DEFAULT 1,
        "updated_by" character varying(64) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_loyalty_settings_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "CHK_loyalty_settings_rates" CHECK (
          "earn_amount_per_point" > 0
          AND "redeem_value_per_point" > 0
          AND "min_redeem_points" >= 1
          AND "hold_ttl_seconds" >= 1
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, loyaltySettings);

    // 7. Loyalty Accounts (Authoritative Point Wallet)
    await queryRunner.query(`
      CREATE TABLE ${loyaltyAccounts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "posted_points_balance" integer NOT NULL DEFAULT 0,
        "held_points" integer NOT NULL DEFAULT 0,
        "lifetime_earned_points" integer NOT NULL DEFAULT 0,
        "lifetime_redeemed_points" integer NOT NULL DEFAULT 0,
        "qualifying_points" integer NOT NULL DEFAULT 0,
        "tier_id" uuid NULL,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_loyalty_accounts_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_loyalty_accounts_tenant_customer" UNIQUE ("tenant_id", "customer_id"),
        CONSTRAINT "FK_loyalty_accounts_customer"
          FOREIGN KEY ("tenant_id", "customer_id") REFERENCES ${customers}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_loyalty_accounts_status" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT "CHK_loyalty_accounts_non_negative_holds" CHECK (
          "held_points" >= 0
          AND "lifetime_earned_points" >= 0
          AND "lifetime_redeemed_points" >= 0
          AND "qualifying_points" >= 0
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, loyaltyAccounts);

    // 8. Loyalty Transactions (Append-Only Immutable Ledger)
    await queryRunner.query(`
      CREATE TABLE ${loyaltyTx} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "loyalty_account_id" uuid NOT NULL,
        "transaction_type" character varying(32) NOT NULL,
        "points_delta" integer NOT NULL,
        "balance_before" integer NOT NULL,
        "balance_after" integer NOT NULL,
        "source_type" character varying(32) NOT NULL,
        "source_ref_id" character varying(128) NOT NULL,
        "idempotency_key" character varying(160) NOT NULL,
        "order_id" uuid NULL,
        "return_id" uuid NULL,
        "hold_id" uuid NULL,
        "original_transaction_id" uuid NULL,
        "eligible_spend_amount" numeric(18,2) NULL,
        "applied_rate_amount_per_point" numeric(18,2) NULL,
        "reversed_points_total" integer NOT NULL DEFAULT 0,
        "actor_id" character varying(64) NULL,
        "correlation_id" character varying(128) NULL,
        "reason" character varying(255) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_loyalty_tx_idempotency" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "UQ_loyalty_tx_source_effect" UNIQUE ("tenant_id", "transaction_type", "source_ref_id"),
        CONSTRAINT "FK_loyalty_tx_account"
          FOREIGN KEY ("tenant_id", "loyalty_account_id") REFERENCES ${loyaltyAccounts}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_loyalty_tx_type" CHECK (
          "transaction_type" IN (
            'EARN',
            'REDEEM',
            'EARN_REVERSAL',
            'REDEMPTION_REVERSAL',
            'MANUAL_ADJUSTMENT',
            'EXPIRE',
            'MERGE_IN',
            'MERGE_OUT'
          )
        ),
        CONSTRAINT "CHK_loyalty_tx_non_zero" CHECK ("points_delta" <> 0),
        CONSTRAINT "CHK_loyalty_tx_balance_math" CHECK ("balance_before" + "points_delta" = "balance_after")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_loyalty_tx_customer_created"
      ON ${loyaltyTx} ("tenant_id", "customer_id", "created_at" DESC, "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_loyalty_tx_order"
      ON ${loyaltyTx} ("tenant_id", "order_id")
      WHERE "order_id" IS NOT NULL
    `);
    await enableTenantRlsPolicy(queryRunner, loyaltyTx);

    // 9. Loyalty Holds (Two-Phase Point Redemption Reservations)
    await queryRunner.query(`
      CREATE TABLE ${loyaltyHolds} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "loyalty_account_id" uuid NOT NULL,
        "caller_service" character varying(32) NOT NULL DEFAULT 'sales',
        "operation" character varying(32) NOT NULL DEFAULT 'HOLD',
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(64) NOT NULL,
        "source_ref_type" character varying(32) NOT NULL DEFAULT 'CHECKOUT',
        "source_ref_id" character varying(128) NOT NULL,
        "points" integer NOT NULL,
        "discount_value_vnd" numeric(18,2) NOT NULL DEFAULT 0.00,
        "state" character varying(24) NOT NULL DEFAULT 'HELD',
        "expires_at" TIMESTAMPTZ NOT NULL,
        "committed_at" TIMESTAMPTZ NULL,
        "released_at" TIMESTAMPTZ NULL,
        "release_reason" character varying(128) NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_holds_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_loyalty_holds_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_loyalty_holds_idempotency" UNIQUE ("tenant_id", "caller_service", "operation", "idempotency_key"),
        CONSTRAINT "FK_loyalty_holds_account"
          FOREIGN KEY ("tenant_id", "loyalty_account_id") REFERENCES ${loyaltyAccounts}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_loyalty_holds_points_positive" CHECK ("points" > 0),
        CONSTRAINT "CHK_loyalty_holds_state" CHECK ("state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_loyalty_holds_expiry"
      ON ${loyaltyHolds} ("tenant_id", "state", "expires_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_loyalty_holds_source_ref"
      ON ${loyaltyHolds} ("tenant_id", "source_ref_type", "source_ref_id")
    `);
    await enableTenantRlsPolicy(queryRunner, loyaltyHolds);

    // 10. Customer Purchase History Projections
    await queryRunner.query(`
      CREATE TABLE ${purchaseProj} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "order_code" character varying(64) NOT NULL,
        "branch_id" uuid NULL,
        "channel_type" character varying(32) NOT NULL DEFAULT 'POS',
        "order_status" character varying(24) NOT NULL DEFAULT 'COMPLETED',
        "original_order_total" numeric(18,2) NOT NULL DEFAULT 0.00,
        "eligible_net_spend" numeric(18,2) NOT NULL DEFAULT 0.00,
        "returned_amount" numeric(18,2) NOT NULL DEFAULT 0.00,
        "earned_points" integer NOT NULL DEFAULT 0,
        "reversed_points" integer NOT NULL DEFAULT 0,
        "completed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_event_id" character varying(128) NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_purchase_projections_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_purchase_proj_order" UNIQUE ("tenant_id", "order_id"),
        CONSTRAINT "CHK_customer_purchase_proj_amounts" CHECK (
          "original_order_total" >= 0 AND "eligible_net_spend" >= 0 AND "returned_amount" >= 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_purchase_proj_customer"
      ON ${purchaseProj} ("tenant_id", "customer_id", "completed_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, purchaseProj);

    // 11. Customer Merge Audit History
    await queryRunner.query(`
      CREATE TABLE ${mergeHistory} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "source_customer_id" uuid NOT NULL,
        "target_customer_id" uuid NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "transferred_points" integer NOT NULL DEFAULT 0,
        "moved_addresses_count" integer NOT NULL DEFAULT 0,
        "moved_orders_count" integer NOT NULL DEFAULT 0,
        "actor_id" character varying(64) NOT NULL,
        "reason" character varying(255) NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_merge_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_merge_idempotency" UNIQUE ("tenant_id", "idempotency_key")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, mergeHistory);

    // 12. Customer Import/Export Bounded Jobs
    await queryRunner.query(`
      CREATE TABLE ${dataJobs} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "job_type" character varying(16) NOT NULL,
        "format" character varying(16) NOT NULL DEFAULT 'CSV',
        "status" character varying(16) NOT NULL DEFAULT 'COMPLETED',
        "total_rows" integer NOT NULL DEFAULT 0,
        "success_rows" integer NOT NULL DEFAULT 0,
        "failed_rows" integer NOT NULL DEFAULT 0,
        "errors_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "result_csv" text NULL,
        "created_by" character varying(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_customer_data_jobs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_data_jobs_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_customer_data_jobs_type" CHECK ("job_type" IN ('IMPORT', 'EXPORT')),
        CONSTRAINT "CHK_customer_data_jobs_status" CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, dataJobs);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('customer_data_jobs')}`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${t('customer_merge_history')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${t('customer_purchase_projections')}`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('loyalty_holds')}`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${t('loyalty_transactions')}`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('loyalty_accounts')}`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('loyalty_settings')}`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('customer_addresses')}`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('customers')}`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('membership_tiers')}`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('customer_groups')}`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${t('customer_code_sequence')}`,
    );
  }
}
