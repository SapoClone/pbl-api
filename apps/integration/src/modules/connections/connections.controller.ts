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
import { AuthenticatedContext, CurrentContext, Permissions } from '@pbl/auth';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
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
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Post()
  @Permissions('integration.connection.create')
  @ApiOperation({
    summary:
      'Create a marketplace channel connection with encrypted credentials',
  })
  async createConnection(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: CreateChannelConnectionDto,
  ) {
    try {
      return await this.connectionsService.createConnection(ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get()
  @Permissions('integration.connection.read')
  @ApiOperation({
    summary: 'List tenant marketplace channel connections (tokens redacted)',
  })
  async listConnections() {
    try {
      return await this.connectionsService.listConnections();
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id')
  @Permissions('integration.connection.read')
  @ApiOperation({
    summary: 'Get channel connection details (tokens redacted)',
  })
  async getConnection(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.connectionsService.getConnectionById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get(':id/health')
  @Permissions('integration.connection.read')
  @ApiOperation({
    summary:
      'Get channel connection health, token expiry, circuit breaker, and capability matrix',
  })
  async getConnectionHealth(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.connectionsService.getConnectionHealth(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/authorize')
  @HttpCode(HttpStatus.OK)
  @Permissions('integration.connection.manage')
  @ApiOperation({
    summary: 'Initiate OAuth authorization flow or complete OAuth callback',
  })
  async authorizeConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: AuthorizeChannelConnectionDto,
  ) {
    try {
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
  @Permissions('integration.connection.manage')
  @ApiOperation({
    summary: 'Refresh connection access token using lease-coordinated CAS',
  })
  async refreshConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: RefreshConnectionTokenDto,
  ) {
    try {
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
  @Permissions('integration.connection.manage')
  @ApiOperation({ summary: 'Pause marketplace synchronization for connection' })
  async pauseConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      return await this.connectionsService.pauseConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Permissions('integration.connection.manage')
  @ApiOperation({
    summary: 'Resume marketplace synchronization for connection',
  })
  async resumeConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      return await this.connectionsService.resumeConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Delete(':id')
  @Permissions('integration.connection.disconnect')
  @ApiOperation({
    summary: 'Disconnect marketplace channel and wipe active tokens',
  })
  async disconnectConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
  ) {
    try {
      return await this.connectionsService.disconnectConnection(id, ctx.userId);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
