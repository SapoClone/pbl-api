import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePlatformAdmin } from '@pbl/auth';
import {
  OverviewReqDto,
  WatchlistReqDto,
} from './announcements/announcements.dto';
import { PlatformOverviewService } from './platform-overview.service';

/**
 * The platform admin dashboard (contract 04, screen 01). Platform-admin tokens only: a store token gets 403
 * (ADR-0022). Read models only, never a store's own tables.
 */
@ApiTags('insight-admin')
@ApiBearerAuth()
@RequirePlatformAdmin()
@Controller('api/v1/admin')
export class PlatformOverviewController {
  constructor(private readonly overview: PlatformOverviewService) {}

  @ApiOperation({
    summary: 'Platform KPI cards',
    description:
      'Stores, expiring subscriptions, plans in use and completed sales of every store for the range (`from`, `to`: YYYY-MM-DD, Asia/Ho_Chi_Minh, inclusive; today when missing), compared with the previous range of the same length.',
  })
  @Get('overview')
  getOverview(@Query() query: OverviewReqDto) {
    return this.overview.overview(query.from, query.to);
  }

  @ApiOperation({
    summary: 'Completed sales per day, platform-wide',
    description:
      'One row per day of the range, zero days included; at most 92 days (422 beyond, or when from is after to). Revenue is integer VND.',
  })
  @Get('transactions/daily')
  daily(@Query() query: OverviewReqDto) {
    return this.overview.dailyTransactions(query.from, query.to);
  }

  @ApiOperation({
    summary: 'Stores that need attention',
    description:
      'Subscriptions ending soon or ended and plan limits close to or at their maximum, most urgent first. Structured fields, no text.',
  })
  @Get('watchlist')
  watchlist(@Query() query: WatchlistReqDto) {
    return this.overview.watchlist(query.limit);
  }
}
