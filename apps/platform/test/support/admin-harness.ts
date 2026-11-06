/**
 * Shared set-up of the platform admin integration specs: a throwaway schema with every platform migration before the
 * plan and subscription one, and the admin services wired by hand over real SQL (outbox and sessions are recorders).
 */
import { DataSource } from 'typeorm';
import { IT_DB, uniqueSchema } from '../../../../libs/events/test/it-env';
import { AccountEntity } from '../../src/api/account/entities/account.entity';
import { RefreshTokenEntity } from '../../src/api/auth/entities/refresh-token.entity';
import { BranchSettingEntity } from '../../src/api/branch/entities/branch-setting.entity';
import { BranchEntity } from '../../src/api/branch/entities/branch.entity';
import { AdminAccountsService } from '../../src/api/platform-admin/admin-accounts.service';
import { AdminAdminsService } from '../../src/api/platform-admin/admin-admins.service';
import { AdminPlansService } from '../../src/api/platform-admin/admin-plans.service';
import { AdminSettingsService } from '../../src/api/platform-admin/admin-settings.service';
import { AdminSubscriptionsService } from '../../src/api/platform-admin/admin-subscriptions.service';
import { AdminTenantsService } from '../../src/api/platform-admin/admin-tenants.service';
import { AdminUsageService } from '../../src/api/platform-admin/admin-usage.service';
import { PlatformAdminEntity } from '../../src/api/platform-admin/entities/platform-admin.entity';
import { PlatformSettingEntity } from '../../src/api/platform-setting/entities/platform-setting.entity';
import { RolePermissionEntity } from '../../src/api/role/entities/role-permission.entity';
import { RoleEntity } from '../../src/api/role/entities/role.entity';
import { StaffScheduleEntity } from '../../src/api/staff-schedule/entities/staff-schedule.entity';
import { PlanEntity } from '../../src/api/subscription/entities/plan.entity';
import { SubscriptionEventEntity } from '../../src/api/subscription/entities/subscription-event.entity';
import { SubscriptionPaymentEntity } from '../../src/api/subscription/entities/subscription-payment.entity';
import { SubscriptionEntity } from '../../src/api/subscription/entities/subscription.entity';
import { TenantUsageEntity } from '../../src/api/subscription/entities/tenant-usage.entity';
import { QuotaService } from '../../src/api/subscription/quota.service';
import { SubscriptionCoreService } from '../../src/api/subscription/subscription-core.service';
import { UsageHandler } from '../../src/api/subscription/usage.handler';
import { AccountTenantBranchEntity } from '../../src/api/tenant/entities/account-tenant-branch.entity';
import { AccountTenantEntity } from '../../src/api/tenant/entities/account-tenant.entity';
import { TenantEntity } from '../../src/api/tenant/entities/tenant.entity';
import { MembershipService } from '../../src/api/tenant/membership.service';
import { TenantService } from '../../src/api/tenant/tenant.service';
import { CreateUserTable1720105653064 } from '../../src/database/migrations/1721488504685-create-user-table';
import { CreateSessionTable1721550180313 } from '../../src/database/migrations/1721550180313-create-session-table';
import { CreatePostTable1722352657866 } from '../../src/database/migrations/1722352657866-create-post-table';
import { ReplaceSessionWithRefreshToken1791476400000 } from '../../src/database/migrations/1791476400000-replace-session-with-refresh-token';
import { IntroduceTenancy1791563000000 } from '../../src/database/migrations/1791563000000-introduce-tenancy';
import { AddMemberStatusLoginLockoutSessions1792000000000 } from '../../src/database/migrations/1792000000000-add-member-status-login-lockout-sessions';
import { CreateBranchSettingAndStaffSchedule1792000000001 } from '../../src/database/migrations/1792000000001-create-branch-setting-and-staff-schedule';
import { CreateRolePermissionAndMemberBranch1792300000000 } from '../../src/database/migrations/1792300000000-create-role-permission-and-member-branch';
import { AddFinancePermissions1792400000000 } from '../../src/database/migrations/1792400000000-add-finance-permissions';
import { CreatePlatformAdmin1792600000000 } from '../../src/database/migrations/1792600000000-create-platform-admin';
import { CreatePlanSubscriptionAndTenantAdminFields1792700000000 } from '../../src/database/migrations/1792700000000-create-plan-subscription-and-tenant-admin-fields';
import { AddAccountCodeAndPlatformSetting1792900000000 } from '../../src/database/migrations/1792900000000-add-account-code-and-platform-setting';

export type OutboxCall = [
  unknown,
  { type: string },
  Record<string, any>,
  { tenantId?: string }?,
];

export async function startAdminDb(prefix: string) {
  const schema = uniqueSchema(prefix);
  const root = new DataSource({
    type: 'postgres',
    host: IT_DB.host,
    port: Number(IT_DB.port),
    username: 'postgres',
    password: 'postgres',
    database: 'pbl',
  });
  await root.initialize();
  await root.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await root.query(`CREATE SCHEMA "${schema}"`);
  await root.destroy();

  const dataSource = new DataSource({
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
      PlatformAdminEntity,
      PlatformSettingEntity,
      PlanEntity,
      SubscriptionEntity,
      SubscriptionEventEntity,
      SubscriptionPaymentEntity,
      TenantUsageEntity,
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
    new AddMemberStatusLoginLockoutSessions1792000000000(),
    new CreateBranchSettingAndStaffSchedule1792000000001(),
    new CreateRolePermissionAndMemberBranch1792300000000(),
    new AddFinancePermissions1792400000000(),
    new CreatePlatformAdmin1792600000000(),
  ]) {
    await migration.up(runner);
  }
  await runner.release();

  const outbox = { add: jest.fn(async () => undefined) };
  const sessions = {
    revokeAllOfTenant: jest.fn(async () => 2),
    revokeAll: jest.fn(async () => 2),
    revokeAllOfAdmin: jest.fn(async () => 1),
  };
  const subscriptions = new SubscriptionCoreService(
    dataSource.getRepository(PlanEntity),
    outbox as never,
  );
  const tenantService = new TenantService(
    dataSource.getRepository(TenantEntity),
    dataSource,
    {} as MembershipService,
    outbox as never,
    subscriptions,
  );
  return {
    schema,
    dataSource,
    outbox,
    sessions,
    sql: <T = unknown>(text: string, params: unknown[] = []) =>
      dataSource.query(text, params) as Promise<T>,
    /** The migrations under test (plans and subscriptions, then account code and settings): run after seeding the data they must backfill */
    async applyPlanMigration() {
      const r = dataSource.createQueryRunner();
      await new CreatePlanSubscriptionAndTenantAdminFields1792700000000().up(r);
      // the account code and platform_setting come right after it, so the entities find their columns
      await new AddAccountCodeAndPlatformSetting1792900000000().up(r);
      await r.release();
    },
    services: {
      tenants: new AdminTenantsService(
        dataSource,
        tenantService,
        sessions as never,
        outbox as never,
      ),
      plans: new AdminPlansService(dataSource, outbox as never),
      subscriptions: new AdminSubscriptionsService(dataSource, outbox as never),
      usage: new AdminUsageService(dataSource),
      quota: new QuotaService(),
      accounts: new AdminAccountsService(dataSource, sessions as never),
      admins: new AdminAdminsService(dataSource, sessions as never),
      settings: new AdminSettingsService(dataSource),
      usageHandler: new UsageHandler(),
    },
    outboxCalls: () => outbox.add.mock.calls as unknown as OutboxCall[],
    async stop() {
      await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
      await dataSource.destroy();
    },
  };
}
