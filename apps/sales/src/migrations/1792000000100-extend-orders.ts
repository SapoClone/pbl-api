import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The order grows the three status axes (D5), channel, customer, shipping,
 * money breakdown, shift/register and an optimistic-lock version, plus payment
 * and status-history tables. Everything is nullable or defaulted so old rows and
 * old requests keep working. `status` stays the order status column (existing
 * rows are `completed` already).
 */
export class ExtendOrders1792000000100 implements MigrationInterface {
  name = 'ExtendOrders1792000000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const orders = qualifiedTable(queryRunner, 'orders');
    const items = qualifiedTable(queryRunner, 'order_items');
    const payments = qualifiedTable(queryRunner, 'order_payment');
    const history = qualifiedTable(queryRunner, 'order_status_history');

    await queryRunner.query(`
      ALTER TABLE ${orders}
        ADD "payment_status" character varying(20) NOT NULL DEFAULT 'unpaid',
        ADD "fulfillment_status" character varying(20) NOT NULL DEFAULT 'unfulfilled',
        ADD "exception_code" character varying(30),
        ADD "source" character varying(20) NOT NULL DEFAULT 'pos',
        ADD "channel" character varying(30) NOT NULL DEFAULT 'pos',
        ADD "customer_id" uuid,
        ADD "customer_phone" character varying(20),
        ADD "shipping_recipient" character varying(150),
        ADD "shipping_phone" character varying(20),
        ADD "shipping_address_line" character varying(250),
        ADD "shipping_ward" character varying(100),
        ADD "shipping_district" character varying(100),
        ADD "shipping_province" character varying(100),
        ADD "shipping_provider_code" character varying(30),
        ADD "tracking_code" character varying(60),
        ADD "shipping_fee_payer" character varying(10),
        ADD "subtotal" bigint NOT NULL DEFAULT 0,
        ADD "discount_amount" bigint NOT NULL DEFAULT 0,
        ADD "shipping_fee" bigint NOT NULL DEFAULT 0,
        ADD "paid_amount" bigint NOT NULL DEFAULT 0,
        ADD "change_amount" bigint NOT NULL DEFAULT 0,
        ADD "note" text,
        ADD "cancel_reason" text,
        ADD "external_order_code" character varying(60),
        ADD "version" integer NOT NULL DEFAULT 1,
        ADD "shift_id" uuid,
        ADD "register_id" uuid,
        ADD "stock_reserved" boolean NOT NULL DEFAULT false,
        ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD "completed_at" TIMESTAMP WITH TIME ZONE`);
    // rows made before this migration were sold and handed over at the counter
    await queryRunner.query(`
      UPDATE ${orders} SET
        "subtotal" = "total_amount",
        "fulfillment_status" = 'delivered',
        "paid_amount" = CASE WHEN "payment_method" = 'cod' THEN 0 ELSE "total_amount" END,
        "payment_status" = CASE WHEN "payment_method" = 'cod' THEN 'unpaid' ELSE 'paid' END,
        "stock_reserved" = true,
        "completed_at" = "created_at",
        "updated_at" = "created_at"`);
    await queryRunner.query(`
      ALTER TABLE ${orders}
        ADD CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('draft', 'new', 'confirmed', 'completed', 'cancelled')),
        ADD CONSTRAINT "CHK_orders_payment_status" CHECK ("payment_status" IN ('unpaid', 'partially_paid', 'paid', 'refunded', 'unreconciled')),
        ADD CONSTRAINT "CHK_orders_fulfillment_status" CHECK ("fulfillment_status" IN ('unfulfilled', 'packing', 'shipping', 'delivered', 'returned'))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_tenant_status" ON ${orders} ("tenant_id", "status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_tenant_customer" ON ${orders} ("tenant_id", "customer_id") WHERE "customer_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_tenant_shift" ON ${orders} ("tenant_id", "shift_id") WHERE "shift_id" IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE ${items} ADD "variant_id" uuid`);

    await queryRunner.query(`
      CREATE TABLE ${payments} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "method" character varying(20) NOT NULL,
        "amount" bigint NOT NULL,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_payment_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_payment_order" FOREIGN KEY ("order_id") REFERENCES ${orders} ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_payment_tenant_order" ON ${payments} ("tenant_id", "order_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE ${history} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "status_type" character varying(20) NOT NULL,
        "old_status" character varying(20),
        "new_status" character varying(20) NOT NULL,
        "changed_by" uuid,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_status_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_status_history_order" FOREIGN KEY ("order_id") REFERENCES ${orders} ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_status_history_tenant_order" ON ${history} ("tenant_id", "order_id", "created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const orders = qualifiedTable(queryRunner, 'orders');
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'order_status_history')}`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, 'order_payment')}`,
    );
    await queryRunner.query(
      `ALTER TABLE ${qualifiedTable(queryRunner, 'order_items')} DROP COLUMN "variant_id"`,
    );
    for (const index of [
      'IDX_orders_tenant_shift',
      'IDX_orders_tenant_customer',
      'IDX_orders_tenant_status',
    ]) {
      // an index lives in its table's schema
      const schema = (queryRunner.connection.options as { schema?: string })
        .schema;
      await queryRunner.query(
        `DROP INDEX IF EXISTS ${schema ? `"${schema}".` : ''}"${index}"`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE ${orders}
        DROP CONSTRAINT "CHK_orders_fulfillment_status",
        DROP CONSTRAINT "CHK_orders_payment_status",
        DROP CONSTRAINT "CHK_orders_status"`);
    const columns = [
      'completed_at',
      'updated_at',
      'stock_reserved',
      'register_id',
      'shift_id',
      'version',
      'external_order_code',
      'cancel_reason',
      'note',
      'change_amount',
      'paid_amount',
      'shipping_fee',
      'discount_amount',
      'subtotal',
      'shipping_fee_payer',
      'tracking_code',
      'shipping_provider_code',
      'shipping_province',
      'shipping_district',
      'shipping_ward',
      'shipping_address_line',
      'shipping_phone',
      'shipping_recipient',
      'customer_phone',
      'customer_id',
      'channel',
      'source',
      'exception_code',
      'fulfillment_status',
      'payment_status',
    ];
    await queryRunner.query(
      `ALTER TABLE ${orders} ${columns.map((c) => `DROP COLUMN "${c}"`).join(', ')}`,
    );
  }
}
