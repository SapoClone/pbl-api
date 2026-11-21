import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequirePlatformAdmin } from '@pbl/auth';
import type { Response } from 'express';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import {
  AdminDisconnectDto,
  ListAdminConnectionsQueryDto,
  ListSyncHistoryQueryDto,
  ListWebhookEventsQueryDto,
} from './admin-integration.dto';
import { AdminIntegrationService } from './admin-integration.service';

/**
 * Platform-admin ("Tich hop") routes: every handler is behind `@RequirePlatformAdmin()` (super_admin and admin), so a
 * store token answers 403. Gateway path `/integration/api/v1/admin/...`.
 */
@ApiTags('integration-admin')
@ApiBearerAuth()
@RequirePlatformAdmin()
@Controller('api/v1/admin')
export class AdminIntegrationController {
  constructor(private readonly admin: AdminIntegrationService) {}

  @Get('connections')
  @ApiOperation({
    summary: 'List channel connections of every store, with counts by status',
  })
  async listConnections(@Query() query: ListAdminConnectionsQueryDto) {
    try {
      return await this.admin.listConnections(query);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('connections/:id')
  @ApiOperation({ summary: 'Connection detail with stats (never a token)' })
  async getConnection(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.admin.getConnection(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('sync-history')
  @ApiOperation({ summary: 'Sync jobs of every store (flat, filterable)' })
  async listSyncHistory(@Query() query: ListSyncHistoryQueryDto) {
    try {
      return await this.admin.listSyncHistory(query);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('webhook-events')
  @ApiOperation({ summary: 'Received webhook events (never the raw payload)' })
  async listWebhookEvents(@Query() query: ListWebhookEventsQueryDto) {
    try {
      return await this.admin.listWebhookEvents(query);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('connections/:id/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the connection health probe now (changes no state)',
  })
  async check(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.admin.checkConnection(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('connections/:id/disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({
    summary:
      'Disconnect a connection as a platform admin (reason required; 400 CHANNEL_CONNECTION_ALREADY_DISCONNECTED)',
  })
  async disconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDisconnectDto,
    @CurrentUser('id') adminId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      // the admin's display name is not in the token; the event carries `name: null` (see the guide)
      const { replayed, connection } = await this.admin.disconnect({
        id,
        reason: dto.reason,
        admin: { id: adminId, name: null },
        idempotencyKey: idempotencyKey?.slice(0, 128) || undefined,
      });
      if (replayed) res.setHeader('Idempotency-Replayed', 'true');
      return connection;
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
