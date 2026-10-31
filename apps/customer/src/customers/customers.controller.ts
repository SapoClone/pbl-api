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
import { CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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

/** Roles that see whole phone numbers (the contract's `customers.update`) */
const PHONE_ROLES: string[] = [ROLES.OWNER, ROLES.MANAGER];
const canSeePhone = (roles: string[] | undefined) =>
  (roles ?? []).some((role) => PHONE_ROLES.includes(role));

/**
 * Permission codes of the contract mapped to roles (no RBAC yet): customers.view,
 * customers.create and customers.update (edit, addresses) = owner, manager, cashier (the POS
 * edits customers); customers.delete and loyalty adjustments = owner, manager. Whole phone
 * numbers are shown to owner and manager only (open question 6 of the contract).
 * Fixed paths (`summary`, `export`) come before `:id`.
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(
    @Query() query: ListCustomersReqDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<Page<CustomerListItemRes>> {
    return this.customers.list(query, canSeePhone(roles));
  }

  @Get('summary')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  summary(@Query() query: CustomerSummaryReqDto): Promise<CustomerSummaryRes> {
    return this.customers.summary(query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="customers.csv"')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  export(
    @Query() query: CustomerFiltersDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<string> {
    return this.customers.exportCsv(query, canSeePhone(roles));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  create(
    @Body() dto: CreateCustomerReqDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<CustomerDetailRes> {
    return this.customers.create(dto, canSeePhone(roles));
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('roles') roles: string[],
  ): Promise<CustomerDetailRes> {
    return this.customers.get(id, canSeePhone(roles));
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerReqDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<CustomerDetailRes> {
    return this.customers.update(id, dto, canSeePhone(roles));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id);
  }

  @Post(':id/addresses')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  addAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddressReqDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<CustomerDetailRes> {
    return this.customers.addAddress(id, dto, canSeePhone(roles));
  }

  @Patch(':id/addresses/:addressId')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressReqDto,
    @CurrentUser('roles') roles: string[],
  ): Promise<CustomerDetailRes> {
    return this.customers.updateAddress(id, addressId, dto, canSeePhone(roles));
  }

  @Delete(':id/addresses/:addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  removeAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<void> {
    return this.customers.removeAddress(id, addressId);
  }

  @Get(':id/loyalty-transactions')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  loyaltyTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListLoyaltyTransactionsReqDto,
  ): Promise<Page<LoyaltyTransactionRes>> {
    return this.loyalty.listTransactions(id, query);
  }

  @Post(':id/loyalty-adjustments')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoyaltyAdjustmentReqDto,
  ): Promise<{ transaction: LoyaltyTransactionRes; balance: number }> {
    return this.loyalty.adjust(id, dto);
  }
}
