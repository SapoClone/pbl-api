import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogTables1792000000000 implements MigrationInterface {
  name = 'CreateCatalogTables1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const q = (sql: string) => queryRunner.query(sql);

    await q(`
      CREATE TABLE ${t('category')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "parent_id" uuid,
        "name" character varying(150) NOT NULL,
        "slug" character varying(180) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_category_parent" FOREIGN KEY ("parent_id") REFERENCES ${t('category')} ("id")
      )`);
    await q(
      `CREATE INDEX "IDX_category_tenant_parent" ON ${t('category')} ("tenant_id", "parent_id")`,
    );
    // a root has a null parent, and nulls are distinct in a plain unique index
    await q(
      `CREATE UNIQUE INDEX "UQ_category_tenant_parent_name" ON ${t('category')}
         ("tenant_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'), lower("name"))`,
    );

    await q(`
      CREATE TABLE ${t('brand')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" character varying(150) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brand_id" PRIMARY KEY ("id")
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_brand_tenant_name" ON ${t('brand')} ("tenant_id", "name")`,
    );

    await q(`
      CREATE TABLE ${t('attribute')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attribute_id" PRIMARY KEY ("id")
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_attribute_tenant_name" ON ${t('attribute')} ("tenant_id", "name")`,
    );

    await q(`
      CREATE TABLE ${t('attribute_value')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "attribute_id" uuid NOT NULL,
        "value" character varying(100) NOT NULL,
        "code" character varying(30) NOT NULL,
        CONSTRAINT "PK_attribute_value_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attribute_value_attribute" FOREIGN KEY ("attribute_id")
          REFERENCES ${t('attribute')} ("id") ON DELETE CASCADE
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_attribute_value_attribute_value" ON ${t('attribute_value')} ("attribute_id", "value")`,
    );

    await q(`
      CREATE TABLE ${t('product')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "category_id" uuid,
        "brand_id" uuid,
        "name" character varying(255) NOT NULL,
        "description" text,
        "base_unit" character varying(50) NOT NULL,
        "is_combo" boolean NOT NULL DEFAULT false,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_product_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_product_status" CHECK ("status" IN ('active', 'inactive')),
        CONSTRAINT "FK_product_category" FOREIGN KEY ("category_id") REFERENCES ${t('category')} ("id"),
        CONSTRAINT "FK_product_brand" FOREIGN KEY ("brand_id") REFERENCES ${t('brand')} ("id")
      )`);
    await q(
      `CREATE INDEX "IDX_product_tenant_category" ON ${t('product')} ("tenant_id", "category_id")`,
    );
    await q(
      `CREATE INDEX "IDX_product_tenant_created" ON ${t('product')} ("tenant_id", "created_at")`,
    );

    await q(`
      CREATE TABLE ${t('product_variant')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "sku_code" character varying(64) NOT NULL,
        "barcode" character varying(64),
        "price" bigint NOT NULL DEFAULT 0,
        "avg_cost_price" bigint,
        "weight" numeric(12,3),
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "attributes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_product_variant_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_product_variant_status" CHECK ("status" IN ('active', 'inactive')),
        CONSTRAINT "CHK_product_variant_price" CHECK ("price" >= 0),
        CONSTRAINT "FK_product_variant_product" FOREIGN KEY ("product_id") REFERENCES ${t('product')} ("id")
      )`);
    await q(
      `CREATE INDEX "IDX_product_variant_product" ON ${t('product_variant')} ("product_id")`,
    );
    await q(
      `CREATE UNIQUE INDEX "UQ_product_variant_tenant_sku" ON ${t('product_variant')} ("tenant_id", "sku_code") WHERE "deleted_at" IS NULL`,
    );
    await q(
      `CREATE UNIQUE INDEX "UQ_product_variant_tenant_barcode" ON ${t('product_variant')} ("tenant_id", "barcode") WHERE "deleted_at" IS NULL AND "barcode" IS NOT NULL`,
    );

    await q(`
      CREATE TABLE ${t('product_image')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid,
        "url" character varying(1000) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_cover" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_product_image_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_image_product" FOREIGN KEY ("product_id")
          REFERENCES ${t('product')} ("id") ON DELETE CASCADE
      )`);
    await q(
      `CREATE INDEX "IDX_product_image_product" ON ${t('product_image')} ("product_id", "sort_order")`,
    );

    await q(`
      CREATE TABLE ${t('product_channel_listing')} (
        "id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "channel" character varying(30) NOT NULL,
        "is_listed" boolean NOT NULL DEFAULT true,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_channel_listing_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_channel_listing_variant" FOREIGN KEY ("variant_id")
          REFERENCES ${t('product_variant')} ("id") ON DELETE CASCADE
      )`);
    await q(
      `CREATE UNIQUE INDEX "UQ_product_channel_listing_variant_channel" ON ${t('product_channel_listing')} ("variant_id", "channel")`,
    );
    await q(
      `CREATE INDEX "IDX_product_channel_listing_tenant_channel" ON ${t('product_channel_listing')} ("tenant_id", "channel") WHERE "is_listed"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'product_channel_listing',
      'product_image',
      'product_variant',
      'product',
      'attribute_value',
      'attribute',
      'brand',
      'category',
    ]) {
      await queryRunner.query(
        `DROP TABLE IF EXISTS ${qualifiedTable(queryRunner, table)}`,
      );
    }
  }
}
