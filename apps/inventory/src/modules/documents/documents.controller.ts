import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { rethrowInventoryHttpError } from '../../presentation/inventory-http-error';
import {
  WarehouseDocument,
  WarehouseScopeService,
} from '../../scope/warehouse-scope';
import {
  ListPurchaseOrdersQueryDto,
  ListSuppliersDirectoryQueryDto,
  PurchaseOrderFilterQueryDto,
  PurchaseOrderSummaryQueryDto,
  ReasonDto,
} from './documents.dto';
import { DocumentsService } from './documents.service';

const uuid = new ParseUUIDPipe();

/**
 * Cancel and approval steps, supplier detail and delete, purchasing views.
 * Registered before the controllers that own `purchase-orders/:id` and
 * `suppliers/:id`, so `summary`, `export` and `directory` are not read as ids.
 */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('api/v1')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly scope: WarehouseScopeService,
  ) {}

  private async inScope(
    branches: string[] | null,
    table: WarehouseDocument,
    id: string,
  ) {
    await this.scope.assertDocument(branches, table, id);
  }

  // ---- stock receipts

  @Post('stock-receipts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.create')
  @ApiOperation({ summary: 'Send a draft receipt for approval' })
  async submitReceipt(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_receipt', id);
      return await this.docs.submitReceipt(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('stock-receipts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  @ApiOperation({
    summary: 'Approve a pending receipt: posts the stock',
    description: 'Same posting as POST :id/post, from PENDING_APPROVAL only.',
  })
  async approveReceipt(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_receipt', id);
      return await this.docs.approveReceipt(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('stock-receipts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.approve')
  @ApiOperation({ summary: 'Send a pending receipt back to draft' })
  async rejectReceipt(
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_receipt', id);
      return await this.docs.rejectReceipt(id, dto.reason);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('stock-receipts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({ summary: 'Cancel a draft or pending receipt' })
  async cancelReceipt(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_receipt', id);
      return await this.docs.cancelReceipt(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  // ---- cancel of the other documents

  @Post('stock-issues/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({ summary: 'Cancel a draft stock issue' })
  async cancelIssue(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_issue', id);
      return await this.docs.cancelIssue(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('stock-transfers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({
    summary: 'Cancel a draft transfer',
    description:
      'A dispatched transfer answers 409 (returning stock is not built).',
  })
  async cancelTransfer(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.scope.assertTransfer(branches, id, 'from');
      return await this.docs.cancelTransfer(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('stocktakes/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.update')
  @ApiOperation({ summary: 'Cancel a stock take that is not approved' })
  async cancelStocktake(
    @Param('id', uuid) id: string,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'stock_take', id);
      return await this.docs.cancelStocktake(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  // ---- suppliers

  @Get('suppliers/directory')
  @RequirePermission('purchasing.view')
  @ApiOperation({
    summary: 'Suppliers screen list (contract GET /suppliers)',
    description:
      'Paginated, phone masked, with openPurchaseOrderCount and debtBalance.',
  })
  async suppliersDirectory(@Query() query: ListSuppliersDirectoryQueryDto) {
    try {
      return await this.docs.suppliersDirectory(query);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Get('suppliers/:id')
  @RequirePermission('purchasing.view')
  @ApiOperation({ summary: 'Supplier detail with the full phone and balances' })
  async supplier(@Param('id', uuid) id: string) {
    try {
      return await this.docs.supplierDetail(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Delete('suppliers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('purchasing.delete')
  @ApiOperation({ summary: 'Soft-delete a supplier without open POs or debt' })
  async deleteSupplier(@Param('id', uuid) id: string): Promise<void> {
    try {
      await this.docs.deleteSupplier(id);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  // ---- purchase orders

  @Get('purchase-orders/directory')
  @RequirePermission('purchasing.view')
  @ApiOperation({
    summary: 'Purchasing screen list (contract GET /purchase-orders)',
  })
  async poDirectory(
    @Query() query: ListPurchaseOrdersQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.docs.purchaseOrdersDirectory(query, branches);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Get('purchase-orders/summary')
  @RequirePermission('purchasing.view')
  @ApiOperation({ summary: 'Purchasing KPI cards' })
  async poSummary(
    @Query() query: PurchaseOrderSummaryQueryDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.docs.purchaseOrdersSummary(query, branches);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Get('purchase-orders/export')
  @RequirePermission('purchasing.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="purchase-orders.csv"')
  @ApiOperation({ summary: 'Purchase orders as CSV, same filters as the list' })
  async poExport(
    @Query() query: PurchaseOrderFilterQueryDto,
    @AllowedBranches() branches: string[] | null,
  ): Promise<string> {
    try {
      this.assertBranch(branches, query.branchId);
      return await this.docs.purchaseOrdersCsv(query, branches);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('purchasing.update')
  @ApiOperation({ summary: 'Cancel a PO before anything is received' })
  async cancelPo(
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
    @AllowedBranches() branches: string[] | null,
  ) {
    try {
      await this.inScope(branches, 'purchase_order', id);
      return await this.docs.cancelPurchaseOrder(id, dto.reason);
    } catch (e) {
      rethrowInventoryHttpError(e);
    }
  }

  private assertBranch(
    branches: string[] | null,
    branchId: string | undefined,
  ): void {
    if (branchId) this.scope.assertBranch(branches, branchId);
  }
}
