import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import {
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  ReceivePurchaseOrderDto,
  UpdateSupplierDto,
} from './procurement.dto';
import { ProcurementService } from './procurement.service';

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('api/v1')
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Post('suppliers')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a supplier' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created supplier' })
  async createSupplier(@Body() dto: CreateSupplierDto) {
    try {
      return await this.procurement.createSupplier(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('suppliers')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List or search suppliers' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of suppliers' })
  async listSuppliers(
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.procurement.listSuppliers(q, status);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Patch('suppliers/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Update or deactivate a supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated supplier' })
  async updateSupplier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    try {
      return await this.procurement.updateSupplier(id, dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({ summary: 'Create a purchase order (DRAFT)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created purchase order',
  })
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    try {
      return await this.procurement.createPurchaseOrder(dto);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('purchase-orders')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of purchase orders',
  })
  async listPurchaseOrders(
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.procurement.listPurchaseOrders(supplierId, status);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Get('purchase-orders/:id')
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
  @ApiOperation({ summary: 'Get purchase order details by ID' })
  @ApiParam({ name: 'id', description: 'Purchase order UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Purchase order details',
  })
  async getPurchaseOrderById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.procurement.getPurchaseOrderById(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('purchase-orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary:
      'Approve a DRAFT purchase order and emit inventory.purchase_order.approved',
  })
  @ApiParam({ name: 'id', description: 'Purchase order UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Approved purchase order',
  })
  async approvePurchaseOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return await this.procurement.approvePurchaseOrder(id);
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(ROLES.OWNER, ROLES.MANAGER)
  @ApiOperation({
    summary:
      'Receive goods against an APPROVED or PARTIALLY_RECEIVED purchase order',
    description:
      'Validates remaining ordered quantities, creates and posts a linked StockReceipt, updates weighted-average cost on stock_balance, and transitions the PO to PARTIALLY_RECEIVED or RECEIVED.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiParam({ name: 'id', description: 'Purchase order UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated purchase order and posted receipt',
  })
  async receivePurchaseOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto?: ReceivePurchaseOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    try {
      return await this.procurement.receivePurchaseOrder(
        id,
        dto,
        idempotencyKey,
      );
    } catch (error) {
      rethrowInventoryHttpError(error);
    }
  }
}
