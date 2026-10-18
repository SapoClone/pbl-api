import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';

const EVERY_MS = 60 * 1000;

/**
 * Gives back the stock of holds that were never completed (a crash between the
 * hold and the order), so stock cannot stay locked. Several replicas are fine:
 * rows are claimed with SKIP LOCKED.
 */
@Injectable()
export class ReservationExpiryJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReservationExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly reservations: ReservationsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      const expired = await this.reservations.expireDue();
      if (expired > 0) this.logger.log(`Expired ${expired} stock hold(s)`);
      return expired;
    } catch (error) {
      this.logger.error(
        `Expiring stock holds failed: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  }
}
