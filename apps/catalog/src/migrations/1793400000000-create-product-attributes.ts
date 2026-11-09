import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The attributes a product uses (Color and Size for one product, Volume and Material for another). The attributes and
 * their values stay shared by the whole store; this table only says which of them a product may vary on, and variants
 * can only carry attributes listed here.
 *
 * Written by hand: it needs the row-level security helper and a backfill that derives each existing product's
 * attributes from the values its variants already carry, which the migration generator cannot express.
 */
export class CreateProductAttributes1793400000000
  implements MigrationInterface
{
  name = 'CreateProductAttributes1793400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'product_attributes');
    const products = qualifiedTable(queryRunner, 'products');
    const attributes = qualifiedTable(queryRunner, 'attributes');
    const variants = qualifiedTable(queryRunner, 'product_variants');
    const variantValues = qualifiedTable(
      queryRunner,
      'variant_attribute_values',
    );

    await queryRunner.query(`
      CREATE TABLE ${table} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "attribute_id" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_attributes_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_attributes_product_attribute" UNIQUE ("tenant_id", "product_id", "attribute_id"),
        CONSTRAINT "CHK_product_attributes_position" CHECK ("position" >= 0),
        CONSTRAINT "FK_product_attributes_product" FOREIGN KEY ("tenant_id", "product_id")
          REFERENCES ${products}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_product_attributes_attribute" FOREIGN KEY ("tenant_id", "attribute_id")
          REFERENCES ${attributes}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_product_attributes_attribute"
      ON ${table} ("tenant_id", "attribute_id")
    `);
    await enableTenantRlsPolicy(queryRunner, table);

    // Every existing product keeps working: it uses the attributes its variants already carry.
    await queryRunner.query(`
      INSERT INTO ${table} ("tenant_id", "product_id", "attribute_id", "position")
      SELECT used."tenant_id", used."product_id", used."attribute_id",
             (ROW_NUMBER() OVER (PARTITION BY used."tenant_id", used."product_id" ORDER BY a."created_at", a."id") - 1)::int
      FROM (
        SELECT DISTINCT v."tenant_id", v."product_id", vav."attribute_id"
        FROM ${variantValues} vav
        JOIN ${variants} v ON v."tenant_id" = vav."tenant_id" AND v."id" = vav."variant_id"
      ) used
      JOIN ${attributes} a ON a."tenant_id" = used."tenant_id" AND a."id" = used."attribute_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'product_attributes')}`,
    );
  }
}
