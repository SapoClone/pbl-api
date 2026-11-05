import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessTokenModule } from '../auth/access-token.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingEntity } from '../platform-setting/entities/platform-setting.entity';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAdminsController } from './admin-admins.controller';
import { AdminAdminsService } from './admin-admins.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminUsageController } from './admin-usage.controller';
import { AdminUsageService } from './admin-usage.service';
import { PlatformAdminEntity } from './entities/platform-admin.entity';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

/** The platform admin: identity (ADR-0022) and the management of stores, plans, subscriptions, usage, accounts, admins and settings. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAdminEntity, PlatformSettingEntity]),
    AccessTokenModule,
    AuthModule, // RefreshTokenService, SessionService
    SubscriptionModule,
    TenantModule, // TenantService.openStore
  ],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminPlansController,
    AdminSubscriptionsController,
    AdminUsageController,
    AdminAccountsController,
    AdminAdminsController,
    AdminSettingsController,
  ],
  providers: [
    PlatformAdminAuthService,
    AdminTenantsService,
    AdminPlansService,
    AdminSubscriptionsService,
    AdminUsageService,
    AdminAccountsService,
    AdminAdminsService,
    AdminSettingsService,
  ],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
