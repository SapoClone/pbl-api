import {
  Body,
  Controller,
  Get,
  Headers,
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
  ConfirmRefundOutcomeDto,
  CreateRefundDto,
  ExecuteRefundDto,
  ListRefundsQueryDto,
} from './refunds.dto';
import { RefundsService } from './refunds.service';

@ApiTags('finance-refunds')
@ApiBearerAuth()
@Controller(['v1/finance/refunds', 'api/v1/finance/refunds'])
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.refund.process',
  )
  @ApiOperation({ summary: 'Create a refund operation against an order' })
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateRefundDto,
  ) {
    try {
      return await this.refundsService.createRefund(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get()
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.report.read',
  )
  @ApiOperation({ summary: 'List refund operations' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListRefundsQueryDto,
  ) {
    try {
      return await this.refundsService.listRefunds(query, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get(':id')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.report.read',
  )
  @ApiOperation({ summary: 'Get refund operation by id' })
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.refundsService.getRefundById(id, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/approve')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    'accountant',
    'finance.refund.approve',
  )
  @ApiOperation({ summary: 'Approve a requested refund operation' })
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.refundsService.approveRefund(
        id,
        user.id ?? 'system',
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/execute')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.CASHIER,
    'accountant',
    'finance.refund.process',
  )
  @ApiOperation({ summary: 'Execute an approved refund operation' })
  async execute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecuteRefundDto,
  ) {
    try {
      return await this.refundsService.executeRefund(
        id,
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post(':id/confirm-outcome')
  @RequireRoles(
    ROLES.OWNER,
    ROLES.MANAGER,
    'accountant',
    'finance.refund.process',
  )
  @ApiOperation({
    summary:
      'Confirm external provider outcome for a PENDING_CONFIRMATION or RECONCILIATION_REQUIRED refund',
  })
  async confirmOutcome(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmRefundOutcomeDto,
  ) {
    try {
      return await this.refundsService.confirmRefundOutcome(
        id,
        user.id ?? 'system',
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }
}
