import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarehouseStockBalances1791900000100
  implements MigrationInterface
{
  name = 'AddWarehouseStockBalances1791900000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const warehouse = qualifiedTable(queryRunner, 'warehouse');
    const balance = qualifiedTable(queryRunner, 'stock_balance');
    const reservation = qualifiedTable(queryRunner, 'warehouse_reservation');
    const reservationLine = qualifiedTable(
      queryRunner,
      'warehouse_reservation_line',
    );
    const ledger = qualifiedTable(queryRunner, 'stock_balance_ledger');

    await queryRunner.query(`
      CREATE TABLE ${warehouse} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_warehouse_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_warehouse_tenant_code" UNIQUE ("tenant_id", "code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${balance} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "on_hand_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "reserved_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "in_transit_qty" numeric(18,3) NOT NULL DEFAULT 0,
        "version" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_balance_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_balance_tenant_wh_sku" UNIQUE ("tenant_id", "warehouse_id", "sku_id"),
        CONSTRAINT "CHK_stock_balance_non_negative" CHECK (
          "on_hand_qty" >= 0 AND "reserved_qty" >= 0 AND "in_transit_qty" >= 0
        ),
        CONSTRAINT "CHK_stock_balance_reserved_lte_on_hand" CHECK (
          "reserved_qty" <= "on_hand_qty"
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${reservation} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "caller_service" character varying(32) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_sha256" character(64) NOT NULL,
        "source_ref_type" character varying(32) NOT NULL,
        "source_ref_id" uuid NOT NULL,
        "state" character varying(16) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_warehouse_reservation_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_warehouse_reservation_idempotency" UNIQUE (
          "tenant_id",
          "caller_service",
          "idempotency_key"
        ),
        CONSTRAINT "CHK_warehouse_reservation_state" CHECK (
          "state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_warehouse_reservation_tenant_state_expires"
      ON ${reservation} ("tenant_id", "state", "expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE ${reservationLine} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "reservation_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "qty" numeric(18,3) NOT NULL,
        CONSTRAINT "PK_warehouse_reservation_line_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_warehouse_reservation_line_no" UNIQUE (
          "tenant_id",
          "reservation_id",
          "line_no"
        ),
        CONSTRAINT "CHK_warehouse_reservation_line_qty" CHECK ("qty" > 0),
        CONSTRAINT "FK_warehouse_reservation_line_reservation"
          FOREIGN KEY ("reservation_id") REFERENCES ${reservation}("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${ledger} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "movement_type" character varying(32) NOT NULL,
        "qty_delta" numeric(18,3) NOT NULL,
        "on_hand_after" numeric(18,3) NOT NULL,
        "reserved_after" numeric(18,3) NOT NULL,
        "reference_type" character varying(32) NOT NULL,
        "reference_id" uuid NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stock_balance_ledger_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_balance_ledger_nonzero" CHECK ("qty_delta" <> 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_stock_balance_ledger_lookup"
      ON ${ledger} ("tenant_id", "warehouse_id", "sku_id", "occurred_at" DESC)
    `);

    await enableTenantRlsPolicy(queryRunner, warehouse);
    await enableTenantRlsPolicy(queryRunner, balance);
    await enableTenantRlsPolicy(queryRunner, reservation);
    await enableTenantRlsPolicy(queryRunner, reservationLine);
    await enableTenantRlsPolicy(queryRunner, ledger);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'stock_balance_ledger')}`,
    );
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'warehouse_reservation_line')}`,
    );
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'warehouse_reservation')}`,
    );
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'stock_balance')}`,
    );
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'warehouse')}`,
    );
  }
}
