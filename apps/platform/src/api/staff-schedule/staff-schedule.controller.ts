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
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { TenantRole } from '../tenant/entities/account-tenant.entity';
import { CreateStaffScheduleReqDto } from './dto/create-staff-schedule.req.dto';
import { ListStaffScheduleReqDto } from './dto/list-staff-schedule.req.dto';
import { StaffScheduleResDto } from './dto/staff-schedule.res.dto';
import { UpdateStaffScheduleReqDto } from './dto/update-staff-schedule.req.dto';
import { StaffScheduleService } from './staff-schedule.service';

/**
 * Contract permissions: `staff.view` (GET) and `staff.update` (writes). With no
 * RBAC yet both map to owner and manager. The unused `@CurrentTenant()` is what
 * answers 403 for a token without a store (see BranchController).
 */
@ApiTags('staff-schedules')
@Controller({ path: 'staff-schedules', version: '1' })
export class StaffScheduleController {
  constructor(private readonly service: StaffScheduleService) {}

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Weekly shifts of the store (owner, manager)',
  })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Get()
  async list(
    @CurrentTenant() _tenantId: string,
    @Query() query: ListStaffScheduleReqDto,
  ): Promise<{ data: StaffScheduleResDto[] }> {
    return { data: await this.service.list(query) };
  }

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Create a shift, one row per weekday (owner, manager)',
    statusCode: HttpStatus.CREATED,
  })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Post()
  async create(
    @CurrentTenant() _tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CreateStaffScheduleReqDto,
  ): Promise<{ data: StaffScheduleResDto[] }> {
    return { data: await this.service.create(actorId, dto) };
  }

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Change the times of a shift (owner, manager)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Patch(':id')
  update(
    @CurrentTenant() _tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffScheduleReqDto,
  ): Promise<StaffScheduleResDto> {
    return this.service.update(actorId, id, dto);
  }

  @ApiAuth({
    summary: 'Delete a shift (owner, manager)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Delete(':id')
  remove(
    @CurrentTenant() _tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(id);
  }
}
