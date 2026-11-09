import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The prices catalog sets for one branch, kept by `catalog.price.changed` events (one row per variant, price list and
 * branch). `catalog_variant_projection.unit_price` stays the price for every branch; a row here replaces it for its
 * branch while the list is active and inside its dates.
 *
 * Rows are never deleted: a list that is switched off or a branch that is taken out of a list keeps its row with
 * `is_active = false`, so a late event of an earlier version cannot bring the price back (`list_version`,
 * `aggregate_version` and `source_updated_at` only move forward).
 */
export class CreateCatalogBranchPriceProjection1793500000000
  implements MigrationInterface
{
  name = 'CreateCatalogBranchPriceProjection1793500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(
      queryRunner,
      'catalog_branch_price_projection',
    );
    await queryRunner.query(`
      CREATE TABLE ${table} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "price_list_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "price" bigint NOT NULL,
        "start_date" date NULL,
        "end_date" date NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "list_version" integer NOT NULL DEFAULT 0,
        "aggregate_version" integer NOT NULL DEFAULT 1,
        "source_updated_at" TIMESTAMPTZ NOT NULL,
        "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_branch_price_projection_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_branch_price_projection_key" UNIQUE ("tenant_id", "variant_id", "price_list_id", "branch_id"),
        CONSTRAINT "CHK_catalog_branch_price_projection_price" CHECK ("price" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalog_branch_price_projection_lookup"
      ON ${table} ("tenant_id", "branch_id", "variant_id")
      WHERE "is_active" = true
    `);
    await enableTenantRlsPolicy(queryRunner, table);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'catalog_branch_price_projection')}`,
    );
  }
}
