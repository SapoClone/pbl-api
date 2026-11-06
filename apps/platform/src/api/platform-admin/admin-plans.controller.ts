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
  AdminPlan,
  AdminPlanSaved,
  AdminPlansService,
} from './admin-plans.service';
import {
  CreateAdminPlanReqDto,
  ListAdminPlansReqDto,
  UpdateAdminPlanReqDto,
} from './dto/admin-plan.req.dto';

/** Plans, for the platform admin (contract 04, screens 09 and 10). Reading is open to every admin, writing is not. */
@ApiTags('admin-plans')
@RequirePlatformAdmin()
@Controller({ path: 'admin/plans', version: '1' })
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @ApiAuth({ summary: 'Plans with their limits and how many stores use each' })
  @Get()
  list(@Query() query: ListAdminPlansReqDto): Promise<{ data: AdminPlan[] }> {
    return this.plans.list(query);
  }

  @ApiAuth({ summary: 'One plan' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminPlan> {
    return this.plans.get(id);
  }

  @RequirePlatformAdmin('super_admin')
  @ApiAuth({
    summary: 'Create a plan (super admin)',
    statusCode: HttpStatus.CREATED,
  })
  @Post()
  create(
    @CurrentUser('id') adminId: string,
    @Body() dto: CreateAdminPlanReqDto,
  ): Promise<AdminPlan> {
    return this.plans.create(adminId, dto);
  }

  @RequirePlatformAdmin('super_admin')
  @ApiAuth({
    summary:
      'Edit a plan (super admin); says how many stores the new limits put over quota',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @Patch(':id')
  update(
    @CurrentUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminPlanReqDto,
  ): Promise<AdminPlanSaved> {
    return this.plans.update(adminId, id, dto);
  }
}
