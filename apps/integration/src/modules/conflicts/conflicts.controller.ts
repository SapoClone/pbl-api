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
import {
  AllowedBranches,
  AuthenticatedContext,
  CurrentContext,
  RequirePermission,
} from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { BranchScopeService } from '../branch-scope/branch-scope.service';
import { ResolveSyncConflictDto, RetrySyncConflictDto } from './conflicts.dto';
import { ConflictsService } from './conflicts.service';

@ApiTags('integration-conflicts')
@ApiBearerAuth()
@Controller('api/v1/integrations/conflicts')
export class ConflictsController {
  constructor(
    private readonly conflictsService: ConflictsService,
    private readonly scope: BranchScopeService,
  ) {}

  @Get()
  @RequirePermission('channels.view')
  @ApiOperation({
    summary: 'List SKU mapping, stock shortage, and order state conflicts',
  })
  async listConflicts(
    @AllowedBranches() branches: string[] | null,
    @Query('connectionId') connectionId?: string,
    @Query('status') status?: string,
    @Query('conflictType') conflictType?: string,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
      return await this.scope.filterRows(
        branches,
        await this.conflictsService.listConflicts({
          connectionId,
          status,
          conflictType,
        }),
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'Get synchronization conflict details' })
  async getConflict(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertConflict(branches, id);
      return await this.conflictsService.getConflictById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary:
      'Resolve a synchronization conflict and optionally map SKU + retry',
  })
  async resolveConflict(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: ResolveSyncConflictDto,
  ) {
    try {
      await this.scope.assertConflict(branches, id);
      return await this.conflictsService.resolveConflict(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Retry order import after resolving SKU mapping or stock conflict',
  })
  async retryConflict(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() _dto: RetrySyncConflictDto,
  ) {
    try {
      await this.scope.assertConflict(branches, id);
      return await this.conflictsService.retryConflict(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
