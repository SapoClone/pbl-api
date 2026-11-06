import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UploadsService } from './uploads.service';

const EVERY_MS = 10 * 60 * 1000;

/**
 * Deletes uploads that were never finished or never attached (expired PENDING rows, UPLOADED images older than 24 h)
 * from the object store and the table. Several replicas are fine: the service holds an advisory lock per run.
 */
@Injectable()
export class UploadsCleanupJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(UploadsCleanupJob.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly uploads: UploadsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      return await this.uploads.cleanupUnused();
    } catch (error) {
      this.logger.error(
        `Upload cleanup failed: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  }
}
