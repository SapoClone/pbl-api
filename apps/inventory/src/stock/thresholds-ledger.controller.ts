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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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

/**
 * Contract permissions: `inventory.view` = owner, manager, cashier; `inventory.update`
 * (thresholds) = owner, manager.
 */
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
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  upsert(@Body() dto: UpsertThresholdReqDto): Promise<ThresholdRes> {
    return this.thresholds.upsert(dto);
  }

  @Get('stock-thresholds')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(@Query() query: ListThresholdsReqDto): Promise<Page<ThresholdRes>> {
    return this.thresholds.list(query);
  }

  @Get('ledger-entries')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  entries(@Query() query: ListLedgerReqDto): Promise<Page<LedgerEntryRes>> {
    return this.ledger.list(query);
  }
}
