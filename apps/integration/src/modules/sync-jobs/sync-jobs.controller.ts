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
import { randomUUID } from 'node:crypto';
import { rethrowIntegrationHttpError } from '../../presentation/integration-http-error';
import { BranchScopeService } from '../branch-scope/branch-scope.service';
import { RetrySyncJobDto, TriggerConnectionSyncDto } from './sync-jobs.dto';
import { SyncJobsService } from './sync-jobs.service';

@ApiTags('integration-sync-jobs')
@ApiBearerAuth()
@Controller('api/v1/integrations')
export class SyncJobsController {
  constructor(
    private readonly syncJobsService: SyncJobsService,
    private readonly scope: BranchScopeService,
  ) {}

  @Post('connections/:id/sync/orders')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Enqueue incremental order synchronization job for a connection',
  })
  async triggerOrderSync(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
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
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Enqueue inventory availability publication job for a connection',
  })
  async triggerInventorySync(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
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
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Enqueue product listing discovery and mapping sync job',
  })
  async triggerProductSync(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) connectionId: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: TriggerConnectionSyncDto,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
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
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'List background synchronization jobs' })
  async listSyncJobs(
    @AllowedBranches() branches: string[] | null,
    @Query('connectionId') connectionId?: string,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ) {
    try {
      await this.scope.assertConnection(branches, connectionId);
      return await this.scope.filterRows(
        branches,
        await this.syncJobsService.listSyncJobs({
          connectionId,
          status,
          jobType,
        }),
      );
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Get('sync-jobs/:id')
  @RequirePermission('channels.view')
  @ApiOperation({ summary: 'Get synchronization job details' })
  async getSyncJob(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.scope.assertJob(branches, id);
      return await this.syncJobsService.getSyncJobById(id);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }

  @Post('sync-jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('channels.update')
  @ApiOperation({
    summary: 'Replay a failed or dead-lettered synchronization job',
  })
  async retrySyncJob(
    @AllowedBranches() branches: string[] | null,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: RetrySyncJobDto,
  ) {
    try {
      await this.scope.assertJob(branches, id);
      return await this.syncJobsService.retrySyncJob(id, ctx.userId, dto);
    } catch (error) {
      rethrowIntegrationHttpError(error);
    }
  }
}
