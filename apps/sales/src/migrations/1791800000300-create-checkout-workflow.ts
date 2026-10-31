import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCheckoutWorkflow1791800000300 implements MigrationInterface {
  name = 'CreateCheckoutWorkflow1791800000300';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'checkout_workflow');
    await queryRunner.query(`
      CREATE TABLE ${table} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_sha256" character(64) NOT NULL,
        "branch_id" uuid NOT NULL,
        "warehouse_id" uuid NOT NULL,
        "payment_method" character varying(32) NOT NULL,
        "customer_name" character varying(120),
        "lines_json" jsonb NOT NULL,
        "total_amount" bigint NOT NULL,
        "state" character varying(32) NOT NULL,
        "reservation_idempotency_key" character varying(128) NOT NULL,
        "reservation_id" uuid,
        "order_id" uuid,
        "last_error" text,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checkout_workflow_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_checkout_workflow_tenant_idempotency" UNIQUE (
          "tenant_id",
          "idempotency_key"
        ),
        CONSTRAINT "CHK_checkout_workflow_state" CHECK (
          "state" IN (
            'PENDING_STOCK',
            'RESERVING',
            'STOCK_RESERVED',
            'CONFIRMED',
            'RECOVERY_PENDING',
            'REJECTED',
            'CANCELLED'
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_checkout_workflow_tenant_state"
      ON ${table} ("tenant_id", "state", "updated_at" DESC)
    `);

    await enableTenantRlsPolicy(queryRunner, table);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'checkout_workflow')}`,
    );
  }
}
