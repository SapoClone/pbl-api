import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import { maskAddressPhones } from '../../domain/customer-domain';
import { rethrowCustomerHttpError } from '../../presentation/customer-http-error';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './addresses.dto';
import { AddressesService } from './addresses.service';

@ApiTags('customer-addresses')
@ApiBearerAuth()
@Controller(['v1/customers/:id/addresses', 'api/v1/customers/:id/addresses'])
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  @RequirePermission('customers.create')
  @ApiOperation({ summary: 'Add an address to a customer profile' })
  async addAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    try {
      return maskAddressPhones(
        await this.addressesService.addAddress(customerId, dto),
        hasPermission(user, 'customers.update'),
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get()
  @RequirePermission('customers.view')
  @ApiOperation({ summary: 'List active addresses for a customer' })
  async listAddresses(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) customerId: string,
  ) {
    try {
      return (await this.addressesService.listAddresses(customerId)).map((a) =>
        maskAddressPhones(a, hasPermission(user, 'customers.update')),
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Patch(':addressId')
  @RequirePermission('customers.update')
  @ApiOperation({ summary: 'Update a customer address' })
  async updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    try {
      return maskAddressPhones(
        await this.addressesService.updateAddress(customerId, addressId, dto),
        hasPermission(user, 'customers.update'),
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Delete(':addressId')
  @RequirePermission('customers.delete')
  @ApiOperation({ summary: 'Soft-deactivate a customer address' })
  async deleteAddress(
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ) {
    try {
      return await this.addressesService.deactivateAddress(
        customerId,
        addressId,
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Post(':addressId/set-default')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customers.update')
  @ApiOperation({
    summary: 'Set an address as the single active default address',
  })
  async setDefaultAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ) {
    try {
      return maskAddressPhones(
        await this.addressesService.setDefaultAddress(customerId, addressId),
        hasPermission(user, 'customers.update'),
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
