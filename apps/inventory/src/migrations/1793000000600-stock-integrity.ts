import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stock integrity (decisions D17, D19 and the ledger guard):
 * - `stock_transfer` records who cancelled it, when and why (D17);
 * - `warehouse_reservation.expires_at` may be NULL: a hold for a confirmed,
 *   not yet shipped order does not expire (D19); `expires_at < now()` is
 *   never true for NULL, so the expiry job skips such holds on its own;
 * - the ledger is append-only: UPDATE and DELETE of a `stock_balance_ledger`
 *   row are refused by a trigger (TRUNCATE is not covered on purpose, it is
 *   how a whole schema is reset in tests).
 */
export class StockIntegrity1793000000600 implements MigrationInterface {
  name = 'StockIntegrity1793000000600';

  async up(queryRunner: QueryRunner): Promise<void> {
    const transfer = qualifiedTable(queryRunner, 'stock_transfer');
    const reservation = qualifiedTable(queryRunner, 'warehouse_reservation');
    const ledger = qualifiedTable(queryRunner, 'stock_balance_ledger');
    const guard = qualifiedTable(queryRunner, 'stock_balance_ledger_immutable');

    await queryRunner.query(`
      ALTER TABLE ${transfer}
        ADD COLUMN IF NOT EXISTS "cancelled_by" character varying(64) NULL,
        ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "cancel_reason" character varying(300) NULL
    `);

    await queryRunner.query(
      `ALTER TABLE ${reservation} ALTER COLUMN "expires_at" DROP NOT NULL`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${guard}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'stock_balance_ledger is append-only (% refused)', TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_stock_balance_ledger_immutable"
      BEFORE UPDATE OR DELETE ON ${ledger}
      FOR EACH ROW EXECUTE FUNCTION ${guard}()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const transfer = qualifiedTable(queryRunner, 'stock_transfer');
    const reservation = qualifiedTable(queryRunner, 'warehouse_reservation');
    const ledger = qualifiedTable(queryRunner, 'stock_balance_ledger');
    const guard = qualifiedTable(queryRunner, 'stock_balance_ledger_immutable');

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_stock_balance_ledger_immutable" ON ${ledger}`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${guard}()`);

    // holds without an expiry get one before the column is NOT NULL again
    await queryRunner.query(
      `UPDATE ${reservation} SET "expires_at" = now() WHERE "expires_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${reservation} ALTER COLUMN "expires_at" SET NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE ${transfer}
        DROP COLUMN IF EXISTS "cancel_reason",
        DROP COLUMN IF EXISTS "cancelled_at",
        DROP COLUMN IF EXISTS "cancelled_by"
    `);
  }
}
