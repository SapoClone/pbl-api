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
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import {
  assertBranchNamed,
  assertRowBranch,
  branchScopeOf,
} from '../../presentation/branch-scope';
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
  @RequirePermission('finance.create')
  @ApiOperation({
    summary: 'Create a cash drawer, safe, bank, or e-wallet account',
  })
  async createCashAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCashAccountDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.cashAccountsService.createCashAccount(
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cash-accounts')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List tenant cash and bank accounts' })
  async listCashAccounts(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCashAccountsQueryDto,
  ) {
    try {
      assertBranchNamed(user, query.branchId);
      return await this.cashAccountsService.listCashAccounts(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cash-accounts/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get cash account details and current balance' })
  async getCashAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      const account = await this.cashAccountsService.getCashAccountById(
        id,
        user.tenantId!,
      );
      assertRowBranch(user, account.branchId);
      return account;
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Patch('v1/finance/cash-accounts/:id')
  @RequirePermission('finance.update')
  @ApiOperation({ summary: 'Update or close a cash account' })
  async updateCashAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCashAccountDto,
  ) {
    try {
      const current = await this.cashAccountsService.getCashAccountById(
        id,
        user.tenantId!,
      );
      assertRowBranch(user, current.branchId);
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
