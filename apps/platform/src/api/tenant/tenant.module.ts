import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TenantEntity } from './entities/tenant.entity';
import { MembershipModule } from './membership.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity]),
    MembershipModule,
    AuthModule,
  ],
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
