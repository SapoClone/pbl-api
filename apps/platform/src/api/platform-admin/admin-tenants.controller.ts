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
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminTenantListQueryDto } from './dto/admin-tenant-list.query.dto';
import {
  AdminCreateTenantReqDto,
  AdminUpdateTenantReqDto,
  ReactivateTenantReqDto,
  SuspendTenantReqDto,
} from './dto/admin-tenant.req.dto';
import {
  AdminTenantDetailResDto,
  AdminTenantListResDto,
} from './dto/admin-tenant.res.dto';

/** Store management for platform admins (ADR-0022): every store, not only one. */
@ApiTags('admin-tenants')
@RequirePlatformAdmin()
@Controller({ path: 'admin/tenants', version: '1' })
export class AdminTenantsController {
  constructor(private readonly service: AdminTenantsService) {}

  @ApiAuth({ type: AdminTenantListResDto, summary: 'All stores' })
  @Get()
  list(
    @Query() query: AdminTenantListQueryDto,
  ): Promise<AdminTenantListResDto> {
    return this.service.list(query);
  }

  @ApiAuth({
    type: AdminTenantDetailResDto,
    summary: 'One store',
    errorResponses: [401, 403, 404],
  })
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminTenantDetailResDto> {
    return this.service.get(id);
  }

  @ApiAuth({
    type: AdminTenantDetailResDto,
    summary: 'Open a store for an owner who already has an account',
    statusCode: HttpStatus.CREATED,
    errorResponses: [400, 401, 403, 422],
  })
  @Post()
  create(
    @CurrentUser() admin: AuthUser,
    @Body() dto: AdminCreateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    return this.service.create(admin.id, dto);
  }

  @ApiAuth({
    type: AdminTenantDetailResDto,
    summary: 'Edit a store (name, subdomain, contact details)',
    errorResponses: [400, 401, 403, 404, 422],
  })
  @Patch(':id')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    return this.service.update(admin.id, id, dto);
  }

  @ApiAuth({
    type: AdminTenantDetailResDto,
    summary: 'Suspend a store: its members are signed out and cannot sign in',
    errorResponses: [400, 401, 403, 404, 422],
  })
  @Post(':id/suspend')
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    return this.service.suspend(admin.id, id, dto);
  }

  @ApiAuth({
    type: AdminTenantDetailResDto,
    summary: 'Reactivate a suspended store',
    errorResponses: [400, 401, 403, 404, 422],
  })
  @Post(':id/reactivate')
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivateTenantReqDto,
  ): Promise<AdminTenantDetailResDto> {
    return this.service.reactivate(admin.id, id, dto);
  }
}
