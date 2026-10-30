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
import { AuthUser, CurrentUser, RequireRoles } from '@pbl/auth';
import { ROLES } from '@pbl/contracts';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import { CreatePosDraftDto, PosQuoteDto, UpdatePosDraftDto } from './pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@RequireRoles(ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER)
@Controller('api/v1/pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('products/lookup')
  @ApiOperation({ summary: 'Lookup POS product variant by SKU or barcode' })
  lookupProduct(
    @Query('sku') sku?: string,
    @Query('barcode') barcode?: string,
    @Query('q') q?: string,
  ) {
    return this.posService.lookupProduct({ sku, barcode, q });
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate authoritative POS order quote & discount waterfall',
  })
  quoteOrder(@CurrentUser() user: AuthUser, @Body() dto: PosQuoteDto) {
    const primaryRole = user.roles?.[0] ?? 'cashier';
    return this.posService.quoteOrder(dto, primaryRole, user.roles ?? []);
  }

  @Post('drafts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a POS draft invoice (max 5 active per staff per branch)',
  })
  createDraft(
    @CurrentUser('id') staffId: string,
    @Body() dto: CreatePosDraftDto,
  ) {
    return this.posService.createDraft(staffId, dto);
  }

  @Get('drafts')
  @ApiOperation({ summary: 'List active POS draft invoices for current staff' })
  listDrafts(
    @CurrentUser('id') staffId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.posService.listDrafts(staffId, branchId);
  }

  @Patch('drafts/:id')
  @ApiOperation({ summary: 'Update an active POS draft invoice' })
  updateDraft(
    @CurrentUser('id') staffId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePosDraftDto,
  ) {
    return this.posService.updateDraft(staffId, id, dto);
  }

  @Delete('drafts/:id')
  @ApiOperation({ summary: 'Discard an active POS draft invoice' })
  discardDraft(
    @CurrentUser('id') staffId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.posService.discardDraft(staffId, id);
  }
}
