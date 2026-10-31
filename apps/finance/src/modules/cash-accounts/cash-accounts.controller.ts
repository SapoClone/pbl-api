import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import {
  CreateCashAccountDto,
  ListCashAccountsQueryDto,
  UpdateCashAccountDto,
} from './cash-accounts.dto';
import { CashAccountsService } from './cash-accounts.service';

@ApiTags('finance-cash-accounts')
@ApiBearerAuth()
@Controller(['', 'api'])
export class CashAccountsController {
  constructor(private readonly cashAccountsService: CashAccountsService) {}

  @Post('v1/finance/cash-accounts')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary: 'Create a cash drawer, safe, bank, or e-wallet account',
  })
  async createCashAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCashAccountDto,
  ) {
    try {
      return await this.cashAccountsService.createCashAccount(
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cash-accounts')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List tenant cash and bank accounts' })
  async listCashAccounts(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCashAccountsQueryDto,
  ) {
    try {
      return await this.cashAccountsService.listCashAccounts(
        query,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cash-accounts/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get cash account details and current balance' })
  async getCashAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.cashAccountsService.getCashAccountById(
        id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Patch('v1/finance/cash-accounts/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Update or close a cash account' })
  async updateCashAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCashAccountDto,
  ) {
    try {
      return await this.cashAccountsService.updateCashAccount(
        id,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
