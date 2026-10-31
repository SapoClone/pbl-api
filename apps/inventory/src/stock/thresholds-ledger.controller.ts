import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { Page } from '../common/sql';
import { ListLedgerReqDto } from './dto/ledger.dto';
import {
  ListThresholdsReqDto,
  UpsertThresholdReqDto,
} from './dto/threshold.dto';
import { LedgerEntryRes, LedgerService } from './ledger.service';
import {
  StockThresholdsService,
  ThresholdRes,
} from './stock-thresholds.service';

/** Permissions: `inventory.view` for reads, `inventory.update` for thresholds; branch scope applies */
@ApiTags('stock')
@ApiBearerAuth()
@Controller('api/v1')
export class ThresholdsLedgerController {
  constructor(
    private readonly thresholds: StockThresholdsService,
    private readonly ledger: LedgerService,
  ) {}

  @Post('stock-thresholds')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  upsert(
    @Body() dto: UpsertThresholdReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<ThresholdRes> {
    return this.thresholds.upsert(dto, scope);
  }

  @Get('stock-thresholds')
  @RequirePermission('inventory.view')
  list(
    @Query() query: ListThresholdsReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<ThresholdRes>> {
    return this.thresholds.list(query, scope);
  }

  @Get('ledger-entries')
  @RequirePermission('inventory.view')
  entries(
    @Query() query: ListLedgerReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<LedgerEntryRes>> {
    return this.ledger.list(query, scope);
  }
}
