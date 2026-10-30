import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import {
  CreateMembershipTierDto,
  UpdateMembershipTierDto,
} from './memberships.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('membership-tiers')
@ApiBearerAuth()
@Controller(['v1', 'api/v1'])
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post('membership-tiers')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a membership tier (Member, Silver, Gold, Platinum)',
  })
  async createTier(@Body() dto: CreateMembershipTierDto) {
    try {
      return await this.membershipsService.createTier(dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('membership-tiers')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List membership tiers for current tenant' })
  async listTiers() {
    try {
      return await this.membershipsService.listTiers();
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Patch('membership-tiers/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Update a membership tier configuration' })
  async updateTier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMembershipTierDto,
  ) {
    try {
      return await this.membershipsService.updateTier(id, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('customers/:id/membership')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'Get customer membership tier and qualification progress',
  })
  async getCustomerMembership(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.membershipsService.getCustomerMembership(id);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
