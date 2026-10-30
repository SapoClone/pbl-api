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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Add an address to a customer profile' })
  async addAddress(
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    try {
      return await this.addressesService.addAddress(customerId, dto);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List active addresses for a customer' })
  async listAddresses(@Param('id', new ParseUUIDPipe()) customerId: string) {
    try {
      return await this.addressesService.listAddresses(customerId);
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Patch(':addressId')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Update a customer address' })
  async updateAddress(
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    try {
      return await this.addressesService.updateAddress(
        customerId,
        addressId,
        dto,
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }

  @Delete(':addressId')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({
    summary: 'Set an address as the single active default address',
  })
  async setDefaultAddress(
    @Param('id', new ParseUUIDPipe()) customerId: string,
    @Param('addressId', new ParseUUIDPipe()) addressId: string,
  ) {
    try {
      return await this.addressesService.setDefaultAddress(
        customerId,
        addressId,
      );
    } catch (error) {
      rethrowCustomerHttpError(error);
    }
  }
}
