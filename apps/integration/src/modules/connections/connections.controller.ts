import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import {
  AuthorizeChannelConnectionDto,
  CreateChannelConnectionDto,
  RefreshConnectionTokenDto,
} from './connections.dto';
import { ConnectionsService } from './connections.service';

@ApiTags('integration-connections')
@ApiBearerAuth()
@Controller('api/v1/integrations/connections')
export class ConnectionsController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly scope: BranchScopeService,
  ) {}

  @Post()
  @RequirePermission('channels.create')
  @ApiOperation({
    summary:
      'Create a marketplace channel connection with encrypted credentials',
  })
  async createConnection(
    @AllowedBranches() branches: string[] | null,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: CreateChannelConnectionDto,
  ) {
    try {
      this.scope.assertBranch(branches, dto.branchId);
      return await this.connectionsService.createConnection(ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @RequirePermission('channels.view')
  @ApiOperation({
    summary: 'List tenant marketplace channel connections (tokens redacted)',
  })
  async listConnections(@AllowedBranches() branches: string[] | null) {
    try {
      const rows = await this.connectionsService.listConnections();
      return branches === null
        ? rows
        : rows.filter((c) => branches.includes(c.branchId));
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @RequirePermission('channels.view')
  @ApiOperation({
    summary: 'Get channel connection details (tokens redacted)',
  })
  async getConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.getConnectionById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id/health')
  @RequirePermission('channels.view')
  @ApiOperation({
    summary:
      'Get channel connection health, token expiry, circuit breaker, and capability matrix',
  })
  async getConnectionHealth(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.getConnectionHealth(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/authorize')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Initiate OAuth authorization flow or complete OAuth callback',
  })
  async authorizeConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: AuthorizeChannelConnectionDto,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.authorizeConnection(
        id,
        ctx.userId,
        dto,
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Refresh connection access token using lease-coordinated CAS',
  })
  async refreshConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: RefreshConnectionTokenDto,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.refreshCredentials(
        id,
        ctx.userId,
        dto,
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({ summary: 'Pause marketplace synchronization for connection' })
  async pauseConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.pauseConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Resume marketplace synchronization for connection',
  })
  async resumeConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.resumeConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Delete(':id')
  @RequirePermission('channels.delete')
  @ApiOperation({
    summary: 'Disconnect marketplace channel and wipe active tokens',
  })
  async disconnectConnection(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      await this.scope.assertConnection(branches, id);
      return await this.connectionsService.disconnectConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
