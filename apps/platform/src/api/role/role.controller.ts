import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, RequirePermission } from '@pbl/auth';
import { CreateRoleReqDto } from './dto/create-role.req.dto';
import { RoleDetailResDto, RoleResDto } from './dto/role.res.dto';
import { UpdateRoleReqDto } from './dto/update-role.req.dto';
import { RoleService } from './role.service';

/** `staff.view` reads the roles; `staff.update` creates, edits and deletes them. */
@ApiTags('roles')
@Controller({ path: 'roles', version: '1' })
export class RoleController {
  constructor(private readonly roles: RoleService) {}

  @ApiAuth({ type: RoleResDto, summary: 'Roles of the store (staff.view)' })
  @RequirePermission('staff.view')
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
  ): Promise<{ data: RoleResDto[] }> {
    return { data: await this.roles.list(tenantId) };
  }

  @ApiAuth({
    type: RoleDetailResDto,
    summary: 'A role with its permissions (staff.view)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('staff.view')
  @Get(':id')
  get(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleDetailResDto> {
    return this.roles.get(tenantId, id);
  }

  @ApiAuth({
    type: RoleDetailResDto,
    summary: 'Create a custom role (staff.update)',
    statusCode: HttpStatus.CREATED,
  })
  @RequirePermission('staff.update')
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateRoleReqDto,
  ): Promise<RoleDetailResDto> {
    return this.roles.create(tenantId, dto);
  }

  @ApiAuth({
    type: RoleDetailResDto,
    summary:
      'Rename a role or replace its permissions; not the owner role (staff.update)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('staff.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleReqDto,
  ): Promise<RoleDetailResDto> {
    return this.roles.update(tenantId, id, dto);
  }

  @ApiAuth({
    summary:
      'Delete a custom role without members; 409 while it has members (staff.update)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('staff.update')
  @Delete(':id')
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.roles.remove(tenantId, id);
  }
}
