import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  Public,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import { InternalTokenGuard } from '../../presentation/internal-token.guard';
import {
  CreateCustomerDto,
  DeactivateCustomerQueryDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  LookupCustomerQueryDto,
  UpdateCustomerDto,
} from './profiles.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller(['', 'api'])
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post('v1/customers')
  @RequirePermission('customers.create')
  @ApiOperation({
    summary: 'Create a customer profile with an initialized loyalty account',
  })
  async createCustomer(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomerDto,
  ) {
    try {
      return await this.profilesService.createCustomer(
        user.tenantId!,
        user.id ?? 'system',
        dto,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'List and search customer profiles with cursor/offset pagination',
  })
  async listCustomers(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCustomersQueryDto,
  ) {
    try {
      return await this.profilesService.listCustomers(
        user.tenantId!,
        query,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/lookup')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'Fast exact customer lookup by normalized phone, code, or email',
  })
  async lookupCustomer(
    @CurrentUser() user: AuthUser,
    @Query() query: LookupCustomerQueryDto,
  ) {
    try {
      return await this.profilesService.lookupCustomer(
        user.tenantId!,
        query,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id')
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'Get customer profile by ID' })
  async getCustomerById(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.profilesService.getCustomerById(user.tenantId!, id, {
        fullPhone: hasPermission(user, 'customers.update'),
      });
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Patch('v1/customers/:id')
  @RequirePermission('customers.update')
  @ApiOperation({
    summary: 'Update customer profile with optional optimistic version check',
  })
  async updateCustomer(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    try {
      return await this.profilesService.updateCustomer(
        user.tenantId!,
        id,
        user.id ?? 'system',
        dto,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Delete('v1/customers/:id')
  @RequirePermission('customers.delete')
  @ApiOperation({
    summary: 'Deactivate or privacy-anonymize a customer profile',
  })
  async deactivateCustomer(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: DeactivateCustomerQueryDto,
  ) {
    try {
      return await this.profilesService.deactivateCustomer(
        user.tenantId!,
        id,
        user.id ?? 'system',
        query,
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id/summary')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary:
      'Get 360-degree customer summary (profile, loyalty, purchase projection, financial summary)',
  })
  async getCustomerSummary(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.profilesService.getCustomerSummary(
        user.tenantId!,
        id,
        hasPermission(user, 'customers.update'),
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id/purchase-summary')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'Get customer purchase summary from event-driven read model',
  })
  async getPurchaseSummary(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.profilesService.getPurchaseSummary(user.tenantId!, id);
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id/orders')
  @RequirePermission('customers.view')
  @ApiOperation({
    summary: 'List customer historical orders from event-driven projection',
  })
  async listCustomerOrders(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCustomerOrdersQueryDto,
  ) {
    try {
      return await this.profilesService.listCustomerOrders(
        user.tenantId!,
        id,
        query,
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @Get('internal/v1/customers/:id/eligibility')
  @ApiOperation({
    summary:
      'Internal S2S endpoint for Sales/POS to fetch customer eligibility, discounts, and loyalty balance',
  })
  async getCustomerEligibility(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (!internalCallHeader) {
      throw new ForbiddenException('Missing x-internal-call header');
    }
    if (!tenantIdHeader) {
      throw new ForbiddenException('Missing x-tenant-id header');
    }
    try {
      return await this.profilesService.getCustomerEligibility(
        tenantIdHeader,
        id,
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }
}
