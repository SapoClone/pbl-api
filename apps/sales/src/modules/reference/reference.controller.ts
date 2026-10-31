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
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowedBranches, RequirePermission } from '@pbl/auth';
import { BranchScope } from '../../presentation/access';
import { SalesExceptionFilter } from '../../presentation/sales-http-error';
import {
  CreateRegisterDto,
  CreateSalesChannelDto,
  ListRegistersQueryDto,
  UpdateRegisterDto,
  UpdateSalesChannelDto,
} from './reference.dto';
import { ReferenceService } from './reference.service';

/** Sales channels, shipping providers and POS registers (screen contract) */
@ApiTags('reference')
@ApiBearerAuth()
@UseFilters(SalesExceptionFilter)
@Controller('api/v1')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('sales-channels')
  @RequirePermission('orders.view')
  @ApiOperation({
    summary: 'Sales channels of the store (seeded on first read)',
  })
  listChannels() {
    return this.reference.listChannels();
  }

  @Post('sales-channels')
  @RequirePermission('channels.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a manual sales channel' })
  createChannel(@Body() dto: CreateSalesChannelDto) {
    return this.reference.createChannel(dto);
  }

  @Patch('sales-channels/:id')
  @RequirePermission('channels.update')
  @ApiOperation({ summary: 'Rename or disable a sales channel' })
  updateChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesChannelDto,
  ) {
    return this.reference.updateChannel(id, dto);
  }

  @Get('shipping-providers')
  @RequirePermission('orders.view')
  @ApiOperation({ summary: 'Shipping providers (projection of finance)' })
  listProviders() {
    return this.reference.listShippingProviders();
  }

  @Get('registers')
  @RequirePermission('pos.view')
  @ApiOperation({ summary: 'POS registers of a branch, with their open shift' })
  listRegisters(
    @Query() query: ListRegistersQueryDto,
    @AllowedBranches() scope: BranchScope,
  ) {
    return this.reference.listRegisters(query.branchId, scope);
  }

  @Post('registers')
  @RequirePermission('pos.update')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a POS register to a branch' })
  createRegister(
    @AllowedBranches() scope: BranchScope,
    @Body() dto: CreateRegisterDto,
  ) {
    return this.reference.createRegister(scope, dto);
  }

  @Patch('registers/:id')
  @RequirePermission('pos.update')
  @ApiOperation({ summary: 'Rename or deactivate a POS register' })
  updateRegister(
    @Param('id', ParseUUIDPipe) id: string,
    @AllowedBranches() scope: BranchScope,
    @Body() dto: UpdateRegisterDto,
  ) {
    return this.reference.updateRegister(id, scope, dto);
  }
}
