import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Finance permissions (ADR-0020): the catalog gained `finance.view|create|
 * update|approve`. New stores are seeded from the contracts defaults; this
 * gives the existing stores' seeded roles the same codes.
 *
 * Literal lists on purpose: a migration must not change when `@pbl/contracts`
 * does. `warehouse_staff` gains none and the owner has no rows. Only seeded
 * roles are touched; custom roles are left to their admins. `down()` removes
 * exactly these rows from seeded roles.
 */
const FINANCE_PERMISSIONS: Record<string, string[]> = {
  branch_manager: [
    'finance.approve',
    'finance.create',
    'finance.update',
    'finance.view',
  ],
  accountant: [
    'finance.approve',
    'finance.create',
    'finance.update',
    'finance.view',
  ],
  sales_staff: ['finance.create', 'finance.view'],
};

export class AddFinancePermissions1792400000000 implements MigrationInterface {
  name = 'AddFinancePermissions1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, permissions] of Object.entries(FINANCE_PERMISSIONS)) {
      await queryRunner.query(
        `INSERT INTO "role_permission" ("role_id", "permission_code")
         SELECT r."id", p.code FROM "role" r CROSS JOIN unnest($2::text[]) AS p(code)
         WHERE r."code" = $1 AND r."is_seeded"
         ON CONFLICT DO NOTHING`,
        [code, permissions],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [code, permissions] of Object.entries(FINANCE_PERMISSIONS)) {
      await queryRunner.query(
        `DELETE FROM "role_permission" rp USING "role" r
         WHERE rp."role_id" = r."id" AND r."code" = $1 AND r."is_seeded"
           AND rp."permission_code" = ANY($2::text[])`,
        [code, permissions],
      );
    }
  }
}
