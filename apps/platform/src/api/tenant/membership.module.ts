import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePermissionEntity } from '../role/entities/role-permission.entity';
import { AccountTenantBranchEntity } from './entities/account-tenant-branch.entity';
import { AccountTenantEntity } from './entities/account-tenant.entity';
import { MembershipService } from './membership.service';

/** Shared by AuthModule and TenantModule; avoids a module cycle. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountTenantEntity,
      RolePermissionEntity,
      AccountTenantBranchEntity,
    ]),
  ],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
