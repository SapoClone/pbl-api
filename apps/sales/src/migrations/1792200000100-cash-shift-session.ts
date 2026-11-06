import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cash session (docs/specs/2026-11-06-cash-shift-design.md):
 *  - `pos_shifts` gains the close flow columns and two more states;
 *  - `pos_shift_cash_entry`: one signed, append-only row per cash movement;
 *  - `cash_setting`: the per-store numbers (tolerance, approval threshold, ...).
 * The shift keeps `cash_sales_total`, `cash_refunds_total` and `expected_cash` as totals derived from
 * the entries. A shift that is open at upgrade time gets synthetic entries for its existing totals so
 * its expected cash does not change.
 */
export class CashShiftSession1792200000100 implements MigrationInterface {
  name = 'CashShiftSession1792200000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const shifts = t('pos_shifts');
    const entries = t('pos_shift_cash_entry');
    const settings = t('cash_setting');
    const guard = t('pos_shift_cash_entry_append_only');

    // One open (or closing) shift per register, whoever opened it and by whichever route.
    const dupes = await queryRunner.query(`
      SELECT tenant_id, branch_id, register_code, COUNT(*)::int AS n
      FROM ${shifts} WHERE status = 'OPEN'
      GROUP BY tenant_id, branch_id, register_code HAVING COUNT(*) > 1
    `);
    if (dupes.length > 0) {
      throw new Error(
        `Cannot enforce one open shift per register: ${dupes.length} register(s) have several OPEN shifts ` +
          `(first: tenant ${dupes[0].tenant_id}, register ${dupes[0].register_code}). Close the extra shifts first.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE ${shifts}
        ADD COLUMN IF NOT EXISTS "counted_by_denomination" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "counted_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "counted_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "variance_reason" character varying(32) NULL,
        ADD COLUMN IF NOT EXISTS "variance_note" text NULL,
        ADD COLUMN IF NOT EXISTS "close_requested_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "close_requested_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "approved_by" uuid NULL,
        ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "responsibility" character varying(24) NULL,
        ADD COLUMN IF NOT EXISTS "planned_end_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "close_history" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(
      `ALTER TABLE ${shifts} DROP CONSTRAINT IF EXISTS "CHK_pos_shifts_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE ${shifts} ADD CONSTRAINT "CHK_pos_shifts_status"
      CHECK ("status" IN ('OPEN', 'PENDING_CLOSE', 'PENDING_APPROVAL', 'CLOSED'))
    `);
    await queryRunner.query(`
      ALTER TABLE ${shifts} ADD CONSTRAINT "CHK_pos_shifts_responsibility"
      CHECK ("responsibility" IS NULL OR "responsibility" IN ('none', 'cashier_deduction', 'store_loss'))
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${t('UQ_pos_shifts_active_staff_register')}`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pos_shifts_active_register"
      ON ${shifts} ("tenant_id", "branch_id", "register_code")
      WHERE "status" IN ('OPEN', 'PENDING_CLOSE', 'PENDING_APPROVAL')
    `);

    await queryRunner.query(`
      CREATE TABLE ${entries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "shift_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "amount" bigint NOT NULL,
        "reason" character varying(32) NULL,
        "note" text NULL,
        "order_id" uuid NULL,
        "return_id" uuid NULL,
        "tender_id" uuid NULL,
        "reverses_entry_id" uuid NULL,
        "staff_id" uuid NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "source_key" character varying(160) NOT NULL,
        CONSTRAINT "PK_pos_shift_cash_entry_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pos_shift_cash_entry_source" UNIQUE ("tenant_id", "source_key"),
        CONSTRAINT "FK_pos_shift_cash_entry_shift"
          FOREIGN KEY ("tenant_id", "shift_id") REFERENCES ${shifts}("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_pos_shift_cash_entry_kind" CHECK (
          "kind" IN ('CASH_SALE', 'CASH_REFUND', 'PAY_IN', 'PAY_OUT', 'CASH_SHORTAGE', 'CASH_OVERAGE', 'REVERSAL')
        ),
        CONSTRAINT "CHK_pos_shift_cash_entry_sign" CHECK (
          "amount" <> 0 AND (
            ("kind" IN ('CASH_SALE', 'PAY_IN', 'CASH_OVERAGE') AND "amount" > 0)
            OR ("kind" IN ('CASH_REFUND', 'PAY_OUT', 'CASH_SHORTAGE') AND "amount" < 0)
            OR "kind" = 'REVERSAL'
          )
        ),
        CONSTRAINT "CHK_pos_shift_cash_entry_reason" CHECK (
          "kind" NOT IN ('PAY_IN', 'PAY_OUT', 'CASH_REFUND', 'CASH_SHORTAGE', 'REVERSAL') OR "reason" IS NOT NULL
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pos_shift_cash_entry_shift"
      ON ${entries} ("tenant_id", "shift_id", "recorded_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_pos_shift_cash_entry_kind_day"
      ON ${entries} ("tenant_id", "kind", "recorded_at")
    `);
    // append-only: a mistake is a reversing entry, never an edit or a delete
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${guard}() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'pos_shift_cash_entry is append-only (% refused)', TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_pos_shift_cash_entry_append_only"
      BEFORE UPDATE OR DELETE ON ${entries}
      FOR EACH ROW EXECUTE FUNCTION ${guard}()
    `);
    await enableTenantRlsPolicy(queryRunner, entries);

    await queryRunner.query(`
      CREATE TABLE ${settings} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "tolerance_vnd" bigint NOT NULL DEFAULT 10000,
        "approval_above_vnd" bigint NOT NULL DEFAULT 10000,
        "responsibility" character varying(24) NOT NULL DEFAULT 'none',
        "max_open_hours" integer NOT NULL DEFAULT 16,
        "max_opening_float_vnd" bigint NOT NULL DEFAULT 5000000,
        "denominations" jsonb NOT NULL DEFAULT '[500000,200000,100000,50000,20000,10000,5000,2000,1000]'::jsonb,
        "updated_by" uuid NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_setting_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cash_setting_tenant" UNIQUE ("tenant_id"),
        CONSTRAINT "CHK_cash_setting_responsibility" CHECK ("responsibility" IN ('none', 'cashier_deduction', 'store_loss')),
        CONSTRAINT "CHK_cash_setting_numbers" CHECK (
          "tolerance_vnd" >= 0 AND "approval_above_vnd" >= "tolerance_vnd"
          AND "max_open_hours" > 0 AND "max_opening_float_vnd" >= 0
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, settings);

    // shifts open now: their existing totals become entries, so expected cash is unchanged
    await queryRunner.query(`
      INSERT INTO ${entries} (tenant_id, shift_id, branch_id, kind, amount, reason, staff_id, occurred_at, recorded_at, source_key)
      SELECT tenant_id, id, branch_id, 'CASH_SALE', cash_sales_total, NULL, staff_id, now(), now(), 'migration:sales:' || id
      FROM ${shifts} WHERE status = 'OPEN' AND cash_sales_total > 0
    `);
    await queryRunner.query(`
      INSERT INTO ${entries} (tenant_id, shift_id, branch_id, kind, amount, reason, staff_id, occurred_at, recorded_at, source_key)
      SELECT tenant_id, id, branch_id, 'CASH_REFUND', -cash_refunds_total, 'migrated_total', staff_id, now(), now(), 'migration:refunds:' || id
      FROM ${shifts} WHERE status = 'OPEN' AND cash_refunds_total > 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const shifts = t('pos_shifts');
    await queryRunner.query(`DROP TABLE IF EXISTS ${t('cash_setting')}`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${t('pos_shift_cash_entry')}`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS ${t('pos_shift_cash_entry_append_only')}()`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${t('UQ_pos_shifts_active_register')}`,
    );
    // the two extra states do not exist before this migration
    await queryRunner.query(
      `UPDATE ${shifts} SET status = 'OPEN' WHERE status IN ('PENDING_CLOSE', 'PENDING_APPROVAL')`,
    );
    await queryRunner.query(
      `ALTER TABLE ${shifts} DROP CONSTRAINT IF EXISTS "CHK_pos_shifts_responsibility"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${shifts} DROP CONSTRAINT IF EXISTS "CHK_pos_shifts_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE ${shifts} ADD CONSTRAINT "CHK_pos_shifts_status" CHECK ("status" IN ('OPEN', 'CLOSED'))
    `);
    await queryRunner.query(`
      ALTER TABLE ${shifts}
        DROP COLUMN IF EXISTS "counted_by_denomination",
        DROP COLUMN IF EXISTS "counted_by",
        DROP COLUMN IF EXISTS "counted_at",
        DROP COLUMN IF EXISTS "variance_reason",
        DROP COLUMN IF EXISTS "variance_note",
        DROP COLUMN IF EXISTS "close_requested_by",
        DROP COLUMN IF EXISTS "close_requested_at",
        DROP COLUMN IF EXISTS "approved_by",
        DROP COLUMN IF EXISTS "approved_at",
        DROP COLUMN IF EXISTS "responsibility",
        DROP COLUMN IF EXISTS "planned_end_at",
        DROP COLUMN IF EXISTS "close_history"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pos_shifts_active_staff_register"
      ON ${shifts} ("tenant_id", "branch_id", "staff_id", "register_code")
      WHERE "status" = 'OPEN'
    `);
  }
}
