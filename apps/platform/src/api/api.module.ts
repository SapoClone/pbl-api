import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { BranchModule } from './branch/branch.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';
import { TenantModule } from './tenant/tenant.module';

@Module({
  imports: [
    AccountModule,
    HealthModule,
    AuthModule,
    HomeModule,
    TenantModule,
    BranchModule,
  ],
})
export class ApiModule {}
