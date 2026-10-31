import { ApiAuth } from '@/decorators/http.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthUser,
  canAccessBranch,
  CurrentTenant,
  CurrentUser,
  RequirePermission,
} from '@pbl/auth';
import { CreateStaffScheduleReqDto } from './dto/create-staff-schedule.req.dto';
import { ListStaffScheduleReqDto } from './dto/list-staff-schedule.req.dto';
import { StaffScheduleResDto } from './dto/staff-schedule.res.dto';
import { UpdateStaffScheduleReqDto } from './dto/update-staff-schedule.req.dto';
import { StaffScheduleService } from './staff-schedule.service';

/**
 * Permissions (ADR-0012): `staff.view` (GET) and `staff.update` (writes). A shift
 * in a branch outside the caller's scope is a 404, and the list shows only the
 * allowed branches. The unused `@CurrentTenant()` is what answers 403 for a
 * token without a store (see BranchController).
 */
@ApiTags('staff-schedules')
@Controller({ path: 'staff-schedules', version: '1' })
export class StaffScheduleController {
  constructor(private readonly service: StaffScheduleService) {}

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Weekly shifts of the store (staff.view)',
  })
  @RequirePermission('staff.view')
  @Get()
  async list(
    @CurrentTenant() _tenantId: string,
    @Query() query: ListStaffScheduleReqDto,
    @AllowedBranches() allowed: string[] | null,
  ): Promise<{ data: StaffScheduleResDto[] }> {
    return { data: await this.service.list(query, allowed) };
  }

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Create a shift, one row per weekday (staff.update)',
    statusCode: HttpStatus.CREATED,
  })
  @RequirePermission('staff.update')
  @Post()
  async create(
    @CurrentTenant() _tenantId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStaffScheduleReqDto,
  ): Promise<{ data: StaffScheduleResDto[] }> {
    if (!canAccessBranch(user, dto.branchId)) {
      throw new NotFoundException();
    }
    return { data: await this.service.create(user.id, dto) };
  }

  @ApiAuth({
    type: StaffScheduleResDto,
    summary: 'Change the times of a shift (staff.update)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('staff.update')
  @Patch(':id')
  update(
    @CurrentTenant() _tenantId: string,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffScheduleReqDto,
    @AllowedBranches() allowed: string[] | null,
  ): Promise<StaffScheduleResDto> {
    return this.service.update(user.id, id, dto, allowed);
  }

  @ApiAuth({
    summary: 'Delete a shift (staff.update)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('staff.update')
  @Delete(':id')
  remove(
    @CurrentTenant() _tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() allowed: string[] | null,
  ): Promise<void> {
    return this.service.remove(id, allowed);
  }
}
