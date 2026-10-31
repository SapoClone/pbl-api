import { OffsetPaginatedDto } from '@/common/dto/offset-pagination/paginated.dto';
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
import { BranchSettingService } from './branch-setting.service';
import { BranchService } from './branch.service';
import { BranchSettingResDto } from './dto/branch-setting.res.dto';
import { BranchResDto } from './dto/branch.res.dto';
import { CreateBranchReqDto } from './dto/create-branch.req.dto';
import { ListBranchReqDto } from './dto/list-branch.req.dto';
import { UpdateBranchSettingReqDto } from './dto/update-branch-setting.req.dto';
import { UpdateBranchReqDto } from './dto/update-branch.req.dto';

/**
 * Permissions (ADR-0012): creating, changing and deleting a branch and
 * changing its settings need `settings.update`, reading the settings
 * `settings.view`; listing and reading branches is open to every member. A
 * branch outside the caller's scope is a 404 (never 403), and the list shows
 * only the allowed branches.
 *
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
    @AllowedBranches() allowed: string[] | null,
  ): Promise<OffsetPaginatedDto<BranchResDto>> {
    return this.branchService.list(query, allowed);
  }

  @ApiAuth({
    type: BranchResDto,
    summary: 'Create a branch (settings.update)',
    statusCode: HttpStatus.CREATED,
  })
  @RequirePermission('settings.update')
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
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchResDto> {
    this.assertInScope(user, id);
    return this.branchService.get(id);
  }

  @ApiAuth({
    type: BranchResDto,
    summary: 'Update a branch (settings.update)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('settings.update')
  @Patch(':id')
  update(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchReqDto,
  ): Promise<BranchResDto> {
    this.assertInScope(user, id);
    return this.branchService.update(user.id, id, dto);
  }

  @ApiAuth({
    summary: 'Delete a branch (settings.update)',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('settings.update')
  @Delete(':id')
  remove(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    this.assertInScope(user, id);
    return this.branchService.remove(id);
  }

  @ApiAuth({
    type: BranchSettingResDto,
    summary: 'Invoice and payment settings of a branch (settings.view)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('settings.view')
  @Get(':id/settings')
  getSettings(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchSettingResDto> {
    this.assertInScope(user, id);
    return this.settingService.get(user.id, id);
  }

  @ApiAuth({
    type: BranchSettingResDto,
    summary: 'Change the settings of a branch (settings.update)',
  })
  @ApiParam({ name: 'id', type: 'String' })
  @RequirePermission('settings.update')
  @Patch(':id/settings')
  updateSettings(
    @CurrentTenant() _tenantId: string, // 403 without a selected store
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchSettingReqDto,
  ): Promise<BranchSettingResDto> {
    this.assertInScope(user, id);
    return this.settingService.update(user.id, id, dto);
  }

  /** A branch outside the caller's branches is a 404, so its existence is not leaked */
  private assertInScope(user: AuthUser, branchId: string): void {
    if (!canAccessBranch(user, branchId)) {
      throw new NotFoundException();
    }
  }
}
