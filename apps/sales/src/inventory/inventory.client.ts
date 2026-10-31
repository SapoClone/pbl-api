import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InternalHttpClient } from '@pbl/common';
import {
  CreateWarehouseReservationRequest,
  StockLine,
  StockShortage,
  WarehouseReservationResponse,
  WarehouseStockShortage,
} from '@pbl/contracts';

import { isTestEnvironment, readInternalToken } from '../config/sales.config';

export const InventoryClientErrorCode = {
  UNAVAILABLE: 'S005',
  TIMEOUT_RECOVERY_PENDING: 'S006',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type WarehouseReservationClientResult =
  | {
      status: 'HELD';
      reservation: WarehouseReservationResponse;
      replayed: boolean;
    }
  | {
      status: 'INSUFFICIENT_STOCK';
      shortages: WarehouseStockShortage[];
    };

/** The call is short: a sale waiting on stock is a customer waiting at the counter */
const TIMEOUT_MS = 3000;
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 10_000;

/**
 * Asks `inventory` to hold stock before an order is created (ADR-0010, ADR-0012):
 * the one synchronous call between services. It forwards the caller's token (the
 * tenant comes from it, never from a header) and sends the shared service token
 * `x-internal-token` (`INTERNAL_S2S_TOKEN`) on every internal route, so inventory
 * verifies the caller and enforces idempotency. When inventory cannot be reached the sale is refused or placed in
 * `RECOVERY_PENDING` (fail closed), and after a run of failures the breaker stops
 * calling for a few seconds so requests fail fast instead of queueing.
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
        {
          timeout: TIMEOUT_MS,
          headers: this.internalHeaders(),
          validateStatus: (status) => status < 500,
        },
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
        headers: this.internalHeaders(),
      });
    } catch (error) {
      this.logger.warn(
        `Could not release the hold of order ${orderId}; it will expire: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Internal warehouse reservation call (`POST /internal/v1/reservations`).
   * Uses a deterministic `Idempotency-Key` so timeout recovery can safely replay
   * the exact same request without double-reserving stock (ADR-0012).
   */
  async reserveWarehouseStock(
    idempotencyKey: string,
    req: CreateWarehouseReservationRequest,
  ): Promise<WarehouseReservationClientResult> {
    this.assertClosed();
    let response;
    try {
      response = await this.http.post<
        WarehouseReservationResponse & {
          errorCode?: string;
          details?: WarehouseStockShortage[];
        }
      >('/internal/v1/reservations', req, {
        timeout: TIMEOUT_MS,
        headers: this.internalHeaders({ 'Idempotency-Key': idempotencyKey }),
        validateStatus: (status) => status < 500,
      });
    } catch (error) {
      throw this.failed(error);
    }

    if (response.status === 200 || response.status === 201) {
      this.failures = 0;
      return {
        status: 'HELD',
        reservation: response.data,
        replayed: response.status === 200,
      };
    }

    if (response.status === 409) {
      this.failures = 0;
      const errorCode = response.data?.errorCode;
      if (errorCode === InventoryClientErrorCode.IDEMPOTENCY_CONFLICT) {
        throw new ConflictException({
          errorCode: InventoryClientErrorCode.IDEMPOTENCY_CONFLICT,
          message:
            'Idempotency-Key already used with a different reservation payload',
        });
      }
      const details = response.data?.details;
      return {
        status: 'INSUFFICIENT_STOCK',
        shortages: Array.isArray(details) ? details : [],
      };
    }

    throw this.failed(
      new Error(`inventory reservation answered ${response.status}`),
      false,
    );
  }

  async getWarehouseReservation(
    reservationId: string,
  ): Promise<WarehouseReservationResponse | null> {
    const response = await this.http.get<WarehouseReservationResponse>(
      `/internal/v1/reservations/${reservationId}`,
      {
        timeout: TIMEOUT_MS,
        headers: this.internalHeaders(),
        validateStatus: (status) => status < 500,
      },
    );
    if (response.status === 200) {
      return response.data;
    }
    if (response.status === 404) {
      return null;
    }
    throw this.failed(
      new Error(`inventory reservation lookup answered ${response.status}`),
      false,
    );
  }

  async commitWarehouseReservation(
    reservationId: string,
  ): Promise<WarehouseReservationResponse> {
    const response = await this.http.post<WarehouseReservationResponse>(
      `/internal/v1/reservations/${reservationId}/commit`,
      {},
      {
        timeout: TIMEOUT_MS,
        headers: this.internalHeaders(),
        validateStatus: (status) => status < 500,
      },
    );
    if (response.status === 200) {
      return response.data;
    }
    throw this.failed(
      new Error(`inventory reservation commit answered ${response.status}`),
      false,
    );
  }

  async getWarehouseReservationByKey(
    idempotencyKey: string,
    callerService = 'sales',
  ): Promise<WarehouseReservationResponse | null> {
    this.assertClosed();
    let response;
    try {
      response = await this.http.get<WarehouseReservationResponse>(
        `/internal/v1/reservations/by-key/${encodeURIComponent(idempotencyKey)}`,
        {
          timeout: TIMEOUT_MS,
          headers: this.internalHeaders(),
          params: { callerService },
          validateStatus: (status) => status < 500,
        },
      );
    } catch (error) {
      throw this.failed(error);
    }
    if (response.status === 200) {
      this.failures = 0;
      return response.data;
    }
    if (response.status === 404) {
      this.failures = 0;
      return null;
    }
    throw this.failed(
      new Error(
        `inventory reservation by-key lookup answered ${response.status}`,
      ),
      false,
    );
  }

  async receiveReturnedStock(req: {
    warehouseId: string;
    returnId: string;
    code?: string;
    items: { skuId: string; qty: string; unitCost?: string }[];
  }): Promise<{ receiptId: string }> {
    this.assertClosed();
    let response;
    try {
      response = await this.http.post<{ id: string }>(
        '/api/v1/stock-receipts',
        {
          warehouseId: req.warehouseId,
          code: req.code,
          sourceType: 'RETURN',
          sourceRefId: req.returnId,
          autoPost: true,
          items: req.items.map((item) => ({
            skuId: item.skuId,
            qty: item.qty,
            unitCost: item.unitCost ?? '0.00',
          })),
        },
        {
          timeout: TIMEOUT_MS,
          validateStatus: (status) => status < 500,
        },
      );
    } catch (error) {
      throw this.failed(error);
    }
    if (response.status === 200 || response.status === 201) {
      this.failures = 0;
      return { receiptId: response.data.id };
    }
    throw this.failed(
      new Error(`inventory return stock receipt answered ${response.status}`),
      false,
    );
  }

  async releaseWarehouseReservation(
    reservationId: string,
    reason?: string,
  ): Promise<WarehouseReservationResponse | null> {
    try {
      const response = await this.http.post<WarehouseReservationResponse>(
        `/internal/v1/reservations/${reservationId}/release`,
        reason ? { reason } : {},
        {
          timeout: TIMEOUT_MS,
          headers: this.internalHeaders(),
          validateStatus: (status) => status < 500,
        },
      );
      return response.status === 200 ? response.data : null;
    } catch (error) {
      this.logger.warn(
        `Could not release reservation ${reservationId}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Headers of a call to an internal route: the shared service token. Without
   * `INTERNAL_S2S_TOKEN` the call is refused here (fail closed), except under
   * `NODE_ENV=test`. The tenant never travels in a header: the callee takes it
   * from the forwarded bearer token.
   */
  private internalHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const token = readInternalToken();
    if (!token) {
      if (isTestEnvironment()) return extra;
      throw this.failed(new Error('INTERNAL_S2S_TOKEN is not set'), false);
    }
    return { ...extra, 'x-internal-token': token };
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
