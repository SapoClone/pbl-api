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
import { AuthUser, CurrentUser, RequirePermission } from '@pbl/auth';
import {
  assertBranchNamed,
  branchScopeOf,
} from '../../presentation/branch-scope';
import { rethrowFinanceHttpError } from '../../presentation/finance-http-error';
import {
  CreateCodReceivableDto,
  ImportCodSettlementBatchDto,
  ListCodBatchesQueryDto,
  ListCodReceivablesQueryDto,
  ReconcileCodBatchDto,
} from './cod.dto';
import { CodService } from './cod.service';

@ApiTags('finance-cod')
@ApiBearerAuth()
@Controller(['v1/finance/cod', 'api/v1/finance/cod'])
export class CodController {
  constructor(private readonly codService: CodService) {}

  @Post('receivables')
  @RequirePermission('finance.create')
  @ApiOperation({ summary: 'Recognize a COD carrier receivable' })
  async createReceivable(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCodReceivableDto,
  ) {
    try {
      assertBranchNamed(user, dto.branchId);
      return await this.codService.createCodReceivable(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('receivables')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List COD carrier receivables' })
  async listReceivables(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCodReceivablesQueryDto,
  ) {
    try {
      return await this.codService.listCodReceivables(
        query,
        user.tenantId!,
        branchScopeOf(user),
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('settlement-batches')
  @RequirePermission('finance.create')
  @ApiOperation({
    summary:
      'Import and optionally reconcile a carrier COD settlement statement batch',
  })
  async importBatch(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ImportCodSettlementBatchDto,
  ) {
    try {
      return await this.codService.importSettlementBatch(
        user.id ?? 'system',
        idempotencyKey,
        dto,
        user.tenantId!,
      );
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('settlement-batches')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'List COD settlement batches' })
  async listBatches(
    @CurrentUser() user: AuthUser,
    @Query() query: ListCodBatchesQueryDto,
  ) {
    try {
      return await this.codService.listCodBatches(query, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Get('settlement-batches/:id')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Get COD settlement batch and lines by id' })
  async getBatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      return await this.codService.getCodBatchById(id, user.tenantId!);
    } catch (error) {
      rethrowFinanceHttpError(error);
    }
  }

  @Post('settlement-batches/:id/reconcile')
  @RequirePermission('finance.approve')
  @ApiOperation({ summary: 'Reconcile an imported COD settlement batch' })
  async reconcileBatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileCodBatchDto,
  ) {
    try {
      return await this.codService.reconcileBatch(
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
