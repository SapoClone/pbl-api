import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';

@Module({
  imports: [AccountModule, HealthModule, AuthModule, HomeModule],
})
export class ApiModule {}
