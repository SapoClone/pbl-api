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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentTenant, CurrentUser, RequireRoles } from '@pbl/auth';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { AddMemberReqDto } from './dto/add-member.req.dto';
import { ChangeMemberRoleReqDto } from './dto/change-member-role.req.dto';
import { CreateTenantReqDto } from './dto/create-tenant.req.dto';
import { CreateTenantResDto } from './dto/create-tenant.res.dto';
import { MemberResDto } from './dto/member.res.dto';
import { MembershipResDto } from './dto/membership.res.dto';
import { TenantResDto } from './dto/tenant.res.dto';
import { UpdateTenantReqDto } from './dto/update-tenant.req.dto';
import { TenantRole } from './entities/account-tenant.entity';
import { MemberService } from './member.service';
import { TenantService } from './tenant.service';

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
  listMembers(@CurrentTenant() tenantId: string): Promise<MemberResDto[]> {
    return this.memberService.list(tenantId);
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
