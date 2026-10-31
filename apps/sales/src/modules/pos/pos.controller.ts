import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreatePosDraftDto, PosQuoteDto, UpdatePosDraftDto } from './pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1/pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('products/lookup')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'Lookup POS product variant by SKU or barcode' })
  lookupProduct(
    @Query('sku') sku?: string,
    @Query('barcode') barcode?: string,
    @Query('q') q?: string,
  ) {
    return this.posService.lookupProduct({ sku, barcode, q });
  }

  @Post('quote')
  @RequirePermission('pos.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate authoritative POS order quote & discount waterfall',
  })
  quoteOrder(
    @CurrentUser() user: AuthUser,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: PosQuoteDto,
  ) {
    return this.posService.quoteOrder(dto, user.permissions, scope);
  }

  @Post('drafts')
  @RequirePermission('pos.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a POS draft invoice (max 5 active per staff per branch)',
  })
  createDraft(
    @CurrentUser('id') staffId: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CreatePosDraftDto,
  ) {
    return this.posService.createDraft(staffId, scope, dto);
  }

  @Get('drafts')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'List active POS draft invoices for current staff' })
  listDrafts(
    @CurrentUser('id') staffId: string,
    @AllowedBranches() scope: BranchScope,
    @Query('branchId') branchId?: string,
  ) {
    return this.posService.listDrafts(staffId, scope, branchId);
  }

  @Patch('drafts/:id')
  @RequirePermission('pos.update')
  @ApiOperation({ summary: 'Update an active POS draft invoice' })
  updateDraft(
    @CurrentUser('id') staffId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: UpdatePosDraftDto,
  ) {
    return this.posService.updateDraft(staffId, id, scope, dto);
  }

  @Delete('drafts/:id')
  @RequirePermission('pos.update')
  @ApiOperation({ summary: 'Discard an active POS draft invoice' })
  discardDraft(
    @CurrentUser('id') staffId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.posService.discardDraft(staffId, id, scope);
  }
}
