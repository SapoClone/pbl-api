import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPricelistChannelsAndComboItems1793600000000
  implements MigrationInterface
{
  name = 'AddPricelistChannelsAndComboItems1793600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const priceLists = qualifiedTable(queryRunner, 'price_lists');
    const comboItems = qualifiedTable(queryRunner, 'combo_items');
    const products = qualifiedTable(queryRunner, 'products');

    await queryRunner.query(`
      ALTER TABLE ${priceLists}
        ADD COLUMN IF NOT EXISTS "channel_types" text[] NOT NULL DEFAULT '{}'::text[]
    `);

    await queryRunner.query(`
      CREATE TABLE ${comboItems} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "combo_product_id" uuid NOT NULL,
        "child_variant_id" uuid NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_combo_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_combo_items_product_variant" UNIQUE ("tenant_id", "combo_product_id", "child_variant_id"),
        CONSTRAINT "CHK_combo_items_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "FK_combo_items_combo_product" FOREIGN KEY ("tenant_id", "combo_product_id")
          REFERENCES ${products}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_combo_items_tenant_combo"
        ON ${comboItems} ("tenant_id", "combo_product_id")
    `);

    await enableTenantRlsPolicy(queryRunner, comboItems);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const priceLists = qualifiedTable(queryRunner, 'price_lists');
    const comboItems = qualifiedTable(queryRunner, 'combo_items');

    await queryRunner.query(`DROP TABLE IF EXISTS ${comboItems}`);
    await queryRunner.query(`
      ALTER TABLE ${priceLists}
        DROP COLUMN IF EXISTS "channel_types"
    `);
  }
}
