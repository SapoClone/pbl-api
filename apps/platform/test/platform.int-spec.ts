/**
 * Platform migrations and the member-code SQL against a real Postgres, in a
 * throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PblAuthModule } from '@pbl/auth';
import { createTestAuth } from '@pbl/auth/testing';
import { ALL_PERMISSIONS } from '@pbl/contracts';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { IT_DB, uniqueSchema } from '../../../libs/events/test/it-env';
import { AccountEntity } from '../src/api/account/entities/account.entity';
import { RefreshTokenEntity } from '../src/api/auth/entities/refresh-token.entity';
import { BranchSettingEntity } from '../src/api/branch/entities/branch-setting.entity';
import { BranchEntity } from '../src/api/branch/entities/branch.entity';
import { RolePermissionEntity } from '../src/api/role/entities/role-permission.entity';
import { RoleEntity } from '../src/api/role/entities/role.entity';
import { seedRoles } from '../src/api/role/role-seeding';
import { RoleModule } from '../src/api/role/role.module';
import { RoleService } from '../src/api/role/role.service';
import { StaffScheduleEntity } from '../src/api/staff-schedule/entities/staff-schedule.entity';
import { AccountTenantBranchEntity } from '../src/api/tenant/entities/account-tenant-branch.entity';
import { AccountTenantEntity } from '../src/api/tenant/entities/account-tenant.entity';
import { TenantEntity } from '../src/api/tenant/entities/tenant.entity';
import { nextMemberCode } from '../src/api/tenant/member-code';
import { MembershipService } from '../src/api/tenant/membership.service';
import { CreateUserTable1720105653064 } from '../src/database/migrations/1721488504685-create-user-table';
import { CreateSessionTable1721550180313 } from '../src/database/migrations/1721550180313-create-session-table';
import { CreatePostTable1722352657866 } from '../src/database/migrations/1722352657866-create-post-table';
import { ReplaceSessionWithRefreshToken1791476400000 } from '../src/database/migrations/1791476400000-replace-session-with-refresh-token';
import { IntroduceTenancy1791563000000 } from '../src/database/migrations/1791563000000-introduce-tenancy';
import { AddMemberStatusLoginLockoutSessions1792000000000 } from '../src/database/migrations/1792000000000-add-member-status-login-lockout-sessions';
import { CreateBranchSettingAndStaffSchedule1792000000001 } from '../src/database/migrations/1792000000001-create-branch-setting-and-staff-schedule';
import { CreateRolePermissionAndMemberBranch1792300000000 } from '../src/database/migrations/1792300000000-create-role-permission-and-member-branch';

describe('platform (Postgres)', () => {
  const schema = uniqueSchema('platform_it');
  let dataSource: DataSource;
  const sql = <T = unknown>(text: string, params: unknown[] = []) =>
    dataSource.query(text, params) as Promise<T>;
  const T1 = randomUUID();
  const T2 = randomUUID();
  const A1 = randomUUID();
  const A2 = randomUUID();
  const A3 = randomUUID();

  beforeAll(async () => {
    const admin = new DataSource({
      type: 'postgres',
      host: IT_DB.host,
      port: Number(IT_DB.port),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
    });
    await admin.initialize();
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      host: IT_DB.host,
      port: Number(IT_DB.port),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
      schema,
      // the hand-written migrations use bare table names, as the TypeORM CLI run does
      extra: { options: `-c search_path=${schema},public` },
      entities: [
        AccountEntity,
        TenantEntity,
        AccountTenantEntity,
        BranchEntity,
        RoleEntity,
        RolePermissionEntity,
        AccountTenantBranchEntity,
        BranchSettingEntity,
        StaffScheduleEntity,
        RefreshTokenEntity,
      ],
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    for (const migration of [
      new CreateUserTable1720105653064(),
      new CreateSessionTable1721550180313(),
      new CreatePostTable1722352657866(),
      new ReplaceSessionWithRefreshToken1791476400000(),
      new IntroduceTenancy1791563000000(),
    ]) {
      await migration.up(runner);
    }
    await runner.release();

    // data that exists before this wave's migrations (backfill check)
    for (const [id, email] of [
      [A1, 'a1@x.vn'],
      [A2, 'a2@x.vn'],
      [A3, 'a3@x.vn'],
    ]) {
      await sql(
        `INSERT INTO "account" ("id","email","password","created_by","updated_by") VALUES ($1,$2,'x','t','t')`,
        [id, email],
      );
    }
    for (const [id, sub] of [
      [T1, 's1'],
      [T2, 's2'],
    ]) {
      await sql(
        `INSERT INTO "tenant" ("id","name","subdomain","created_by","updated_by") VALUES ($1,$2,$2,'t','t')`,
        [id, sub],
      );
    }
    await sql(
      `INSERT INTO "account_tenant" ("account_id","tenant_id","role","created_at") VALUES
        ($1,$4,'owner','2026-01-01'),($2,$4,'cashier','2026-01-02'),($3,$5,'owner','2026-01-03')`,
      [A1, A2, A3, T1, T2],
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
    await dataSource.destroy();
  });

  it('adds status and a per-store NV code, backfilled by join order', async () => {
    const runner = dataSource.createQueryRunner();
    await new AddMemberStatusLoginLockoutSessions1792000000000().up(runner);
    await runner.release();

    const rows = await sql<
      { account_id: string; code: string; status: string }[]
    >(
      `SELECT "account_id","code","status" FROM "account_tenant" ORDER BY "tenant_id","code"`,
    );
    const codeOf = (id: string) => rows.find((r) => r.account_id === id);
    expect(codeOf(A1)).toMatchObject({ code: 'NV001', status: 'active' });
    expect(codeOf(A2)).toMatchObject({ code: 'NV002', status: 'active' });
    expect(codeOf(A3)).toMatchObject({ code: 'NV001' }); // own counter per store
    await expect(
      sql(
        `INSERT INTO "account_tenant" ("account_id","tenant_id","role","code") VALUES ($1,$2,'cashier','NV001')`,
        [A3, T1],
      ),
    ).rejects.toThrow(/UQ_account_tenant_tenant_code/);
  });

  it('gives the next code of a store, and an independent one to another store', async () => {
    const em = dataSource.manager;
    await expect(nextMemberCode(em, T1)).resolves.toBe('NV003');
    await expect(nextMemberCode(em, T2)).resolves.toBe('NV002');
    await expect(nextMemberCode(em, randomUUID())).resolves.toBe('NV001');
  });

  it('finds the member table by schema, as the running service connects (no search_path)', async () => {
    // Regression: the service sets `schema` in the TypeORM options and no
    // search_path, so raw SQL must carry the schema. A bare "account_tenant"
    // failed with `relation does not exist` when adding a member.
    const serviceLike = new DataSource({
      type: 'postgres',
      host: IT_DB.host,
      port: Number(IT_DB.port),
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
      schema,
      entities: [
        AccountEntity,
        TenantEntity,
        AccountTenantEntity,
        BranchEntity,
        RoleEntity,
        RolePermissionEntity,
        AccountTenantBranchEntity,
      ],
    });
    await serviceLike.initialize();
    try {
      await expect(nextMemberCode(serviceLike.manager, T1)).resolves.toBe(
        'NV003',
      );
    } finally {
      await serviceLike.destroy();
    }
  });

  it('never gives the same code to concurrent additions', async () => {
    const codes = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const account = randomUUID();
        await sql(
          `INSERT INTO "account" ("id","email","password","created_by","updated_by") VALUES ($1,$2,'x','t','t')`,
          [account, `c${i}@x.vn`],
        );
        return dataSource.transaction(async (em) => {
          const code = await nextMemberCode(em, T1);
          // raw: this schema predates role_id (the RBAC migration is not run here)
          await em.query(
            `INSERT INTO "account_tenant" ("account_id","tenant_id","role","code") VALUES ($1,$2,'cashier',$3)`,
            [account, T1, code],
          );
          return code;
        });
      }),
    );
    expect(new Set(codes).size).toBe(5);
  });

  it('adds the login-lockout and session columns with defaults', async () => {
    const [acc] = await sql<
      { failed_login_count: number; locked_until: Date | null }[]
    >(
      `SELECT "failed_login_count","locked_until" FROM "account" WHERE "id"=$1`,
      [A1],
    );
    expect(acc).toEqual({ failed_login_count: 0, locked_until: null });
    await sql(`SELECT "user_agent","ip" FROM "refresh_token" LIMIT 1`);
  });

  it('applies the atomic failed-login update: 5th failure locks and resets', async () => {
    const accounts = dataSource.getRepository(AccountEntity);
    const fail = () =>
      accounts
        .createQueryBuilder()
        .update(AccountEntity)
        .set({
          failedLoginCount: () =>
            `CASE WHEN "failed_login_count" + 1 >= :max THEN 0 ELSE "failed_login_count" + 1 END`,
          lockedUntil: () =>
            `CASE WHEN "failed_login_count" + 1 >= :max THEN :lockedUntil ELSE "locked_until" END`,
        })
        .where('id = :id', { id: A2 })
        .setParameters({ max: 5, lockedUntil: new Date(Date.now() + 900_000) })
        .execute();
    for (let i = 0; i < 4; i++) await fail();
    let [acc] = await sql<
      { failed_login_count: number; locked_until: Date | null }[]
    >(
      `SELECT "failed_login_count","locked_until" FROM "account" WHERE "id"=$1`,
      [A2],
    );
    expect(acc.failed_login_count).toBe(4);
    expect(acc.locked_until).toBeNull();
    await fail();
    [acc] = await sql(
      `SELECT "failed_login_count","locked_until" FROM "account" WHERE "id"=$1`,
      [A2],
    );
    expect(acc.failed_login_count).toBe(0);
    expect(acc.locked_until!.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates branch_setting (1-1) and staff_schedule with their constraints', async () => {
    const runner = dataSource.createQueryRunner();
    await new CreateBranchSettingAndStaffSchedule1792000000001().up(runner);
    await runner.release();
    const branch = randomUUID();
    await sql(
      `INSERT INTO "branch" ("id","tenant_id","name","code","created_by","updated_by") VALUES ($1,$2,'B','CN01','t','t')`,
      [branch, T1],
    );
    const insertSetting = () =>
      sql(
        `INSERT INTO "branch_setting" ("tenant_id","branch_id","created_by","updated_by") VALUES ($1,$2,'t','t')`,
        [T1, branch],
      );
    await insertSetting();
    await expect(insertSetting()).rejects.toThrow(
      /UQ_branch_setting_branch_id/,
    );
    const [setting] = await sql<
      {
        invoice_prefix: string;
        default_tax_rate: string;
        allowed_payment_methods: string[];
      }[]
    >(`SELECT * FROM "branch_setting"`);
    expect(setting.invoice_prefix).toBe('HD');
    expect(Number(setting.default_tax_rate)).toBe(0);
    expect(setting.allowed_payment_methods).toEqual([
      'cash',
      'transfer',
      'card',
    ]);

    const shift = (weekday: number, start: string, end: string) =>
      sql(
        `INSERT INTO "staff_schedule" ("tenant_id","account_id","branch_id","weekday","start_time","end_time","created_by","updated_by") VALUES ($1,$2,$3,$4,$5,$6,'t','t')`,
        [T1, A1, branch, weekday, start, end],
      );
    await shift(1, '08:00', '16:00');
    await expect(shift(8, '08:00', '16:00')).rejects.toThrow(
      /CHK_staff_schedule_weekday/,
    );
    await expect(shift(2, '16:00', '08:00')).rejects.toThrow(
      /CHK_staff_schedule_time/,
    );
  });

  it('runs the migrations down again', async () => {
    const runner = dataSource.createQueryRunner();
    await new CreateBranchSettingAndStaffSchedule1792000000001().down(runner);
    await new AddMemberStatusLoginLockoutSessions1792000000000().down(runner);
    await runner.release();
    const tables = await sql<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1`,
      [schema],
    );
    expect(tables.map((t) => t.table_name)).not.toContain('staff_schedule');
    expect(tables.map((t) => t.table_name)).not.toContain('branch_setting');
    await expect(sql(`SELECT "code" FROM "account_tenant"`)).rejects.toThrow();
  });
});

/**
 * RBAC (ADR-0020): the migration with legacy data, and the role queries the
 * service runs, connected the way the service connects (schema option, no
 * search_path). Own schema: the migrations run from the start.
 */
describe('platform RBAC (Postgres)', () => {
  const schema = uniqueSchema('platform_rbac_it');
  const connection = {
    type: 'postgres' as const,
    host: IT_DB.host,
    port: Number(IT_DB.port),
    username: 'postgres',
    password: 'postgres',
    database: 'pbl',
    schema,
  };
  const entities = [
    AccountEntity,
    TenantEntity,
    AccountTenantEntity,
    BranchEntity,
    BranchSettingEntity,
    StaffScheduleEntity,
    RefreshTokenEntity,
    RoleEntity,
    RolePermissionEntity,
    AccountTenantBranchEntity,
  ];
  /** runs the hand-written migrations: they use bare table names, like the CLI */
  let migrator: DataSource;
  /** the service's own connection: schema option only */
  let service: DataSource;
  const mig = <T = unknown>(text: string, params: unknown[] = []) =>
    migrator.query(text, params) as Promise<T>;
  const T1 = randomUUID();
  const T2 = randomUUID();
  const T_DELETED = randomUUID();
  const [OWNER1, MANAGER1, CASHIER1, OWNER2, CASHIER2, OWNER_DEL] = Array.from(
    { length: 6 },
    () => randomUUID(),
  );
  const B1 = randomUUID();
  const B2 = randomUUID();
  const upBefore = async () => {
    const runner = migrator.createQueryRunner();
    for (const migration of [
      new CreateUserTable1720105653064(),
      new CreateSessionTable1721550180313(),
      new CreatePostTable1722352657866(),
      new ReplaceSessionWithRefreshToken1791476400000(),
      new IntroduceTenancy1791563000000(),
      new AddMemberStatusLoginLockoutSessions1792000000000(),
      new CreateBranchSettingAndStaffSchedule1792000000001(),
    ]) {
      await migration.up(runner);
    }
    await runner.release();
  };
  const runRbac = async (direction: 'up' | 'down') => {
    const runner = migrator.createQueryRunner();
    await new CreateRolePermissionAndMemberBranch1792300000000()[direction](
      runner,
    );
    await runner.release();
  };

  beforeAll(async () => {
    const admin = new DataSource({
      type: 'postgres',
      host: connection.host,
      port: connection.port,
      username: 'postgres',
      password: 'postgres',
      database: 'pbl',
    });
    await admin.initialize();
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.destroy();

    migrator = new DataSource({
      ...connection,
      extra: { options: `-c search_path=${schema},public` },
      entities,
    });
    await migrator.initialize();
    await upBefore();

    // legacy data, as it is before RBAC
    const accounts = [OWNER1, MANAGER1, CASHIER1, OWNER2, CASHIER2, OWNER_DEL];
    for (const [i, id] of accounts.entries()) {
      await mig(
        `INSERT INTO "account" ("id","email","password","created_by","updated_by") VALUES ($1,$2,'x','t','t')`,
        [id, `rbac${i}@x.vn`],
      );
    }
    for (const [id, sub, deleted] of [
      [T1, 'rbac1', false],
      [T2, 'rbac2', false],
      [T_DELETED, 'rbac-deleted', true],
    ] as const) {
      await mig(
        `INSERT INTO "tenant" ("id","name","subdomain","created_by","updated_by","deleted_at") VALUES ($1,$2,$2,'t','t',$3)`,
        [id, sub, deleted ? new Date() : null],
      );
    }
    await mig(
      `INSERT INTO "account_tenant" ("account_id","tenant_id","role","code","created_at") VALUES
        ($1,$7,'owner','NV001','2026-01-01'),
        ($2,$7,'manager','NV002','2026-01-02'),
        ($3,$7,'cashier','NV003','2026-01-03'),
        ($4,$8,'owner','NV001','2026-01-04'),
        ($5,$8,'cashier','NV002','2026-01-05'),
        ($6,$9,'owner','NV001','2026-01-06')`,
      [
        OWNER1,
        MANAGER1,
        CASHIER1,
        OWNER2,
        CASHIER2,
        OWNER_DEL,
        T1,
        T2,
        T_DELETED,
      ],
    );
    for (const [id, tenant, code] of [
      [B1, T1, 'CN01'],
      [B2, T1, 'CN02'],
    ]) {
      await mig(
        `INSERT INTO "branch" ("id","tenant_id","name","code","created_by","updated_by") VALUES ($1,$2,$3,$3,'t','t')`,
        [id, tenant, code],
      );
    }
    await runRbac('up');

    service = new DataSource({ ...connection, entities });
    await service.initialize();
  });

  afterAll(async () => {
    await service?.destroy();
    await migrator.query(`DROP SCHEMA "${schema}" CASCADE`);
    await migrator.destroy();
  });

  const roleIdOf = async (tenantId: string, code: string) =>
    (
      await service
        .getRepository(RoleEntity)
        .findOneByOrFail({ tenantId, code })
    ).id;

  describe('migration with legacy data', () => {
    it('seeds the five roles in every store, deleted ones included', async () => {
      const rows = await mig<
        { tenant_id: string; code: string; name: string; is_seeded: boolean }[]
      >(
        `SELECT "tenant_id","code","name","is_seeded" FROM "role" ORDER BY "tenant_id","code"`,
      );

      for (const tenant of [T1, T2, T_DELETED]) {
        const own = rows.filter((r) => r.tenant_id === tenant);
        expect(own.map((r) => r.code).sort()).toEqual([
          'accountant',
          'branch_manager',
          'owner',
          'sales_staff',
          'warehouse_staff',
        ]);
        expect(own.every((r) => r.is_seeded)).toBe(true);
      }
      expect(rows.find((r) => r.code === 'owner')!.name).toBe('Chủ cửa hàng');
      expect(rows).toHaveLength(15);
    });

    it('gives the default permissions (the owner none: it is always every permission)', async () => {
      const count = async (code: string) =>
        Number(
          (
            await mig<{ n: string }[]>(
              `SELECT COUNT(*) AS n FROM "role_permission" rp JOIN "role" r ON r."id" = rp."role_id" WHERE r."tenant_id" = $1 AND r."code" = $2`,
              [T1, code],
            )
          )[0].n,
        );

      expect(await count('owner')).toBe(0);
      expect(await count('branch_manager')).toBe(34);
      expect(await count('sales_staff')).toBe(12);
      expect(await count('warehouse_staff')).toBe(8);
      expect(await count('accountant')).toBe(7);
      const manager = await mig<{ permission_code: string }[]>(
        `SELECT rp."permission_code" FROM "role_permission" rp JOIN "role" r ON r."id" = rp."role_id" WHERE r."tenant_id" = $1 AND r."code" = 'branch_manager'`,
        [T1],
      );
      const codes = manager.map((r) => r.permission_code);
      expect(codes).toContain('staff.view');
      expect(codes).toContain('settings.view');
      expect(codes).not.toContain('staff.update');
      expect(codes).not.toContain('settings.update');
    });

    it('points every member at the role of its own store that replaces the legacy one, and rewrites the text', async () => {
      const rows = await mig<
        {
          account_id: string;
          role: string;
          role_code: string;
          role_tenant: string;
          tenant_id: string;
        }[]
      >(
        `SELECT at."account_id", at."role", r."code" AS role_code, r."tenant_id" AS role_tenant, at."tenant_id"
         FROM "account_tenant" at JOIN "role" r ON r."id" = at."role_id"`,
      );

      const of = (id: string) => rows.find((r) => r.account_id === id)!;
      expect(of(OWNER1)).toMatchObject({ role: 'owner', role_code: 'owner' });
      expect(of(MANAGER1)).toMatchObject({
        role: 'branch_manager',
        role_code: 'branch_manager',
      });
      expect(of(CASHIER1)).toMatchObject({
        role: 'sales_staff',
        role_code: 'sales_staff',
      });
      expect(of(CASHIER2)).toMatchObject({ role: 'sales_staff' });
      expect(of(OWNER_DEL)).toMatchObject({ role: 'owner' });
      expect(rows).toHaveLength(6);
      // tenant isolation: no member points at another store's role
      expect(rows.every((r) => r.role_tenant === r.tenant_id)).toBe(true);
    });

    it('starts every member with no branch rows, meaning every branch', async () => {
      const [{ n }] = await mig<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM "account_tenant_branch"`,
      );
      expect(Number(n)).toBe(0);
    });

    it('enforces its constraints', async () => {
      const roleId = await roleIdOf(T1, 'sales_staff');
      await expect(
        mig(
          `INSERT INTO "role" ("tenant_id","code","name") VALUES ($1,'sales_staff','Other')`,
          [T1],
        ),
      ).rejects.toThrow(/UQ_role_tenant_code/);
      // the same code in another store is fine
      await mig(
        `INSERT INTO "role" ("tenant_id","code","name") VALUES ($1,'shared_code','A')`,
        [T1],
      );
      await mig(
        `INSERT INTO "role" ("tenant_id","code","name") VALUES ($1,'shared_code','A')`,
        [T2],
      );
      await expect(
        mig(
          `INSERT INTO "role_permission" ("role_id","permission_code") VALUES ($1,'orders.view')`,
          [roleId],
        ),
      ).rejects.toThrow(/PK_role_permission/);
      await expect(
        mig(
          `INSERT INTO "role_permission" ("role_id","permission_code") VALUES ($1,'x.y')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/FK_role_permission_role/);
      // a role with members cannot be deleted
      await expect(
        mig(`DELETE FROM "role" WHERE "id" = $1`, [roleId]),
      ).rejects.toThrow(/FK_account_tenant_role/);
      // a branch row needs a member of that store and a branch
      await expect(
        mig(
          `INSERT INTO "account_tenant_branch" ("account_id","tenant_id","branch_id") VALUES ($1,$2,$3)`,
          [OWNER2, T1, B1],
        ),
      ).rejects.toThrow(/FK_account_tenant_branch_member/);
      await expect(
        mig(
          `INSERT INTO "account_tenant_branch" ("account_id","tenant_id","branch_id") VALUES ($1,$2,$3)`,
          [MANAGER1, T1, randomUUID()],
        ),
      ).rejects.toThrow(/FK_account_tenant_branch_branch/);
      await expect(
        mig(
          `UPDATE "account_tenant" SET "role_id" = NULL WHERE "account_id" = $1`,
          [OWNER1],
        ),
      ).rejects.toThrow(/null value/);
    });

    it('deletes a role’s permissions with it, and a member’s branch rows with the member', async () => {
      const [{ id: custom }] = await mig<{ id: string }[]>(
        `INSERT INTO "role" ("tenant_id","code","name") VALUES ($1,'tmp','Tmp') RETURNING "id"`,
        [T1],
      );
      await mig(
        `INSERT INTO "role_permission" VALUES ($1,'pos.view'),($1,'orders.view')`,
        [custom],
      );
      await mig(`DELETE FROM "role" WHERE "id" = $1`, [custom]);
      const [{ n }] = await mig<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM "role_permission" WHERE "role_id" = $1`,
        [custom],
      );
      expect(Number(n)).toBe(0);

      const extra = randomUUID();
      await mig(
        `INSERT INTO "account" ("id","email","password","created_by","updated_by") VALUES ($1,'tmp@x.vn','x','t','t')`,
        [extra],
      );
      await mig(
        `INSERT INTO "account_tenant" ("account_id","tenant_id","role","code","role_id") VALUES ($1,$2,'sales_staff','NV090',$3)`,
        [extra, T1, await roleIdOf(T1, 'sales_staff')],
      );
      await mig(`INSERT INTO "account_tenant_branch" VALUES ($1,$2,$3)`, [
        extra,
        T1,
        B1,
      ]);
      await mig(`DELETE FROM "account_tenant" WHERE "account_id" = $1`, [
        extra,
      ]);
      const [{ m }] = await mig<{ m: string }[]>(
        `SELECT COUNT(*) AS m FROM "account_tenant_branch" WHERE "account_id" = $1`,
        [extra],
      );
      expect(Number(m)).toBe(0);
    });
  });

  describe('claims (MembershipService on the service connection)', () => {
    const membership = () =>
      new MembershipService(
        service.getRepository(AccountTenantEntity),
        service.getRepository(RolePermissionEntity),
        service.getRepository(AccountTenantBranchEntity),
      );

    it('gives the owner the wildcard and every branch', async () => {
      const [m] = await membership().findActiveMemberships(OWNER1);

      expect(m).toMatchObject({
        tenantId: T1,
        role: 'owner',
        permissions: ['*'],
        branches: ['*'],
      });
    });

    it('gives a member the role’s permission codes and every branch while none is assigned', async () => {
      const m = await membership().findActiveMembership(CASHIER1, T1);

      expect(m).toMatchObject({ role: 'sales_staff', branches: ['*'] });
      expect(m!.permissions).toHaveLength(12);
      expect(m!.permissions).toContain('pos.create');
      expect(m!.permissions).not.toContain('staff.view');
    });

    it('lists only the assigned branches once there are rows, and applies a role change at the next read', async () => {
      await service
        .getRepository(AccountTenantBranchEntity)
        .insert({ accountId: CASHIER1, tenantId: T1, branchId: B2 });
      await service.getRepository(AccountTenantEntity).update(
        { accountId: CASHIER1, tenantId: T1 },
        {
          role: 'accountant',
          roleId: await roleIdOf(T1, 'accountant'),
        },
      );

      const m = await membership().findActiveMembership(CASHIER1, T1);

      expect(m).toMatchObject({ role: 'accountant', branches: [B2] });
      expect(m!.permissions).toContain('reports.view');
      expect(m!.permissions).not.toContain('pos.create');
      // restore for the following tests
      await service.getRepository(AccountTenantBranchEntity).delete({
        accountId: CASHIER1,
        tenantId: T1,
      });
      await service
        .getRepository(AccountTenantEntity)
        .update(
          { accountId: CASHIER1, tenantId: T1 },
          { role: 'sales_staff', roleId: await roleIdOf(T1, 'sales_staff') },
        );
    });

    it('does not mix up two stores of the same account', async () => {
      // OWNER1 owns T1 only; give them a second membership as cashier in T2
      await service.getRepository(AccountTenantEntity).insert({
        accountId: OWNER1,
        tenantId: T2,
        role: 'sales_staff',
        roleId: await roleIdOf(T2, 'sales_staff'),
        code: 'NV050',
      });
      await service
        .getRepository(AccountTenantBranchEntity)
        .insert({ accountId: OWNER1, tenantId: T2, branchId: B1 });

      const all = await membership().findActiveMemberships(OWNER1);

      expect(all.find((m) => m.tenantId === T1)).toMatchObject({
        role: 'owner',
        permissions: ['*'],
        branches: ['*'],
      });
      expect(all.find((m) => m.tenantId === T2)).toMatchObject({
        role: 'sales_staff',
        branches: [B1],
      });
      await service
        .getRepository(AccountTenantEntity)
        .delete({ accountId: OWNER1, tenantId: T2 });
    });
  });

  describe('RoleService on the service connection', () => {
    let roles: RoleService;
    beforeAll(() => {
      roles = new RoleService(service);
    });

    it('lists a store’s roles with member and permission counts, and none of another store’s', async () => {
      const list = await roles.list(T1);

      expect(list.map((r) => r.code)).toEqual([
        'owner',
        'branch_manager',
        'sales_staff',
        'warehouse_staff',
        'accountant',
        'shared_code',
      ]);
      const byCode = Object.fromEntries(list.map((r) => [r.code, r]));
      expect(byCode.owner).toMatchObject({
        memberCount: 1,
        isOwner: true,
        permissionCount: ALL_PERMISSIONS.length,
      });
      expect(byCode.branch_manager).toMatchObject({
        memberCount: 1,
        permissionCount: 34,
      });
      expect(byCode.sales_staff).toMatchObject({
        memberCount: 1,
        permissionCount: 12,
      });
      expect(byCode.shared_code).toMatchObject({ key: null, memberCount: 0 });
      const other = await roles.list(T2);
      expect(other.find((r) => r.code === 'shared_code')!.id).not.toBe(
        byCode.shared_code.id,
      );
      expect(other.find((r) => r.code === 'owner')!.id).not.toBe(
        byCode.owner.id,
      );
    });

    it('does not show a role of one store to another (404)', async () => {
      const t1Role = await roleIdOf(T1, 'sales_staff');

      await expect(roles.get(T2, t1Role)).rejects.toThrow(/Not Found/i);
      await expect(
        roles.update(T2, t1Role, { name: 'Hacked' }),
      ).rejects.toThrow();
      await expect(roles.remove(T2, t1Role)).rejects.toThrow();
      expect((await roles.get(T1, t1Role)).name).toBe('Nhân viên bán hàng');
    });

    it('creates, edits and deletes a custom role', async () => {
      const created = await roles.create(T1, {
        name: 'Thu ngân ca tối',
        permissions: ['pos.view', 'orders.view'],
      });
      expect(created).toMatchObject({
        code: 'thu_ngan_ca_toi',
        key: null,
        permissions: ['orders.view', 'pos.view'],
        memberCount: 0,
      });
      // same name again, any case: R001
      await expect(
        roles.create(T1, {
          name: 'THU NGÂN CA TỐI'.toLowerCase(),
          permissions: [],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'role.error.name_exists' },
      });
      // the same name in another store is fine
      await roles.create(T2, { name: 'Thu ngân ca tối', permissions: [] });

      const updated = await roles.update(T1, created.id, {
        name: 'Ca tối',
        permissions: ['pos.view'],
      });
      expect(updated).toMatchObject({
        code: 'thu_ngan_ca_toi', // the code does not follow the name
        name: 'Ca tối',
        permissions: ['pos.view'],
      });

      await roles.remove(T1, created.id);
      await expect(roles.get(T1, created.id)).rejects.toThrow();
      const [{ n }] = await mig<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM "role_permission" WHERE "role_id" = $1`,
        [created.id],
      );
      expect(Number(n)).toBe(0);
    });

    it('edits a seeded role but never the owner role, and deletes neither', async () => {
      const sales = await roleIdOf(T1, 'sales_staff');
      const edited = await roles.update(T1, sales, {
        permissions: ['pos.view'],
      });
      expect(edited.permissions).toEqual(['pos.view']);
      // the change is visible in the claims of the next read
      const m = await new MembershipService(
        service.getRepository(AccountTenantEntity),
        service.getRepository(RolePermissionEntity),
        service.getRepository(AccountTenantBranchEntity),
      ).findActiveMembership(CASHIER1, T1);
      expect(m!.permissions).toEqual(['pos.view']);

      await expect(
        roles.update(T1, await roleIdOf(T1, 'owner'), { name: 'Boss' }),
      ).rejects.toMatchObject({
        response: { errorCode: 'role.error.owner_immutable' },
      });
      for (const code of ['owner', 'sales_staff']) {
        await expect(
          roles.remove(T1, await roleIdOf(T1, code)),
        ).rejects.toMatchObject({
          response: { errorCode: 'role.error.seeded_not_deletable' },
        });
      }
    });

    it('refuses to delete a custom role that has members (409), then allows it once they moved', async () => {
      const custom = await roles.create(T1, { name: 'Tạm', permissions: [] });
      await service
        .getRepository(AccountTenantEntity)
        .update(
          { accountId: CASHIER1, tenantId: T1 },
          { role: custom.code, roleId: custom.id },
        );

      await expect(roles.remove(T1, custom.id)).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'role.error.in_use' },
      });
      expect((await roles.get(T1, custom.id)).memberCount).toBe(1);

      await service
        .getRepository(AccountTenantEntity)
        .update(
          { accountId: CASHIER1, tenantId: T1 },
          { role: 'sales_staff', roleId: await roleIdOf(T1, 'sales_staff') },
        );
      await roles.remove(T1, custom.id);
    });

    it('seeds a new store inside a transaction, atomically with it', async () => {
      const tenantId = randomUUID();
      await service.transaction(async (em) => {
        await em.insert(TenantEntity, {
          id: tenantId as TenantEntity['id'],
          name: 'New',
          subdomain: 'new-store',
          createdBy: 't',
          updatedBy: 't',
        });
        const seeded = await seedRoles(em, tenantId);
        expect([...seeded.keys()]).toHaveLength(5);
      });

      const list = await roles.list(tenantId);
      expect(list.map((r) => r.code)).toEqual([
        'owner',
        'branch_manager',
        'sales_staff',
        'warehouse_staff',
        'accountant',
      ]);
      expect(
        list.find((r) => r.code === 'warehouse_staff')!.permissionCount,
      ).toBe(8);

      // a failure after seeding rolls the roles back with the rest
      const failed = randomUUID();
      await expect(
        service.transaction(async (em) => {
          await em.insert(TenantEntity, {
            id: failed as TenantEntity['id'],
            name: 'Failed',
            subdomain: 'failed-store',
            createdBy: 't',
            updatedBy: 't',
          });
          await seedRoles(em, failed);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await roles.list(failed)).toEqual([]);
    });
  });

  describe('roles over HTTP (real guard, module wiring and database)', () => {
    const auth = createTestAuth();
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({ ...connection, entities }),
          PblAuthModule.forRootAsync({
            useFactory: () => ({ ...auth.options, tenant: 'optional' }),
          }),
          RoleModule,
        ],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          errorHttpStatusCode: 422,
        }),
      );
      await app.init();
    });
    afterAll(() => app.close());

    const staff = (tid: string, permissions = ['staff.view']) =>
      auth.bearerWithPermissions('custom', permissions, tid);
    const manager = (tid: string) =>
      auth.bearerWithPermissions('custom', ['staff.view', 'staff.update'], tid);

    it('serves the catalog and the role list of the token’s store only', async () => {
      const catalog = await request(app.getHttpServer())
        .get('/api/v1/permissions')
        .set('Authorization', staff(T1))
        .expect(200);
      expect(catalog.body.defaults).toHaveLength(5);

      const list = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', staff(T1))
        .expect(200);
      const ids = list.body.data.map((r: { id: string }) => r.id);
      const t2 = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', staff(T2))
        .expect(200);
      for (const r of t2.body.data) expect(ids).not.toContain(r.id);
      expect(list.body.data[0]).toMatchObject({ key: 'owner', isOwner: true });
    });

    it('refuses a caller without the permission, and without a store', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', staff(T1, ['orders.view']))
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', staff(T1)) // staff.view cannot write
        .send({ name: 'X', permissions: [] })
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(
          'Authorization',
          auth.bearerWithPermissions('custom', ['staff.view']),
        )
        .expect(403);
    });

    it('creates, reads, edits and deletes a role; 404 across stores, 409 with members', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', manager(T1))
        .send({ name: 'Giữ kho', permissions: ['inventory.view', 'nope.view'] })
        .expect(400); // unknown permission
      expect(created.body.errorCode).toBe('role.error.unknown_permission');

      const ok = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', manager(T1))
        .send({ name: 'Giữ kho', permissions: ['inventory.view'] })
        .expect(201);
      const id = ok.body.id;
      expect(ok.body).toMatchObject({
        code: 'giu_kho',
        permissions: ['inventory.view'],
      });

      await request(app.getHttpServer())
        .get(`/api/v1/roles/${id}`)
        .set('Authorization', staff(T2))
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${id}`)
        .set('Authorization', manager(T2))
        .send({ name: 'Hacked' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${id}`)
        .set('Authorization', manager(T1))
        .send({ permissions: ['inventory.view', 'inventory.update'] })
        .expect(200);

      await service
        .getRepository(AccountTenantEntity)
        .update(
          { accountId: CASHIER1, tenantId: T1 },
          { role: 'giu_kho', roleId: id },
        );
      const inUse = await request(app.getHttpServer())
        .delete(`/api/v1/roles/${id}`)
        .set('Authorization', manager(T1))
        .expect(409);
      expect(inUse.body.errorCode).toBe('role.error.in_use');
      await service
        .getRepository(AccountTenantEntity)
        .update(
          { accountId: CASHIER1, tenantId: T1 },
          { role: 'sales_staff', roleId: await roleIdOf(T1, 'sales_staff') },
        );
      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${id}`)
        .set('Authorization', manager(T1))
        .expect(204);
    });
  });

  describe('migration down', () => {
    it('restores the legacy role text, drops the tables and can run up again', async () => {
      // one member per kind of role
      await service.getRepository(AccountTenantEntity).update(
        { accountId: CASHIER1, tenantId: T1 },
        {
          role: 'warehouse_staff',
          roleId: await roleIdOf(T1, 'warehouse_staff'),
        },
      );

      await runRbac('down');

      const rows = await mig<{ account_id: string; role: string }[]>(
        `SELECT "account_id","role" FROM "account_tenant"`,
      );
      const of = (id: string) => rows.find((r) => r.account_id === id)!.role;
      expect(of(OWNER1)).toBe('owner');
      expect(of(MANAGER1)).toBe('manager');
      expect(of(CASHIER1)).toBe('cashier'); // no legacy equivalent: the least privileged
      expect(of(CASHIER2)).toBe('cashier');
      const tables = await mig<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [schema],
      );
      for (const gone of ['role', 'role_permission', 'account_tenant_branch']) {
        expect(tables.map((t) => t.table_name)).not.toContain(gone);
      }
      await expect(
        mig(`SELECT "role_id" FROM "account_tenant"`),
      ).rejects.toThrow();

      await runRbac('up');
      const [{ n }] = await mig<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM "role"`,
      );
      // the five roles of the four stores (the one the seeding test created too)
      expect(Number(n)).toBe(20);
      const back = await mig<{ role: string }[]>(
        `SELECT "role" FROM "account_tenant" WHERE "account_id" = $1`,
        [MANAGER1],
      );
      expect(back[0].role).toBe('branch_manager');
    });
  });
});
