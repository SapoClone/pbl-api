/**
 * Platform migrations and the member-code SQL against a real Postgres, in a
 * throwaway schema. Run with
 * `pnpm exec jest --config apps/platform/test/jest-int.json --maxWorkers=1`
 * (EVENTS_IT_DB_PORT points at the test database, default 25432).
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { IT_DB, uniqueSchema } from '../../../libs/events/test/it-env';
import { AccountEntity } from '../src/api/account/entities/account.entity';
import { RefreshTokenEntity } from '../src/api/auth/entities/refresh-token.entity';
import { BranchSettingEntity } from '../src/api/branch/entities/branch-setting.entity';
import { BranchEntity } from '../src/api/branch/entities/branch.entity';
import { StaffScheduleEntity } from '../src/api/staff-schedule/entities/staff-schedule.entity';
import { AccountTenantEntity } from '../src/api/tenant/entities/account-tenant.entity';
import { TenantEntity } from '../src/api/tenant/entities/tenant.entity';
import { nextMemberCode } from '../src/api/tenant/member-code';
import { CreateUserTable1720105653064 } from '../src/database/migrations/1721488504685-create-user-table';
import { CreateSessionTable1721550180313 } from '../src/database/migrations/1721550180313-create-session-table';
import { CreatePostTable1722352657866 } from '../src/database/migrations/1722352657866-create-post-table';
import { ReplaceSessionWithRefreshToken1791476400000 } from '../src/database/migrations/1791476400000-replace-session-with-refresh-token';
import { IntroduceTenancy1791563000000 } from '../src/database/migrations/1791563000000-introduce-tenancy';
import { AddMemberStatusLoginLockoutSessions1792000000000 } from '../src/database/migrations/1792000000000-add-member-status-login-lockout-sessions';
import { CreateBranchSettingAndStaffSchedule1792000000001 } from '../src/database/migrations/1792000000001-create-branch-setting-and-staff-schedule';

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
          await em.insert(AccountTenantEntity, {
            accountId: account,
            tenantId: T1,
            role: 'cashier' as never,
            code,
          });
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
