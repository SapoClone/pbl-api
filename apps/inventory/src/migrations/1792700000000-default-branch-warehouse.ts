import { qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D1 and D14: every branch has exactly one default `BRANCH` warehouse.
 *
 * 1. Repairs data first: a branch with several default `BRANCH` warehouses keeps its oldest default; a branch that has
 *    `BRANCH` warehouses but no default gets its oldest active one (else oldest) as the default and active.
 * 2. Adds the partial unique index that makes "one default per branch" a database rule.
 * 3. Backfills every active branch of `branch_projection` that has no `BRANCH` warehouse with one default warehouse
 *    (code from the branch code, made unique in the tenant; name from the branch name).
 *
 * `down` drops the index. The data repairs and the backfilled warehouses stay: they cannot be told apart from
 * warehouses people made since, and they may hold stock by now; they are valid under the old rules too.
 */
export class DefaultBranchWarehouse1792700000000 implements MigrationInterface {
  name = 'DefaultBranchWarehouse1792700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const wh = qualifiedTable(queryRunner, 'warehouse');
    const bp = qualifiedTable(queryRunner, 'branch_projection');

    // 1a. more than one default in a branch: keep the oldest
    await queryRunner.query(`
      UPDATE ${wh} w SET is_default = false, updated_at = now()
      FROM (
        SELECT id, row_number() OVER (
          PARTITION BY tenant_id, branch_id ORDER BY created_at ASC, id ASC
        ) AS rn
        FROM ${wh}
        WHERE kind = 'BRANCH' AND is_default AND branch_id IS NOT NULL
      ) d
      WHERE w.id = d.id AND d.rn > 1
    `);

    // 1b. BRANCH warehouses but no default: the oldest active one (else the oldest) becomes the default
    await queryRunner.query(`
      UPDATE ${wh} w SET is_default = true, status = 'ACTIVE', updated_at = now()
      FROM (
        SELECT DISTINCT ON (tenant_id, branch_id) id
        FROM ${wh} x
        WHERE x.kind = 'BRANCH' AND x.branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${wh} y
            WHERE y.tenant_id = x.tenant_id AND y.branch_id = x.branch_id
              AND y.kind = 'BRANCH' AND y.is_default
          )
        ORDER BY tenant_id, branch_id, (status = 'ACTIVE') DESC, created_at ASC, id ASC
      ) pick
      WHERE w.id = pick.id
    `);

    // 2. one default BRANCH warehouse per branch
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_warehouse_default_per_branch"
        ON ${wh} ("tenant_id", "branch_id")
        WHERE "kind" = 'BRANCH' AND "is_default"
    `);

    // 3. backfill the active branches that have no BRANCH warehouse; the code is the branch code, or the
    // code with the first 8 characters of the branch id when the tenant already uses it
    await queryRunner.query(
      `
      INSERT INTO ${wh} (id, tenant_id, branch_id, code, name, kind, address, is_default, status)
      SELECT
        gen_random_uuid(),
        b.tenant_id,
        b.branch_id,
        CASE WHEN EXISTS (
               SELECT 1 FROM ${wh} c WHERE c.tenant_id = b.tenant_id AND c.code = upper(b.code))
             THEN left(upper(b.code), 23) || '-' || left(replace(b.branch_id::text, '-', ''), 8)
             ELSE upper(b.code) END,
        left(b.name, 120),
        'BRANCH',
        NULL,
        true,
        'ACTIVE'
      FROM ${bp} b
      WHERE b.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM ${wh} w
          WHERE w.tenant_id = b.tenant_id AND w.branch_id = b.branch_id AND w.kind = 'BRANCH'
        )
      `,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = (queryRunner.connection.options as { schema?: string })
      .schema;
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${schema ? `"${schema}".` : ''}"UQ_warehouse_default_per_branch"`,
    );
  }
}
