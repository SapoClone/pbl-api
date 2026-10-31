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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
        user.roles ?? [],
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/lookup')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'Fast exact customer lookup by normalized phone, code, or email',
  })
  async lookupCustomer(
    @CurrentUser() user: AuthUser,
    @Query() query: LookupCustomerQueryDto,
  ) {
    try {
      return await this.profilesService.lookupCustomer(user.tenantId!, query);
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get customer profile by ID' })
  async getCustomerById(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('maskPii') maskPii?: string,
  ) {
    try {
      return await this.profilesService.getCustomerById(user.tenantId!, id, {
        maskPii: maskPii === 'true',
      });
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Patch('v1/customers/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
      );
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Delete('v1/customers/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary:
      'Get 360-degree customer summary (profile, loyalty, purchase projection, financial summary)',
  })
  async getCustomerSummary(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.profilesService.getCustomerSummary(user.tenantId!, id);
    } catch (err) {
      rethrowCustomerHttpError(err);
    }
  }

  @Get('v1/customers/:id/purchase-summary')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
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
  @Get('internal/v1/customers/:id/eligibility')
  @ApiOperation({
    summary:
      'Internal S2S endpoint for Sales/POS to fetch customer eligibility, discounts, and loyalty balance',
  })
  async getCustomerEligibility(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers('x-internal-call') internalCallHeader: string | undefined,
    @Headers('x-internal-token') internalTokenHeader: string | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const expectedToken = process.env.INTERNAL_S2S_TOKEN;
    if (expectedToken && internalTokenHeader !== expectedToken) {
      throw new ForbiddenException('Invalid internal S2S token');
    }
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
