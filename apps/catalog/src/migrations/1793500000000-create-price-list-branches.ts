import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prices per branch: the branches a price list covers, and the branches catalog knows from platform's events.
 *
 * `price_list_branches.is_active` copies the status of the list (kept in step by PricingService in the same transaction),
 * so that "a branch belongs to at most one active price list" is a database rule and not only a check in the code.
 * A list without rows covers every branch, as before. Written by hand for the partial index and the RLS helper.
 */
export class CreatePriceListBranches1793500000000
  implements MigrationInterface
{
  name = 'CreatePriceListBranches1793500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = qualifiedTable(queryRunner, 'price_list_branches');
    const priceLists = qualifiedTable(queryRunner, 'price_lists');
    const branches = qualifiedTable(queryRunner, 'branch_projection');

    await queryRunner.query(`
      CREATE TABLE ${table} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "price_list_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_list_branches_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_list_branches_list_branch" UNIQUE ("tenant_id", "price_list_id", "branch_id"),
        CONSTRAINT "FK_price_list_branches_list" FOREIGN KEY ("tenant_id", "price_list_id")
          REFERENCES ${priceLists}("tenant_id", "id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_price_list_branches_active_branch"
      ON ${table} ("tenant_id", "branch_id")
      WHERE "is_active" = true
    `);
    await enableTenantRlsPolicy(queryRunner, table);

    await queryRunner.query(`
      CREATE TABLE ${branches} (
        "branch_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(150) NOT NULL,
        "is_warehouse" boolean NOT NULL,
        "status" character varying(20) NOT NULL,
        "source_updated_at" TIMESTAMPTZ NOT NULL,
        "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branch_projection_branch_id" PRIMARY KEY ("branch_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_branch_projection_tenant" ON ${branches} ("tenant_id")`,
    );
    await enableTenantRlsPolicy(queryRunner, branches);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'price_list_branches')}`,
    );
    await queryRunner.query(
      `DROP TABLE ${qualifiedTable(queryRunner, 'branch_projection')}`,
    );
  }
}
