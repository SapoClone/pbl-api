import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountTenantEntity } from './entities/account-tenant.entity';
import { MembershipService } from './membership.service';

/** Shared by AuthModule and TenantModule; avoids a module cycle. */
@Module({
  imports: [TypeOrmModule.forFeature([AccountTenantEntity])],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
