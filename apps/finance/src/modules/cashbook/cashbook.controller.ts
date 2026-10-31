import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CreateCashbookCategoryDto,
  CreateCashbookVoucherDto,
  ListCashbookEntriesQueryDto,
  PostCashbookEntryDto,
  ReverseCashbookEntryDto,
} from './cashbook.dto';
import { CashbookService } from './cashbook.service';

@ApiTags('finance-cashbook')
@ApiBearerAuth()
@Controller(['', 'api'])
export class CashbookController {
  constructor(private readonly cashbookService: CashbookService) {}

  /** The entry, or 404 when it belongs to a branch the member may not use. */
  private async loadEntry(user: AuthUser, id: string) {
    const entry = await this.cashbookService.getEntryById(id, user.tenantId!);
    assertRowBranch(user, entry.branchId);
    return entry;
  }

  @Get('v1/finance/cashbook/categories')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List cashbook receipt and expense categories' })
  async listCategories(
    @CurrentUser() user: AuthUser,
    @Query('direction') direction?: 'RECEIPT' | 'EXPENSE',
  ) {
    try {
      return await this.cashbookService.listCategories(
        direction,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/categories')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Create a custom cashbook category' })
  async createCategory(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCashbookCategoryDto,
  ) {
    try {
      return await this.cashbookService.createCategory(dto, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/receipts')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Create a cashbook receipt voucher (PT)' })
  async createReceipt(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCashbookVoucherDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.cashbookService.createReceiptVoucher(
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/expenses')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Create a cashbook expense voucher (PC)' })
  async createExpense(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCashbookVoucherDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.cashbookService.createExpenseVoucher(
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cashbook/entries')
  @RequirePermission('finance.view')
  @ApiOperation({
    summary: 'List cashbook entries with filtering and pagination',
  })
  async listEntries(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCashbookEntriesQueryDto,
  ) {
    try {
      assertBranchNamed(user, query.branchId);
      return await this.cashbookService.listEntries(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cashbook/export')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Export cashbook entries as CSV' })
  async exportEntries(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCashbookEntriesQueryDto,
  ) {
    try {
      assertBranchNamed(user, query.branchId);
      return await this.cashbookService.exportEntriesCsv(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/cashbook/entries/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get cashbook voucher details' })
  async getEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.loadEntry(user, id);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/entries/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Approve a DRAFT cashbook voucher' })
  async approveEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      await this.loadEntry(user, id);
      return await this.cashbookService.approveEntry(
        id,
        user.id,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/entries/:id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary:
      'Post a cashbook voucher, atomically writing a balanced journal and updating cash account balance',
  })
  async postEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() dto?: PostCashbookEntryDto,
  ) {
    try {
      await this.loadEntry(user, id);
      return await this.cashbookService.postEntry(
        id,
        user.id,
        idempotencyKeyHeader ?? dto?.idempotencyKey,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/cashbook/entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary:
      'Reverse a POSTED cashbook voucher using a compensating reversal voucher and journal',
  })
  async reverseEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReverseCashbookEntryDto,
  ) {
    try {
      await this.loadEntry(user, id);
      return await this.cashbookService.reverseEntry(
        id,
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
