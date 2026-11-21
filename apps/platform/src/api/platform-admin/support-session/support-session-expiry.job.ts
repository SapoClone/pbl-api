import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SupportSessionService } from './support-session.service';

export const SUPPORT_SESSION_EXPIRY_EVERY_MS = 60 * 1000;

/**
 * Marks support sessions past their end as expired and emits `platform.support_session.ended` (`endedBy: 'expiry'`)
 * once for each. The token dies by itself at `exp`; this only closes the record. Safe on several replicas
 * (`SupportSessionService.expireDue` locks rows with SKIP LOCKED) and idempotent.
 */
@Injectable()
export class SupportSessionExpiryJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SupportSessionExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly supportSessions: SupportSessionService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.run(),
      SUPPORT_SESSION_EXPIRY_EVERY_MS,
    );
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      const closed = await this.supportSessions.expireDue();
      if (closed > 0) this.logger.log(`Support sessions expired: ${closed}`);
      return closed;
    } catch (error) {
      this.logger.error(
        `Support session expiry failed: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  }
}
