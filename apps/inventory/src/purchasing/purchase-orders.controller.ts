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
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
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
 * Contract permissions: `purchasing.view` = owner, manager, cashier;
 * `purchasing.create/update/approve` = owner, manager. Fixed paths before `:id`.
 */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('api/v1/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  list(
    @Query() query: PurchaseOrderFilterDto,
  ): Promise<Page<PurchaseOrderRowRes>> {
    return this.orders.list(query);
  }

  @Get('summary')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  summary(@Query() query: PurchaseOrderSummaryReqDto) {
    return this.orders.summary(query);
  }

  @Get('export')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  async export(
    @Query() query: ExportPurchaseOrdersReqDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="purchase-orders.csv"',
    );
    return this.orders.exportCsv(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  create(@Body() dto: CreatePurchaseOrderReqDto): Promise<PurchaseOrderRes> {
    return this.orders.create(dto);
  }

  @Get(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderRes> {
    return this.orders.get(id);
  }

  @Patch(':id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderReqDto,
  ): Promise<PurchaseOrderRes> {
    return this.orders.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
  ) {
    return this.orders.act(id, 'submit', dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
  ) {
    return this.orders.act(id, 'approve', dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseOrderActionReqDto,
  ) {
    return this.orders.act(id, 'cancel', dto);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentReqDto,
  ) {
    return this.orders.pay(id, dto);
  }
}
