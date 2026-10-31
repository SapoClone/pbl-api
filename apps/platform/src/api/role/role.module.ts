import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

@Module({
  controllers: [RoleController, PermissionController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
