import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogTables1791900000200 implements MigrationInterface {
  name = 'CreateCatalogTables1791900000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const categories = qualifiedTable(queryRunner, 'categories');
    const brands = qualifiedTable(queryRunner, 'brands');
    const attributes = qualifiedTable(queryRunner, 'attributes');
    const attributeValues = qualifiedTable(queryRunner, 'attribute_values');
    const products = qualifiedTable(queryRunner, 'products');
    const productVariants = qualifiedTable(queryRunner, 'product_variants');
    const variantAttributeValues = qualifiedTable(
      queryRunner,
      'variant_attribute_values',
    );
    const unitConversions = qualifiedTable(queryRunner, 'unit_conversions');
    const priceLists = qualifiedTable(queryRunner, 'price_lists');
    const priceListItems = qualifiedTable(queryRunner, 'price_list_items');
    const comboItems = qualifiedTable(queryRunner, 'combo_items');
    const priceListChannels = qualifiedTable(
      queryRunner,
      'price_list_channels',
    );
    const priceListCustomerGroups = qualifiedTable(
      queryRunner,
      'price_list_customer_groups',
    );
    const uploads = qualifiedTable(queryRunner, 'uploads');
    const productImports = qualifiedTable(queryRunner, 'product_imports');

    // 1. categories
    await queryRunner.query(`
      CREATE TABLE ${categories} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "parent_id" uuid NULL,
        "name" character varying(120) NOT NULL,
        "normalized_name" character varying(120) NOT NULL,
        "slug" character varying(140) NOT NULL,
        "depth" integer NOT NULL DEFAULT 1,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_categories_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_categories_depth" CHECK ("depth" >= 1 AND "depth" <= 3),
        CONSTRAINT "CHK_categories_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "CHK_categories_no_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
        CONSTRAINT "FK_categories_parent" FOREIGN KEY ("tenant_id", "parent_id")
          REFERENCES ${categories}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_categories_root_slug"
      ON ${categories} ("tenant_id", "slug")
      WHERE "parent_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_categories_child_slug"
      ON ${categories} ("tenant_id", "parent_id", "slug")
      WHERE "parent_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_categories_root_name"
      ON ${categories} ("tenant_id", "normalized_name")
      WHERE "parent_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_categories_child_name"
      ON ${categories} ("tenant_id", "parent_id", "normalized_name")
      WHERE "parent_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_categories_tenant_parent_status"
      ON ${categories} ("tenant_id", "parent_id", "status")
    `);

    // 2. brands
    await queryRunner.query(`
      CREATE TABLE ${brands} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "normalized_name" character varying(120) NOT NULL,
        "description" character varying(500) NULL,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brands_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_brands_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_brands_tenant_norm_name" UNIQUE ("tenant_id", "normalized_name"),
        CONSTRAINT "CHK_brands_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_brands_tenant_status_name"
      ON ${brands} ("tenant_id", "status", "normalized_name")
    `);

    // 3. attributes
    await queryRunner.query(`
      CREATE TABLE ${attributes} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "normalized_name" character varying(80) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attributes_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_attributes_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_attributes_tenant_norm_name" UNIQUE ("tenant_id", "normalized_name")
      )
    `);

    // 4. attribute_values
    await queryRunner.query(`
      CREATE TABLE ${attributeValues} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "attribute_id" uuid NOT NULL,
        "value" character varying(120) NOT NULL,
        "normalized_value" character varying(120) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attribute_values_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_attribute_values_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_attribute_values_tenant_attr_id" UNIQUE ("tenant_id", "attribute_id", "id"),
        CONSTRAINT "UQ_attribute_values_tenant_attr_norm_val" UNIQUE ("tenant_id", "attribute_id", "normalized_value"),
        CONSTRAINT "FK_attribute_values_attribute" FOREIGN KEY ("tenant_id", "attribute_id")
          REFERENCES ${attributes}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // 5. products
    await queryRunner.query(`
      CREATE TABLE ${products} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "category_id" uuid NULL,
        "brand_id" uuid NULL,
        "name" character varying(200) NOT NULL,
        "normalized_name" character varying(200) NOT NULL,
        "description" text NULL,
        "base_unit" character varying(40) NOT NULL DEFAULT 'piece',
        "is_combo" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "images" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_products_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_products_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_products_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
        CONSTRAINT "CHK_products_version" CHECK ("version" >= 1),
        CONSTRAINT "CHK_products_images_max_10" CHECK (
          jsonb_typeof("images") = 'array' AND jsonb_array_length("images") <= 10
        ),
        CONSTRAINT "FK_products_category" FOREIGN KEY ("tenant_id", "category_id")
          REFERENCES ${categories}("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_products_brand" FOREIGN KEY ("tenant_id", "brand_id")
          REFERENCES ${brands}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_products_tenant_status_created"
      ON ${products} ("tenant_id", "status", "created_at" DESC, "id")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_products_tenant_category_status"
      ON ${products} ("tenant_id", "category_id", "status")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_products_tenant_brand_status"
      ON ${products} ("tenant_id", "brand_id", "status")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_products_tenant_norm_name"
      ON ${products} ("tenant_id", "normalized_name" varchar_pattern_ops)
      WHERE "deleted_at" IS NULL
    `);

    // 6. product_variants (strictly no avg_cost_price or stock columns — ADR-0013)
    await queryRunner.query(`
      CREATE TABLE ${productVariants} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "sku_code" character varying(64) NOT NULL,
        "barcode" character varying(64) NULL,
        "name" character varying(240) NOT NULL,
        "base_price" bigint NOT NULL DEFAULT 0,
        "image_url" character varying(500) NULL,
        "weight" numeric(12,3) NULL,
        "combination_signature" character varying(512) NOT NULL DEFAULT 'DEFAULT',
        "is_default" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_product_variants_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_variants_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_product_variants_tenant_sku" UNIQUE ("tenant_id", "sku_code"),
        CONSTRAINT "UQ_product_variants_product_combo_sig" UNIQUE ("tenant_id", "product_id", "combination_signature"),
        CONSTRAINT "CHK_product_variants_base_price" CHECK ("base_price" >= 0),
        CONSTRAINT "CHK_product_variants_weight" CHECK ("weight" IS NULL OR "weight" >= 0),
        CONSTRAINT "CHK_product_variants_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
        CONSTRAINT "CHK_product_variants_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_product_variants_product" FOREIGN KEY ("tenant_id", "product_id")
          REFERENCES ${products}("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_product_variants_tenant_barcode"
      ON ${productVariants} ("tenant_id", "barcode")
      WHERE "barcode" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_product_variants_tenant_product"
      ON ${productVariants} ("tenant_id", "product_id")
      WHERE "deleted_at" IS NULL
    `);

    // 7. variant_attribute_values
    await queryRunner.query(`
      CREATE TABLE ${variantAttributeValues} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "attribute_id" uuid NOT NULL,
        "attribute_value_id" uuid NOT NULL,
        CONSTRAINT "PK_variant_attribute_values_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_variant_attribute_values_single_per_attr" UNIQUE ("tenant_id", "variant_id", "attribute_id"),
        CONSTRAINT "FK_variant_attribute_values_variant" FOREIGN KEY ("tenant_id", "variant_id")
          REFERENCES ${productVariants}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_variant_attribute_values_attr_val" FOREIGN KEY ("tenant_id", "attribute_id", "attribute_value_id")
          REFERENCES ${attributeValues}("tenant_id", "attribute_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_variant_attribute_values_variant"
      ON ${variantAttributeValues} ("tenant_id", "variant_id")
    `);

    // 8. unit_conversions
    await queryRunner.query(`
      CREATE TABLE ${unitConversions} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "unit_name" character varying(60) NOT NULL,
        "normalized_unit_name" character varying(60) NOT NULL,
        "conversion_factor" numeric(18,4) NOT NULL,
        "is_base" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unit_conversions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_unit_conversions_product_unit" UNIQUE ("tenant_id", "product_id", "normalized_unit_name"),
        CONSTRAINT "CHK_unit_conversions_factor_positive" CHECK ("conversion_factor" > 0),
        CONSTRAINT "CHK_unit_conversions_base_factor_one" CHECK (NOT "is_base" OR "conversion_factor" = 1),
        CONSTRAINT "FK_unit_conversions_product" FOREIGN KEY ("tenant_id", "product_id")
          REFERENCES ${products}("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_unit_conversions_single_base"
      ON ${unitConversions} ("tenant_id", "product_id")
      WHERE "is_base" = true
    `);

    // 9. price_lists
    await queryRunner.query(`
      CREATE TABLE ${priceLists} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "normalized_name" character varying(120) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "start_date" date NULL,
        "end_date" date NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_lists_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_lists_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_price_lists_tenant_norm_name" UNIQUE ("tenant_id", "normalized_name"),
        CONSTRAINT "CHK_price_lists_dates" CHECK (
          "start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date"
        ),
        CONSTRAINT "CHK_price_lists_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "CHK_price_lists_version" CHECK ("version" >= 1)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_price_lists_active_default"
      ON ${priceLists} ("tenant_id")
      WHERE "is_default" = true AND "status" = 'ACTIVE'
    `);

    // 10. price_list_items
    await queryRunner.query(`
      CREATE TABLE ${priceListItems} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "price_list_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "price" bigint NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_list_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_list_items_unique" UNIQUE ("tenant_id", "price_list_id", "variant_id"),
        CONSTRAINT "CHK_price_list_items_price" CHECK ("price" >= 0),
        CONSTRAINT "CHK_price_list_items_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_price_list_items_list" FOREIGN KEY ("tenant_id", "price_list_id")
          REFERENCES ${priceLists}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_price_list_items_variant" FOREIGN KEY ("tenant_id", "variant_id")
          REFERENCES ${productVariants}("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_price_list_items_variant"
      ON ${priceListItems} ("tenant_id", "variant_id")
    `);

    // 11. Deferred M2/M3 schema tables (combo_items, price_list_channels, price_list_customer_groups)
    await queryRunner.query(`
      CREATE TABLE ${comboItems} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "combo_variant_id" uuid NOT NULL,
        "child_variant_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        CONSTRAINT "PK_combo_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_combo_items_pair" UNIQUE ("tenant_id", "combo_variant_id", "child_variant_id"),
        CONSTRAINT "CHK_combo_items_no_self" CHECK ("combo_variant_id" <> "child_variant_id"),
        CONSTRAINT "CHK_combo_items_qty_pos" CHECK ("quantity" > 0),
        CONSTRAINT "FK_combo_items_parent" FOREIGN KEY ("tenant_id", "combo_variant_id")
          REFERENCES ${productVariants}("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_combo_items_child" FOREIGN KEY ("tenant_id", "child_variant_id")
          REFERENCES ${productVariants}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${priceListChannels} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "price_list_id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        CONSTRAINT "PK_price_list_channels_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_list_channels_unique" UNIQUE ("tenant_id", "price_list_id", "channel_id"),
        CONSTRAINT "FK_price_list_channels_list" FOREIGN KEY ("tenant_id", "price_list_id")
          REFERENCES ${priceLists}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ${priceListCustomerGroups} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "price_list_id" uuid NOT NULL,
        "customer_group_id" uuid NOT NULL,
        CONSTRAINT "PK_price_list_customer_groups_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_list_customer_groups_unique" UNIQUE ("tenant_id", "price_list_id", "customer_group_id"),
        CONSTRAINT "FK_price_list_customer_groups_list" FOREIGN KEY ("tenant_id", "price_list_id")
          REFERENCES ${priceLists}("tenant_id", "id") ON DELETE CASCADE
      )
    `);

    // Upload metadata (images, import CSVs); the bytes live behind the storage adapter
    await queryRunner.query(`
      CREATE TABLE ${uploads} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(100) NOT NULL,
        "declared_size" integer NOT NULL,
        "stored_size" integer NULL,
        "storage_key" character varying(255) NOT NULL,
        "public_url" character varying(500) NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PENDING',
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_uploads_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_uploads_tenant_id_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_uploads_kind" CHECK ("kind" IN ('IMAGE', 'IMPORT')),
        CONSTRAINT "CHK_uploads_status" CHECK ("status" IN ('PENDING', 'UPLOADED', 'ATTACHED')),
        CONSTRAINT "CHK_uploads_declared_size" CHECK ("declared_size" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_uploads_tenant_status_expires"
      ON ${uploads} ("tenant_id", "status", "expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE ${productImports} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "upload_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PROCESSING',
        "created_count" integer NOT NULL DEFAULT 0,
        "updated_count" integer NOT NULL DEFAULT 0,
        "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_imports_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_imports_upload" UNIQUE ("tenant_id", "upload_id"),
        CONSTRAINT "CHK_product_imports_status" CHECK ("status" IN ('PROCESSING', 'COMPLETED', 'FAILED')),
        CONSTRAINT "FK_product_imports_upload" FOREIGN KEY ("tenant_id", "upload_id")
          REFERENCES ${uploads}("tenant_id", "id") ON DELETE RESTRICT
      )
    `);

    // Enable and force PostgreSQL Row-Level Security on all tenant-owned Catalog tables (ADR-0011)
    for (const table of [
      categories,
      brands,
      attributes,
      attributeValues,
      products,
      productVariants,
      variantAttributeValues,
      unitConversions,
      priceLists,
      priceListItems,
      comboItems,
      priceListChannels,
      priceListCustomerGroups,
      uploads,
      productImports,
    ]) {
      await enableTenantRlsPolicy(queryRunner, table);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'product_imports',
      'uploads',
      'price_list_customer_groups',
      'price_list_channels',
      'combo_items',
      'price_list_items',
      'price_lists',
      'unit_conversions',
      'variant_attribute_values',
      'product_variants',
      'products',
      'attribute_values',
      'attributes',
      'brands',
      'categories',
    ]) {
      await queryRunner.query(
        `DROP TABLE ${qualifiedTable(queryRunner, name)}`,
      );
    }
  }
}
