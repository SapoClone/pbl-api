import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import { CreateCustomerTagDto } from './tags.dto';
import { TagsService } from './tags.service';

@ApiTags('customer-tags')
@ApiBearerAuth()
@Controller(['v1', 'api/v1'])
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('customer-tags')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'List customer tags of the store' })
  async listTags(@CurrentUser() user: AuthUser) {
    try {
      return await this.tagsService.listTags(user.tenantId!);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post('customer-tags')
  @RequirePermission('customers.update')
  @ApiOperation({ summary: 'Create a customer tag (unique name per store)' })
  async createTag(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomerTagDto,
  ) {
    try {
      return await this.tagsService.createTag(user.tenantId!, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
