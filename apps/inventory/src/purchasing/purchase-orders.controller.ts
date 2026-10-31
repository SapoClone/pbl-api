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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import type { Response } from 'express';
import { Page } from '../common/sql';
import {
  CreatePaymentReqDto,
  CreatePurchaseOrderReqDto,
  ExportPurchaseOrdersReqDto,
  PurchaseOrderActionReqDto,
  PurchaseOrderFilterDto,
  PurchaseOrderSummaryReqDto,
  UpdatePurchaseOrderReqDto,
} from './purchase-order.dto';
import {
  PurchaseOrderRes,
  PurchaseOrderRowRes,
  PurchaseOrdersService,
} from './purchase-orders.service';

/**
 * Permissions: `purchasing.view/create/update/approve`; branch scope applies (ADR-0020 §8).
 * Fixed paths before `:id`.
 */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('api/v1/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('purchasing.view')
  list(
    @Query() query: PurchaseOrderFilterDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<Page<PurchaseOrderRowRes>> {
    return this.orders.list(query, scope);
  }

  @Get('summary')
  @RequirePermission('purchasing.view')
  summary(
    @Query() query: PurchaseOrderSummaryReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.orders.summary(query, scope);
  }

  @Get('export')
  @RequirePermission('purchasing.view')
  async export(
    @Query() query: ExportPurchaseOrdersReqDto,
    @AllowedBranches() scope: string[] | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="purchase-orders.csv"',
    );
    return this.orders.exportCsv(query, scope);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('purchasing.create')
  create(
    @Body() dto: CreatePurchaseOrderReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<PurchaseOrderRes> {
    return this.orders.create(dto, scope);
  }

  @Get(':id')
  @RequirePermission('purchasing.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: string[] | null,
  ): Promise<PurchaseOrderRes> {
    return this.orders.get(id, scope);
  }

  @Patch(':id')
  @RequirePermission('purchasing.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderReqDto,
    @AllowedBranches() scope: string[] | null,
  ): Promise<PurchaseOrderRes> {
    return this.orders.update(id, dto, scope);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchasing.update')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.orders.act(id, 'submit', dto, scope);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchasing.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.orders.act(id, 'approve', dto, scope);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchasing.update')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.orders.act(id, 'cancel', dto, scope);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('purchasing.update')
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentReqDto,
    @AllowedBranches() scope: string[] | null,
  ) {
    return this.orders.pay(id, dto, scope);
  }
}
