import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import {
  AssignCustomerGroupDto,
  CreateCustomerGroupDto,
  UpdateCustomerGroupDto,
} from './groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('customer-groups')
@ApiBearerAuth()
@Controller(['v1', 'api/v1'])
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post('customer-groups')
  @RequirePermission('customers.create')
  @ApiOperation({ summary: 'Create a customer group (VIP, Wholesale, Member)' })
  async createGroup(@Body() dto: CreateCustomerGroupDto) {
    try {
      return await this.groupsService.createGroup(dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get('customer-groups')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'List customer groups for current tenant' })
  async listGroups() {
    try {
      return await this.groupsService.listGroups();
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Patch('customer-groups/:id')
  @RequirePermission('customers.update')
  @ApiOperation({ summary: 'Update or deactivate a customer group' })
  async updateGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerGroupDto,
  ) {
    try {
      return await this.groupsService.updateGroup(id, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('customers/:id/assign-group')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customers.update')
  @ApiOperation({
    summary: 'Assign or unassign a customer to a customer group',
  })
  async assignGroup(
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AssignCustomerGroupDto,
  ) {
    try {
      return await this.groupsService.assignCustomerToGroup(
        customerId,
        user.id,
        dto,
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
