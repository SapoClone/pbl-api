import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { isSyncJobWorkerEnabled } from '../../config/integration.config';
import { SyncJobsService } from './sync-jobs.service';

const EVERY_MS = 5 * 1000;
const TENANTS_PER_RUN = 50;

/**
 * Runs the queued sync jobs (webhook orders, polls, stock pushes, retries, expired leases) in the background, so a
 * webhook can answer 200 at once and the work still happens (SRS UC-03). Several replicas are fine: jobs are claimed
 * with SKIP LOCKED and a lease, and a crashed worker's lease expires.
 */
@Injectable()
export class SyncJobWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SyncJobWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly syncJobs: SyncJobsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!isSyncJobWorkerEnabled()) return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the stores with jobs due. Returns how many jobs it ran. */
  async run(): Promise<number> {
    if (this.running) return 0; // a slow pass is still going
    this.running = true;
    let processed = 0;
    try {
      for (const tenantId of await this.tenantsWithDueJobs()) {
        try {
          const { claimedCount } = await this.syncJobs.claimAndProcessBatch({
            tenantId,
            workerId: this.workerId,
          });
          processed += claimedCount;
        } catch (error) {
          this.logger.error(
            `Sync jobs of tenant ${tenantId} failed: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
      if (processed > 0) this.logger.log(`Ran ${processed} sync job(s)`);
    } catch (error) {
      this.logger.error(
        `Finding due sync jobs failed: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.running = false;
    }
    return processed;
  }

  /** The same due condition as claimAndProcessBatch, across stores (sync_job_scheduler_select_policy). */
  private async tenantsWithDueJobs(): Promise<string[]> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.sync_job_scheduler', 'on', true)`);
      const rows: Array<{ tenant_id: string }> = await em.query(
        `
        SELECT DISTINCT tenant_id
        FROM ${qualifiedTable(em.connection, 'sync_jobs')}
        WHERE (status IN ('PENDING', 'RETRY_SCHEDULED') AND next_retry_at <= now())
           OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now())
        LIMIT $1
        `,
        [TENANTS_PER_RUN],
      );
      return rows.map((r) => r.tenant_id);
    });
  }
}
