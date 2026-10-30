import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedContext, CurrentContext, Permissions } from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { ResolveSyncConflictDto, RetrySyncConflictDto } from './conflicts.dto';
import { ConflictsService } from './conflicts.service';

@ApiTags('integration-conflicts')
@ApiBearerAuth()
@Controller('api/v1/integrations/conflicts')
export class ConflictsController {
  constructor(private readonly conflictsService: ConflictsService) {}

  @Get()
  @Permissions('integration.conflict.read')
  @ApiOperation({
    summary: 'List SKU mapping, stock shortage, and order state conflicts',
  })
  async listConflicts(
    @Query('connectionId') connectionId?: string,
    @Query('status') status?: string,
    @Query('conflictType') conflictType?: string,
  ) {
    try {
      return await this.conflictsService.listConflicts({
        connectionId,
        status,
        conflictType,
      });
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @Permissions('integration.conflict.read')
  @ApiOperation({ summary: 'Get synchronization conflict details' })
  async getConflict(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.conflictsService.getConflictById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Permissions('integration.conflict.resolve')
  @ApiOperation({
    summary:
      'Resolve a synchronization conflict and optionally map SKU + retry',
  })
  async resolveConflict(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: ResolveSyncConflictDto,
  ) {
    try {
      return await this.conflictsService.resolveConflict(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('integration.conflict.resolve')
  @ApiOperation({
    summary: 'Retry order import after resolving SKU mapping or stock conflict',
  })
  async retryConflict(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() _dto: RetrySyncConflictDto,
  ) {
    try {
      return await this.conflictsService.retryConflict(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
