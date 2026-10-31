import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
  hasPermission,
} from '@pbl/auth';
import { Page } from '../common/errors';
import {
  LoyaltyService,
  LoyaltyTransactionRes,
} from '../loyalty/loyalty.service';
import {
  CustomerDetailRes,
  CustomerListItemRes,
  CustomerSummaryRes,
  CustomersService,
} from './customers.service';
import {
  AddressReqDto,
  CreateCustomerReqDto,
  CustomerFiltersDto,
  CustomerSummaryReqDto,
  ListCustomersReqDto,
  ListLoyaltyTransactionsReqDto,
  LoyaltyAdjustmentReqDto,
  UpdateAddressReqDto,
  UpdateCustomerReqDto,
} from './dto/customer.dto';

/** Whole phone numbers need `customers.update`; everyone else gets `phone: null` + `phoneMasked` */
const canSeePhone = (user: AuthUser) => hasPermission(user, 'customers.update');

/**
 * Permissions (ADR-0012): GET = customers.view; POST (customers, addresses) = customers.create;
 * PATCH (customers, addresses) and loyalty adjustments = customers.update; DELETE (customers,
 * addresses) = customers.delete. Fixed paths (`summary`, `export`) come before `:id`.
 */
@ApiTags('customers')
@ApiBearerAuth()
@Controller('api/v1/customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Get()
  @RequirePermission('customers.view')
  list(
    @Query() query: ListCustomersReqDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Page<CustomerListItemRes>> {
    return this.customers.list(query, canSeePhone(user));
  }

  @Get('summary')
  @RequirePermission('customers.view')
  summary(@Query() query: CustomerSummaryReqDto): Promise<CustomerSummaryRes> {
    return this.customers.summary(query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="customers.csv"')
  @RequirePermission('customers.view')
  export(
    @Query() query: CustomerFiltersDto,
    @CurrentUser() user: AuthUser,
  ): Promise<string> {
    return this.customers.exportCsv(query, canSeePhone(user));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('customers.create')
  create(
    @Body() dto: CreateCustomerReqDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CustomerDetailRes> {
    return this.customers.create(dto, canSeePhone(user));
  }

  @Get(':id')
  @RequirePermission('customers.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CustomerDetailRes> {
    return this.customers.get(id, canSeePhone(user));
  }

  @Patch(':id')
  @RequirePermission('customers.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerReqDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CustomerDetailRes> {
    return this.customers.update(id, dto, canSeePhone(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customers.delete')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id);
  }

  @Post(':id/addresses')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('customers.create')
  addAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddressReqDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CustomerDetailRes> {
    return this.customers.addAddress(id, dto, canSeePhone(user));
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermission('customers.update')
  updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressReqDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CustomerDetailRes> {
    return this.customers.updateAddress(id, addressId, dto, canSeePhone(user));
  }

  @Delete(':id/addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customers.delete')
  removeAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<void> {
    return this.customers.removeAddress(id, addressId);
  }

  @Get(':id/loyalty-transactions')
  @RequirePermission('customers.view')
  loyaltyTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListLoyaltyTransactionsReqDto,
  ): Promise<Page<LoyaltyTransactionRes>> {
    return this.loyalty.listTransactions(id, query);
  }

  @Post(':id/loyalty-adjustments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('customers.update')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoyaltyAdjustmentReqDto,
  ): Promise<{ transaction: LoyaltyTransactionRes; balance: number }> {
    return this.loyalty.adjust(id, dto);
  }
}
