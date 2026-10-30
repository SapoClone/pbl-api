import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { M4_CUSTOMER_ENTITIES } from '../infrastructure/persistence/customer.entities';
import { AddressesController } from './addresses/addresses.controller';
import { AddressesService } from './addresses/addresses.service';
import { DataManagementController } from './data-management/data-management.controller';
import { DataManagementService } from './data-management/data-management.service';
import { GroupsController } from './groups/groups.controller';
import { GroupsService } from './groups/groups.service';
import { LoyaltyController } from './loyalty/loyalty.controller';
import { LoyaltyService } from './loyalty/loyalty.service';
import { MembershipsController } from './memberships/memberships.controller';
import { MembershipsService } from './memberships/memberships.service';
import { ProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature(M4_CUSTOMER_ENTITIES)],
  controllers: [
    GroupsController,
    MembershipsController,
    LoyaltyController,
    DataManagementController,
    AddressesController,
    ProfilesController,
  ],
  providers: [
    GroupsService,
    MembershipsService,
    AddressesService,
    LoyaltyService,
    DataManagementService,
    ProfilesService,
  ],
  exports: [
    GroupsService,
    MembershipsService,
    AddressesService,
    LoyaltyService,
    DataManagementService,
    ProfilesService,
  ],
})
export class CustomerCoreModule {}
