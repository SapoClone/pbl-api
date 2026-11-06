import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import {
  AdminTenantDetail,
  AdminTenantList,
  AdminTenantsService,
} from './admin-tenants.service';
import {
  CreateAdminTenantReqDto,
  ListAdminTenantsReqDto,
  ReactivateAdminTenantReqDto,
  SuspendAdminTenantReqDto,
  UpdateAdminTenantReqDto,
} from './dto/admin-tenant.req.dto';

/** Stores, for the platform admin (contract 04, screens 02 to 06). Every route needs an admin token. */
@ApiTags('admin-tenants')
@RequirePlatformAdmin()
@Controller({ path: 'admin/tenants', version: '1' })
export class AdminTenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @ApiAuth({ summary: 'Stores, with the status counts of the tab labels' })
  @Get()
  list(@Query() query: ListAdminTenantsReqDto): Promise<AdminTenantList> {
    return this.tenants.list(query);
  }

  @ApiAuth({ summary: 'One store with its owner and current subscription' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTenantDetail> {
    return this.tenants.get(id);
  }

  @ApiAuth({
    summary: 'Create a store for an owner who is not the admin',
    statusCode: HttpStatus.CREATED,
  })
  @Post()
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.create(adminId, dto);
  }

  @ApiAuth({ summary: 'Edit a store (name, subdomain, contact details)' })
  @ApiParam({ name: 'id', type: 'String' })
  @Patch(':id')
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.update(adminId, id, dto);
  }

  @ApiAuth({
    summary: 'Lock a store and end its sessions; its data is kept',
    statusCode: HttpStatus.OK,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Post(':id/suspend')
  suspend(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.suspend(adminId, id, dto);
  }

  @ApiAuth({
    summary: 'Reactivate a locked store',
    statusCode: HttpStatus.OK,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Post(':id/reactivate')
  reactivate(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivateAdminTenantReqDto,
  ): Promise<AdminTenantDetail> {
    return this.tenants.reactivate(adminId, id, dto);
  }
}
