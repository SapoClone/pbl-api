import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowedBranches,
  AuthenticatedContext,
  CurrentContext,
  RequirePermission,
} from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { BranchScopeService } from '../branch-scope/branch-scope.service';
import { CreateSkuMappingDto, UpdateSkuMappingDto } from './sku-mapping.dto';
import { SkuMappingService } from './sku-mapping.service';

@ApiTags('integration-sku-mappings')
@ApiBearerAuth()
@Controller('api/v1/integrations/sku-mappings')
export class SkuMappingController {
  constructor(
    private readonly skuMappingService: SkuMappingService,
    private readonly scope: BranchScopeService,
  ) {}

  @Post()
  @RequirePermission('channels.create')
  @ApiOperation({
    summary: 'Create an external-to-internal Catalog variant SKU mapping',
  })
  async createMapping(
    @AllowedBranches() branches: string[] | null,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: CreateSkuMappingDto,
  ) {
    try {
      await this.scope.assertConnection(branches, dto.connectionId);
      return await this.skuMappingService.createMapping(ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'List SKU mappings for tenant' })
  async listMappings(
    @AllowedBranches() branches: string[] | null,
    @Query('connectionId') connectionId?: string,
    @Query('internalVariantId') internalVariantId?: string,
    @Query('status') status?: string,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
      return await this.scope.filterRows(
        branches,
        await this.skuMappingService.listMappings({
          connectionId,
          internalVariantId,
          status,
        }),
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'Get SKU mapping by ID' })
  async getMapping(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertMapping(branches, id);
      return await this.skuMappingService.getMappingById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Patch(':id')
  @RequirePermission('channels.update')
  @ApiOperation({
    summary:
      'Update SKU mapping and increment mapping_version (preserving historical order snapshots)',
  })
  async updateMapping(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: UpdateSkuMappingDto,
  ) {
    try {
      await this.scope.assertMapping(branches, id);
      return await this.skuMappingService.updateMapping(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Delete(':id')
  @RequirePermission('channels.delete')
  @ApiOperation({ summary: 'Delete SKU mapping' })
  async deleteMapping(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      await this.scope.assertMapping(branches, id);
      return await this.skuMappingService.deleteMapping(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
