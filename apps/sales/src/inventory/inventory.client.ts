import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InternalHttpClient } from '@pbl/common';
import { StockLine, StockShortage } from '@pbl/contracts';

export const InventoryClientErrorCode = { UNAVAILABLE: 'S005' } as const;

/** The call is short: a sale waiting on stock is a customer waiting at the counter */
const TIMEOUT_MS = 3000;
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 10_000;

/**
 * Asks `inventory` to hold stock before an order is created (ADR-0010): the one
 * synchronous call between services. It forwards the caller's token, so inventory
 * verifies the user and takes the tenant from it. When inventory cannot be
 * reached the sale is refused (fail closed), and after a run of failures the
 * breaker stops calling for a few seconds so requests fail fast instead of queueing.
 */
@Injectable()
export class InventoryClient {
  private readonly logger = new Logger(InventoryClient.name);
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly http: InternalHttpClient) {}

  /**
   * Holds every line or nothing. Returns null when the stock is held (or was held
   * for this order already) and the shortages when it is not.
   */
  async reserve(
    orderId: string,
    branchId: string,
    lines: StockLine[],
  ): Promise<StockShortage[] | null> {
    this.assertClosed();
    let response;
    try {
      response = await this.http.post(
        '/internal/reservations',
        { orderId, branchId, lines },
        { timeout: TIMEOUT_MS, validateStatus: (status) => status < 500 },
      );
    } catch (error) {
      throw this.failed(error);
    }

    if (response.status === 200 || response.status === 201) {
      this.failures = 0;
      return null;
    }
    if (response.status === 409) {
      this.failures = 0;
      const details = response.data?.details;
      return Array.isArray(details) ? (details as StockShortage[]) : [];
    }
    // 400, 401, 403 ...: sales cannot go on, and a retry will not change it
    throw this.failed(
      new Error(`inventory answered ${response.status}`),
      false,
    );
  }

  /** Gives the hold of an order back (best effort: an expiry job is the safety net) */
  async release(orderId: string): Promise<void> {
    try {
      await this.http.delete(`/internal/reservations/${orderId}`, {
        timeout: TIMEOUT_MS,
      });
    } catch (error) {
      this.logger.warn(
        `Could not release the hold of order ${orderId}; it will expire: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private assertClosed(): void {
    if (Date.now() < this.openUntil) {
      throw this.unavailable();
    }
  }

  /** Counts the failure, opens the breaker after a run of them, answers 503 */
  private failed(error: unknown, count = true): ServiceUnavailableException {
    if (count && ++this.failures >= BREAKER_THRESHOLD) {
      this.openUntil = Date.now() + BREAKER_OPEN_MS;
      this.failures = 0;
      this.logger.error(
        'Inventory keeps failing: calls are paused for a few seconds',
      );
    }
    this.logger.warn(
      `Inventory call failed: ${error instanceof Error ? error.message : error}`,
    );
    return this.unavailable();
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      errorCode: InventoryClientErrorCode.UNAVAILABLE,
      message: 'Stock cannot be checked right now, please try again',
    });
  }
}
