import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RBAC (ADR-0020): `role`, `role_permission`, `account_tenant.role_id` and
 * `account_tenant_branch` (no rows for a member = every branch).
 *
 * Every existing store gets the five seeded roles with their default
 * permissions, and each member is pointed at the role that replaces their
 * legacy one (owner -> owner, manager -> branch_manager, cashier ->
 * sales_staff); `account_tenant.role` is rewritten to the new role code.
 *
 * The seed data is embedded as literals on purpose: a migration must not
 * change when `@pbl/contracts` does. The owner has no `role_permission` rows
 * (it is always every permission).
 */

const SEEDED_ROLES = [
  {
    code: 'owner',
    name: 'Chủ cửa hàng',
    description: 'Toàn quyền với cửa hàng, không thể chỉnh sửa.',
  },
  {
    code: 'branch_manager',
    name: 'Quản lý chi nhánh',
    description:
      'Quản lý vận hành chi nhánh, trừ quản lý nhân viên và cài đặt cửa hàng.',
  },
  {
    code: 'sales_staff',
    name: 'Nhân viên bán hàng',
    description: 'Bán hàng tại quầy, tạo và cập nhật đơn hàng, chăm sóc khách.',
  },
  {
    code: 'warehouse_staff',
    name: 'Nhân viên kho',
    description: 'Quản lý tồn kho, nhập hàng và xem đơn hàng cần xử lý.',
  },
  {
    code: 'accountant',
    name: 'Kế toán',
    description: 'Xem đơn hàng, công nợ mua hàng và báo cáo.',
  },
];

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  owner: [],
  branch_manager: [
    'channels.create',
    'channels.delete',
    'channels.update',
    'channels.view',
    'customers.create',
    'customers.delete',
    'customers.update',
    'customers.view',
    'dashboard.view',
    'inventory.approve',
    'inventory.create',
    'inventory.delete',
    'inventory.update',
    'inventory.view',
    'orders.approve',
    'orders.create',
    'orders.delete',
    'orders.update',
    'orders.view',
    'pos.create',
    'pos.update',
    'pos.view',
    'products.create',
    'products.delete',
    'products.update',
    'products.view',
    'purchasing.approve',
    'purchasing.create',
    'purchasing.delete',
    'purchasing.update',
    'purchasing.view',
    'reports.view',
    'settings.view',
    'staff.view',
  ],
  sales_staff: [
    'dashboard.view',
    'products.view',
    'inventory.view',
    'orders.view',
    'orders.create',
    'orders.update',
    'pos.view',
    'pos.create',
    'pos.update',
    'customers.view',
    'customers.create',
    'customers.update',
  ],
  warehouse_staff: [
    'dashboard.view',
    'products.view',
    'inventory.view',
    'inventory.create',
    'inventory.update',
    'orders.view',
    'purchasing.view',
    'purchasing.create',
  ],
  accountant: [
    'dashboard.view',
    'orders.view',
    'customers.view',
    'inventory.view',
    'purchasing.view',
    'purchasing.update',
    'reports.view',
  ],
};

export class CreateRolePermissionAndMemberBranch1792300000000
  implements MigrationInterface
{
  name = 'CreateRolePermissionAndMemberBranch1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "role" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(64) NOT NULL,
        "name" character varying(100) NOT NULL,
        "description" character varying(255),
        "is_seeded" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_role_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_role_tenant_code" ON "role" ("tenant_id", "code")`,
    );
    await queryRunner.query(`
      CREATE TABLE "role_permission" (
        "role_id" uuid NOT NULL,
        "permission_code" character varying(64) NOT NULL,
        CONSTRAINT "PK_role_permission" PRIMARY KEY ("role_id", "permission_code"),
        CONSTRAINT "FK_role_permission_role" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE
      )
    `);

    // seed the five roles in every existing store (deleted ones too)
    const values = SEEDED_ROLES.map(
      (_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`,
    ).join(', ');
    await queryRunner.query(
      `INSERT INTO "role" ("tenant_id", "code", "name", "description", "is_seeded")
       SELECT t."id", v."code", v."name", v."description", true
       FROM "tenant" t CROSS JOIN (VALUES ${values}) AS v("code", "name", "description")`,
      SEEDED_ROLES.flatMap((r) => [r.code, r.name, r.description]),
    );
    for (const [code, permissions] of Object.entries(DEFAULT_PERMISSIONS)) {
      if (permissions.length === 0) continue;
      await queryRunner.query(
        `INSERT INTO "role_permission" ("role_id", "permission_code")
         SELECT r."id", p.code FROM "role" r CROSS JOIN unnest($2::text[]) AS p(code)
         WHERE r."code" = $1 AND r."is_seeded"`,
        [code, permissions],
      );
    }

    await queryRunner.query(`ALTER TABLE "account_tenant" ADD "role_id" uuid`);
    await queryRunner.query(`
      UPDATE "account_tenant" at
      SET "role_id" = r."id", "role" = r."code"
      FROM "role" r
      WHERE r."tenant_id" = at."tenant_id"
        AND r."code" = CASE at."role"
          WHEN 'manager' THEN 'branch_manager'
          WHEN 'cashier' THEN 'sales_staff'
          ELSE at."role"
        END
    `);
    // fails loudly if a member holds a role this migration does not know
    await queryRunner.query(
      `ALTER TABLE "account_tenant" ALTER COLUMN "role_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "account_tenant"
        ADD CONSTRAINT "FK_account_tenant_role" FOREIGN KEY ("role_id") REFERENCES "role"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_tenant_role_id" ON "account_tenant" ("role_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "account_tenant_branch" (
        "account_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        CONSTRAINT "PK_account_tenant_branch" PRIMARY KEY ("account_id", "tenant_id", "branch_id"),
        CONSTRAINT "FK_account_tenant_branch_member" FOREIGN KEY ("account_id", "tenant_id")
          REFERENCES "account_tenant"("account_id", "tenant_id") ON DELETE CASCADE,
        CONSTRAINT "FK_account_tenant_branch_branch" FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_tenant_branch_branch_id" ON "account_tenant_branch" ("branch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_tenant_branch"`);
    // back to the three legacy names; roles with no legacy equivalent become
    // the least privileged legacy role
    await queryRunner.query(`
      UPDATE "account_tenant"
      SET "role" = CASE "role"
        WHEN 'owner' THEN 'owner'
        WHEN 'branch_manager' THEN 'manager'
        ELSE 'cashier'
      END
    `);
    await queryRunner.query(`DROP INDEX "IDX_account_tenant_role_id"`);
    await queryRunner.query(
      `ALTER TABLE "account_tenant" DROP CONSTRAINT "FK_account_tenant_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_tenant" DROP COLUMN "role_id"`,
    );
    await queryRunner.query(`DROP TABLE "role_permission"`);
    await queryRunner.query(`DROP TABLE "role"`);
  }
}
