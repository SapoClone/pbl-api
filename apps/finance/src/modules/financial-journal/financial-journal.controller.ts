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
  CreateFinancialAccountDto,
  ListJournalsQueryDto,
  PostJournalDto,
  ReverseJournalDto,
} from './financial-journal.dto';
import { FinancialJournalService } from './financial-journal.service';

@ApiTags('finance-journal')
@ApiBearerAuth()
@Controller(['', 'api'])
export class FinancialJournalController {
  constructor(private readonly journalService: FinancialJournalService) {}

  /** The journal, or 404 when it belongs to a branch the member may not use. */
  private async loadJournal(user: AuthUser, id: string) {
    const journal = await this.journalService.getJournalById(
      id,
      user.tenantId!,
    );
    assertRowBranch(user, journal.branchId);
    return journal;
  }

  @Get('v1/finance/accounts')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List tenant financial chart of accounts' })
  async listAccounts(@CurrentUser() user: AuthUser) {
    try {
      return await this.journalService.listAccounts(user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/accounts')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Create a custom financial account' })
  async createAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFinancialAccountDto,
  ) {
    try {
      return await this.journalService.createAccount(dto, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/journals')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List posted financial journals with filtering' })
  async listJournals(
    @CurrentUser() user: AuthUser,
    @Query() query: ListJournalsQueryDto,
  ) {
    try {
      assertBranchNamed(user, query.branchId);
      return await this.journalService.listJournals(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/journals/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get financial journal details and balanced lines' })
  async getJournal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.loadJournal(user, id);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/journals')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Post a balanced financial journal' })
  async postJournal(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PostJournalDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      dto.lines?.forEach((line) => assertBranchNamed(user, line.branchId));
      return await this.journalService.postManualJournal(
        user.id,
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/journals/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.approve')
  @ApiOperation({
    summary: 'Reverse a posted financial journal using compensating entries',
  })
  async reverseJournal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReverseJournalDto,
  ) {
    try {
      await this.loadJournal(user, id);
      return await this.journalService.reverseJournal(
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
