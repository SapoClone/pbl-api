import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessTokenModule } from '../auth/access-token.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TenantModule } from '../tenant/tenant.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { PlatformAdminEntity } from './entities/platform-admin.entity';
import { PlatformAdminAuthService } from './platform-admin-auth.service';

/** The platform admin identity (ADR-0022). */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAdminEntity]),
    AccessTokenModule,
    AuthModule, // RefreshTokenService, SessionService
    SubscriptionModule,
    TenantModule, // TenantService.openStore
  ],
  controllers: [AdminAuthController, AdminTenantsController],
  providers: [PlatformAdminAuthService, AdminTenantsService],
  exports: [PlatformAdminAuthService],
})
export class PlatformAdminModule {}
