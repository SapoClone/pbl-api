import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
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
import { BranchSettingService } from './branch-setting.service';
import { BranchService } from './branch.service';
import { BranchSettingResDto } from './dto/branch-setting.res.dto';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchSettingReqDto } from './dto/update-branch-setting.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';

/**
 * Every route takes an unused `@CurrentTenant() _tenantId`: platform runs
 * PblAuthModule in tenant 'optional' mode, and this decorator is what answers
 * 403 "A store must be selected" for a token without `tid`. The service reads
 * the tenant from TenantContext (the scoped repository), which would
 * otherwise fail with a 500. Pinned by branch.controller.spec.ts.
 */
@ApiTags('branches')
@Controller({ path: 'branches', version: '1' })
export class BranchController {
  constructor(
    private readonly branchService: BranchService,
    private readonly settingService: BranchSettingService,
  ) {}

  @ApiAuth({
    type: BranchResDto,
    summary: 'List branches of the selected store',
    isPaginated: true,
  })
  @Get()
  list(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @Query() query: ListBranchReqDto,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    return this.branchService.list(query);
  }

  @ApiAuth({
    type: BranchResDto,
    summary: 'Create a branch (owner)',
    statusCode: HttpStatus.CREATED,
  })
  @RequireRoles(TenantRole.OWNER)
  @Post()
  create(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser('id') accountId: string,
    @Body() dto: CreateBranchReqDto,
  ): Promise<BranchResDto> {
    return this.branchService.create(accountId, dto);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Get a branch' })
  @ApiParam({ name: 'id', type: 'String' })
  @Get(':id')
  get(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchResDto> {
    return this.branchService.get(id);
  }

  @ApiAuth({ type: BranchResDto, summary: 'Update a branch (owner)' })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Patch(':id')
  update(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    return this.branchService.update(accountId, id, dto);
  }

  @ApiAuth({
    summary: 'Delete a branch (owner)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Delete(':id')
  remove(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.branchService.remove(id);
  }

  /**
   * The contract says owner or the manager of that branch; with no branch
   * assignment yet, every manager qualifies.
   */
  @ApiAuth({
    type: BranchSettingResDto,
    summary: 'Invoice and payment settings of a branch (owner, manager)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Get(':id/settings')
  getSettings(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchSettingResDto> {
    return this.settingService.get(accountId, id);
  }

  @ApiAuth({
    type: BranchSettingResDto,
    summary: 'Change the settings of a branch (owner, manager)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Patch(':id/settings')
  updateSettings(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser('id') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchSettingReqDto,
  ): Promise<BranchSettingResDto> {
    return this.settingService.update(accountId, id, dto);
  }
}
