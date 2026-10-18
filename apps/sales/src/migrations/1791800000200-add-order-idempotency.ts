import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/** One Idempotency-Key per sale attempt: a retried request returns the first order */
export class AddOrderIdempotency1791800000200 implements MigrationInterface {
  name = 'AddOrderIdempotency1791800000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const orders = qualifiedTable(queryRunner, 'orders');
    await queryRunner.query(
      `ALTER TABLE ${orders} ADD "idempotency_key" uuid, ADD "request_hash" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_orders_tenant_idempotency_key" ON ${orders} ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const orders = qualifiedTable(queryRunner, 'orders');
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_orders_tenant_idempotency_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${orders} DROP COLUMN "request_hash", DROP COLUMN "idempotency_key"`,
    );
  }
}
