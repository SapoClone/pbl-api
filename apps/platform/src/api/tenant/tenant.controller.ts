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
import { AuthUser, CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { AddMemberReqDto } from './dto/add-member.req.dto';
import { ChangeMemberRoleReqDto } from './dto/change-member-role.req.dto';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { CreateTenantResDto } from './dto/create-tenant.res.dto';
import { ListMemberReqDto } from './dto/list-member.req.dto';
import { MemberDetailResDto } from './dto/member-detail.res.dto';
import { MemberSummaryResDto } from './dto/member-summary.res.dto';
import { MemberResDto } from './dto/member.res.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantContextResDto } from './dto/tenant-context.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import { TenantRole } from './entities/account-tenant.entity';
import { MemberService } from './member.service';
import { TenantService } from './tenant.service';

/**
 * Contract permissions: `staff.view` (list, summary, detail) maps to owner and
 * manager (the existing list was already limited to them, so the new reads
 * follow it rather than opening staff emails to cashiers); `staff.update`,
 * `staff.delete` (lock, unlock, remove) map to owner only.
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
    @CurrentUser('id') accountId: string,
  ): Promise<TenantContextResDto> {
    return this.tenantService.getContext(tenantId, accountId);
  }

  @ApiAuth({ type: TenantResDto, summary: 'Update the selected store (owner)' })
  @RequireRoles(TenantRole.OWNER)
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
    summary: 'Members of the selected store (owner, manager)',
  })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Get('current/members')
  listMembers(
    @CurrentTenant() tenantId: string,
    @Query() query: ListMemberReqDto,
  ): Promise<MemberResDto[]> {
    return this.memberService.list(tenantId, query);
  }

  @ApiAuth({
    type: MemberSummaryResDto,
    summary: 'KPI cards of the staff screen (owner, manager)',
  })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Get('current/members/summary')
  memberSummary(
    @CurrentTenant() tenantId: string,
  ): Promise<MemberSummaryResDto> {
    return this.memberService.summary(tenantId);
  }

  @ApiAuth({
    type: MemberDetailResDto,
    summary: 'One member with their shifts (owner, manager)',
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequireRoles(TenantRole.OWNER, TenantRole.MANAGER)
  @Get('current/members/:accountId')
  getMember(
    @CurrentTenant() tenantId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberDetailResDto> {
    return this.memberService.get(tenantId, accountId);
  }

  @ApiAuth({
    type: MemberResDto,
    summary: 'Lock a member out of the store and end their sessions (owner)',
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Post('current/members/:accountId/lock')
  lockMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberResDto> {
    return this.memberService.lock(tenantId, actorId, accountId);
  }

  @ApiAuth({ type: MemberResDto, summary: 'Unlock a member (owner)' })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
  @Post('current/members/:accountId/unlock')
  unlockMember(
    @CurrentTenant() tenantId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<MemberResDto> {
    return this.memberService.unlock(tenantId, accountId);
  }

  @ApiAuth({
    summary: 'Remove a member from the store (owner); the account stays',
    statusCode: HttpStatus.NO_CONTENT,
  })
  @ApiParam({ name: 'accountId', type: 'String' })
  @RequireRoles(TenantRole.OWNER)
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
    summary: 'Give a registered account a role in the store (owner)',
    statusCode: HttpStatus.CREATED,
  })
  @RequireRoles(TenantRole.OWNER)
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
      dto.role as unknown as TenantRole,
    );
  }

  @ApiAuth({
    type: MemberResDto,
    summary: 'Change the role of a member (owner)',
  })
  @RequireRoles(TenantRole.OWNER)
  @Patch('current/members/:accountId')
  changeMemberRole(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: ChangeMemberRoleReqDto,
  ): Promise<MemberResDto> {
    return this.memberService.changeRole(
      tenantId,
      actorId,
      accountId,
      dto.role as unknown as TenantRole,
    );
  }
}
