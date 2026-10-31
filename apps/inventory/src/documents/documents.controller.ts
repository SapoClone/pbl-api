import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { Page } from '../common/sql';
import {
  CreateIssueReqDto,
  CreateStockTakeReqDto,
  CreateTransferReqDto,
  DocumentActionReqDto,
  ListIssuesReqDto,
  ListTakesReqDto,
  ListTransfersReqDto,
  ReceiveTransferReqDto,
  UpdateTakeItemsReqDto,
} from './document.dto';
import {
  IssueRes,
  IssueRowRes,
  StockIssuesService,
} from './stock-issues.service';
import { StockTakesService, TakeRes, TakeRowRes } from './stock-takes.service';
import {
  StockTransfersService,
  TransferRes,
  TransferRowRes,
} from './stock-transfers.service';

const VIEW = [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER] as const;
const WRITE = [ROLES.OWNER, ROLES.MANAGER] as const;

/**
 * Contract permissions: `inventory.view` = owner, manager, cashier;
 * `inventory.create/update/approve` = owner, manager.
 */
@ApiTags('stock-transfers')
@ApiBearerAuth()
@Controller('api/v1/stock-transfers')
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITE)
  create(@Body() dto: CreateTransferReqDto): Promise<TransferRes> {
    return this.transfers.create(dto);
  }

  @Get()
  @RequireRoles(...VIEW)
  list(@Query() query: ListTransfersReqDto): Promise<Page<TransferRowRes>> {
    return this.transfers.list(query);
  }

  @Get(':id')
  @RequireRoles(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TransferRes> {
    return this.transfers.get(id);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  ship(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.transfers.ship(id, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferReqDto,
  ) {
    return this.transfers.receive(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.transfers.cancel(id, dto);
  }
}

@ApiTags('stock-takes')
@ApiBearerAuth()
@Controller('api/v1/stock-takes')
export class StockTakesController {
  constructor(private readonly takes: StockTakesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITE)
  create(@Body() dto: CreateStockTakeReqDto): Promise<TakeRes> {
    return this.takes.create(dto);
  }

  @Get()
  @RequireRoles(...VIEW)
  list(@Query() query: ListTakesReqDto): Promise<Page<TakeRowRes>> {
    return this.takes.list(query);
  }

  @Get(':id')
  @RequireRoles(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TakeRes> {
    return this.takes.get(id);
  }

  @Patch(':id/items')
  @RequireRoles(...WRITE)
  updateItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTakeItemsReqDto,
  ) {
    return this.takes.updateItems(id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.takes.complete(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.takes.cancel(id, dto);
  }
}

@ApiTags('stock-issues')
@ApiBearerAuth()
@Controller('api/v1/stock-issues')
export class StockIssuesController {
  constructor(private readonly issues: StockIssuesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITE)
  create(@Body() dto: CreateIssueReqDto): Promise<IssueRes> {
    return this.issues.create(dto);
  }

  @Get()
  @RequireRoles(...VIEW)
  list(@Query() query: ListIssuesReqDto): Promise<Page<IssueRowRes>> {
    return this.issues.list(query);
  }

  @Get(':id')
  @RequireRoles(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<IssueRes> {
    return this.issues.get(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.issues.approve(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
  ) {
    return this.issues.cancel(id, dto);
  }
}
