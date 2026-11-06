import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessTokenModule } from '../auth/access-token.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminUsageController } from './admin-usage.controller';
import { AdminUsageService } from './admin-usage.service';
import { PlatformAdminEntity } from './entities/platform-admin.entity';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

/** The platform admin: identity (ADR-0022) and the management of stores, plans, subscriptions and usage. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAdminEntity]),
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
  ],
  providers: [
    PlatformAdminAuthService,
    AdminTenantsService,
    AdminPlansService,
    AdminSubscriptionsService,
    AdminUsageService,
  ],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
