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
import {
  AllowedBranches,
  AuthUser,
  CurrentTenant,
  CurrentUser,
  RequirePermission,
} from '@pbl/auth';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { AddMemberReqDto } from './dto/add-member.req.dto';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { CreateTenantResDto } from './dto/create-tenant.res.dto';
import { ListMemberReqDto } from './dto/list-member.req.dto';
import { MemberDetailResDto } from './dto/member-detail.res.dto';
import { MemberSummaryResDto } from './dto/member-summary.res.dto';
import { MemberResDto } from './dto/member.res.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantContextResDto } from './dto/tenant-context.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateMemberReqDto } from './dto/update-member.req.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import { MemberService } from './member.service';
import { TenantService } from './tenant.service';

/**
 * Permissions (ADR-0012): `settings.update` edits the store; members need
 * `staff.view` (list, summary, detail), `staff.create` (add), `staff.update`
 * (role, branches, lock, unlock) and `staff.delete` (remove). The store list
 * and the context are open to every member.
 */
@ApiTags('tenants')
@Controller({ path: 'tenants', version: '1' })
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly authService: AuthService,
    private readonly memberService: MemberService,
  ) {}

  @ApiAuth({ type: MembershipResDto, summary: 'Stores I belong to' })
  @Get()
  listMine(@CurrentUser('id') accountId: string): Promise<MembershipResDto[]> {
    return this.tenantService.listMine(accountId);
  }

  @ApiAuth({
    type: CreateTenantResDto,
    summary: 'Create a store (returns tokens bound to it)',
    statusCode: HttpStatus.CREATED,
  })
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTenantReqDto,
  ): Promise<CreateTenantResDto> {
    const tenant = await this.tenantService.create(user.id, dto);
    const auth = await this.authService.switchTenant(user, tenant.id);
    return plainToInstance(CreateTenantResDto, {
      tenant: tenant.toDto(TenantResDto),
      auth,
    });
  }

  @ApiAuth({ type: TenantResDto, summary: 'The selected store' })
  @Get('current')
  getCurrent(@CurrentTenant() tenantId: string): Promise<TenantResDto> {
    return this.tenantService.getCurrent(tenantId);
  }

  @ApiAuth({
    type: TenantContextResDto,
    summary: 'Sidebar store card, branches and who I am, in one call',
  })
  @Get('current/context')
  getContext(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUser,
    @AllowedBranches() branches: string[] | null,
  ): Promise<TenantContextResDto> {
    return this.tenantService.getContext(tenantId, user.id, {
      permissions: user.permissions,
      branches,
    });
  }

  @ApiAuth({
    type: TenantResDto,
    summary: 'Update the selected store (settings.update)',
  })
  @RequirePermission('settings.update')
  @Patch('current')
  updateCurrent(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') accountId: string,
    @Body() dto: UpdateTenantReqDto,
  ): Promise<TenantResDto> {
    return this.tenantService.updateCurrent(tenantId, accountId, dto);
  }

  @ApiAuth({
    type: MemberResDto,
    summary: 'Members of the selected store (staff.view)',
  })
  @RequirePermission('staff.view')
  @Get('current/members')
  listMembers(
    @CurrentTenant() tenantId: string,
    @Query() query: ListMemberReqDto,
  ): Promise<MemberResDto[]> {
    return this.memberService.list(tenantId, query);
  }

  @ApiAuth({
    type: MemberSummaryResDto,
    summary: 'KPI cards of the staff screen (staff.view)',
  })
  @RequirePermission('staff.view')
  @Get('current/members/summary')
  memberSummary(
    @CurrentTenant() tenantId: string,
  ): Promise<MemberSummaryResDto> {
    return this.memberService.summary(tenantId);
  }

  @ApiAuth({
    type: MemberDetailResDto,
    summary: 'One member with their shifts (staff.view)',
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequirePermission('staff.view')
  @Get('current/members/:accountId')
  getMember(
    @CurrentTenant() tenantId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberDetailResDto> {
    return this.memberService.get(tenantId, accountId);
  }

  @ApiAuth({
    type: MemberResDto,
    summary:
      'Lock a member out of the store and end their sessions (staff.update)',
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequirePermission('staff.update')
  @Post('current/members/:accountId/lock')
  lockMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberResDto> {
    return this.memberService.lock(tenantId, actorId, accountId);
  }

  @ApiAuth({ type: MemberResDto, summary: 'Unlock a member (staff.update)' })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequirePermission('staff.update')
  @Post('current/members/:accountId/unlock')
  unlockMember(
    @CurrentTenant() tenantId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberResDto> {
    return this.memberService.unlock(tenantId, accountId);
  }

  @ApiAuth({
    summary: 'Remove a member from the store (staff.delete); the account stays',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequirePermission('staff.delete')
  @Delete('current/members/:accountId')
  removeMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<void> {
    return this.memberService.remove(tenantId, actorId, accountId);
  }

  @ApiAuth({
    type: MemberResDto,
    summary:
      'Give a registered account a role (roleId, or the legacy role) and branches (staff.create)',
    statusCode: HttpStatus.CREATED,
  })
  @RequirePermission('staff.create')
  @Post('current/members')
  addMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: AddMemberReqDto,
  ): Promise<MemberResDto> {
    return this.memberService.add(
      tenantId,
      actorId,
      dto.email,
      { roleId: dto.roleId, role: dto.role },
      dto.branchIds,
    );
  }

  @ApiAuth({
    type: MemberResDto,
    summary:
      'Change the role and/or branches of a member; applies at their next sign-in or refresh (staff.update)',
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequirePermission('staff.update')
  @Patch('current/members/:accountId')
  updateMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateMemberReqDto,
  ): Promise<MemberResDto> {
    return this.memberService.update(
      tenantId,
      actorId,
      accountId,
      { roleId: dto.roleId, role: dto.role },
      dto.branchIds,
    );
  }
}
