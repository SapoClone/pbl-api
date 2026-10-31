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
import { AllowedBranches, RequirePermission } from '@pbl/auth';
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

/**
 * Permissions: `inventory.view/create/update/approve` (see each route). A document whose
 * branch is outside the caller's scope answers 404 (ADR-0012 §8).
 */
@ApiTags('stock-transfers')
@ApiBearerAuth()
@Controller('api/v1/stock-transfers')
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  create(
    @Body() dto: CreateTransferReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<TransferRes> {
    return this.transfers.create(dto, scope);
  }

  @Get()
  @RequirePermission('inventory.view')
  list(
    @Query() query: ListTransfersReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<TransferRowRes>> {
    return this.transfers.list(query, scope);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ): Promise<TransferRes> {
    return this.transfers.get(id, scope);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  ship(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.transfers.ship(id, dto, scope);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.transfers.receive(id, dto, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.transfers.cancel(id, dto, scope);
  }
}

@ApiTags('stock-takes')
@ApiBearerAuth()
@Controller('api/v1/stock-takes')
export class StockTakesController {
  constructor(private readonly takes: StockTakesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  create(
    @Body() dto: CreateStockTakeReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<TakeRes> {
    return this.takes.create(dto, scope);
  }

  @Get()
  @RequirePermission('inventory.view')
  list(
    @Query() query: ListTakesReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<TakeRowRes>> {
    return this.takes.list(query, scope);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ): Promise<TakeRes> {
    return this.takes.get(id, scope);
  }

  @Patch(':id/items')
  @RequirePermission('inventory.update')
  updateItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTakeItemsReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.takes.updateItems(id, dto, scope);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.takes.complete(id, dto, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.takes.cancel(id, dto, scope);
  }
}

@ApiTags('stock-issues')
@ApiBearerAuth()
@Controller('api/v1/stock-issues')
export class StockIssuesController {
  constructor(private readonly issues: StockIssuesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory.create')
  create(
    @Body() dto: CreateIssueReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<IssueRes> {
    return this.issues.create(dto, scope);
  }

  @Get()
  @RequirePermission('inventory.view')
  list(
    @Query() query: ListIssuesReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<IssueRowRes>> {
    return this.issues.list(query, scope);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ): Promise<IssueRes> {
    return this.issues.get(id, scope);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.issues.approve(id, dto, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.issues.cancel(id, dto, scope);
  }
}
