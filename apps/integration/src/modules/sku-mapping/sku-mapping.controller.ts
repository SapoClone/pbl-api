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
import { AuthenticatedContext, CurrentContext, Permissions } from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { CreateSkuMappingDto, UpdateSkuMappingDto } from './sku-mapping.dto';
import { SkuMappingService } from './sku-mapping.service';

@ApiTags('integration-sku-mappings')
@ApiBearerAuth()
@Controller('api/v1/integrations/sku-mappings')
export class SkuMappingController {
  constructor(private readonly skuMappingService: SkuMappingService) {}

  @Post()
  @Permissions('integration.mapping.manage')
  @ApiOperation({
    summary: 'Create an external-to-internal Catalog variant SKU mapping',
  })
  async createMapping(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: CreateSkuMappingDto,
  ) {
    try {
      return await this.skuMappingService.createMapping(ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @Permissions('integration.mapping.read')
  @ApiOperation({ summary: 'List SKU mappings for tenant' })
  async listMappings(
    @Query('connectionId') connectionId?: string,
    @Query('internalVariantId') internalVariantId?: string,
    @Query('status') status?: string,
  ) {
    try {
      return await this.skuMappingService.listMappings({
        connectionId,
        internalVariantId,
        status,
      });
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @Permissions('integration.mapping.read')
  @ApiOperation({ summary: 'Get SKU mapping by ID' })
  async getMapping(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.skuMappingService.getMappingById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Patch(':id')
  @Permissions('integration.mapping.manage')
  @ApiOperation({
    summary:
      'Update SKU mapping and increment mapping_version (preserving historical order snapshots)',
  })
  async updateMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: UpdateSkuMappingDto,
  ) {
    try {
      return await this.skuMappingService.updateMapping(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Delete(':id')
  @Permissions('integration.mapping.manage')
  @ApiOperation({ summary: 'Delete SKU mapping' })
  async deleteMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      return await this.skuMappingService.deleteMapping(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
