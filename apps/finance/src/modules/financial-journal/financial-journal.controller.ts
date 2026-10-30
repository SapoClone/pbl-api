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
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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

  @Get('v1/finance/accounts')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List tenant financial chart of accounts' })
  async listAccounts(@CurrentUser() user: AuthUser) {
    try {
      return await this.journalService.listAccounts(user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/accounts')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, 'accountant')
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, 'accountant')
  @ApiOperation({ summary: 'List posted financial journals with filtering' })
  async listJournals(
    @CurrentUser() user: AuthUser,
    @Query() query: ListJournalsQueryDto,
  ) {
    try {
      return await this.journalService.listJournals(query, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('v1/finance/journals/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, 'accountant')
  @ApiOperation({ summary: 'Get financial journal details and balanced lines' })
  async getJournal(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    try {
      return await this.journalService.getJournalById(id, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('v1/finance/journals')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, 'accountant')
  @ApiOperation({ summary: 'Post a balanced financial journal' })
  async postJournal(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PostJournalDto,
  ) {
    try {
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, 'accountant')
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
