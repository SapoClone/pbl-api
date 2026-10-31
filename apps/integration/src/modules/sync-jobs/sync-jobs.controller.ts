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
import { randomUUID } from 'node:crypto';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { RetrySyncJobDto, TriggerConnectionSyncDto } from './sync-jobs.dto';
import { SyncJobsService } from './sync-jobs.service';

@ApiTags('integration-sync-jobs')
@ApiBearerAuth()
@Controller('api/v1/integrations')
export class SyncJobsController {
  constructor(private readonly syncJobsService: SyncJobsService) {}

  @Post('connections/:id/sync/orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('integration.order_sync.execute')
  @ApiOperation({
    summary: 'Enqueue incremental order synchronization job for a connection',
  })
  async triggerOrderSync(
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      const enqueued = await this.syncJobsService.enqueueSyncJob({
        tenantId: ctx.tenantId,
        connectionId,
        jobType: dto.externalOrderId ? 'ORDER_IMPORT' : 'ORDER_POLL',
        idempotencyKey:
          dto.idempotencyKey ??
          `manual-ord-sync:${connectionId}:${dto.externalOrderId ?? randomUUID()}`,
        payload: dto.externalOrderId
          ? { externalOrderId: dto.externalOrderId }
          : {},
      });
      if (dto.executeImmediately) {
        const executed = await this.syncJobsService.executeJobById(
          ctx.tenantId,
          enqueued.job.id,
          ctx.userId,
        );
        return { job: executed, deduplicated: enqueued.deduplicated };
      }
      return enqueued;
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('connections/:id/sync/inventory')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('integration.inventory_sync.execute')
  @ApiOperation({
    summary: 'Enqueue inventory availability publication job for a connection',
  })
  async triggerInventorySync(
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      const enqueued = await this.syncJobsService.enqueueSyncJob({
        tenantId: ctx.tenantId,
        connectionId,
        jobType: 'INVENTORY_PUBLICATION',
        idempotencyKey:
          dto.idempotencyKey ??
          `manual-inv-sync:${connectionId}:${randomUUID()}`,
        payload: {},
      });
      if (dto.executeImmediately) {
        const executed = await this.syncJobsService.executeJobById(
          ctx.tenantId,
          enqueued.job.id,
          ctx.userId,
        );
        return { job: executed, deduplicated: enqueued.deduplicated };
      }
      return enqueued;
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('connections/:id/sync/products')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('integration.product_sync.execute')
  @ApiOperation({
    summary: 'Enqueue product listing discovery and mapping sync job',
  })
  async triggerProductSync(
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      const enqueued = await this.syncJobsService.enqueueSyncJob({
        tenantId: ctx.tenantId,
        connectionId,
        jobType: 'PRODUCT_MAPPING_SYNC',
        idempotencyKey:
          dto.idempotencyKey ??
          `manual-prd-sync:${connectionId}:${randomUUID()}`,
        payload: {},
      });
      if (dto.executeImmediately) {
        const executed = await this.syncJobsService.executeJobById(
          ctx.tenantId,
          enqueued.job.id,
          ctx.userId,
        );
        return { job: executed, deduplicated: enqueued.deduplicated };
      }
      return enqueued;
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('sync-jobs')
  @Permissions('integration.jobs.read')
  @ApiOperation({ summary: 'List background synchronization jobs' })
  async listSyncJobs(
    @Query('connectionId') connectionId?: string,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ) {
    try {
      return await this.syncJobsService.listSyncJobs({
        connectionId,
        status,
        jobType,
      });
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('sync-jobs/:id')
  @Permissions('integration.jobs.read')
  @ApiOperation({ summary: 'Get synchronization job details' })
  async getSyncJob(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.syncJobsService.getSyncJobById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('sync-jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('integration.jobs.retry')
  @ApiOperation({
    summary: 'Replay a failed or dead-lettered synchronization job',
  })
  async retrySyncJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: RetrySyncJobDto,
  ) {
    try {
      return await this.syncJobsService.retrySyncJob(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
