import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  MarketplaceProvider,
} from '../../domain/integration-domain';
import type {
  ExternalProductListingVariation,
  NormalizedExternalOrder,
} from '../../providers/contracts/provider.contracts';
import { ProviderRequestLogEntity } from '../persistence/integration.entities';

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
  capacity: number;
  refillPerSec: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  consecutiveFailures: number;
  openedAtMs: number;
  cooldownMs: number;
}

export interface ProviderFaultSimulationRule {
  mode: 'HTTP_429' | 'HTTP_503' | 'TIMEOUT_AFTER_REMOTE_WRITE' | 'AUTH_EXPIRED';
  remainingCount: number;
  retryAfterSeconds?: number;
}

@Injectable()
export class ProviderRateLimiterService {
  private readonly buckets = new Map<string, TokenBucketState>();
  private readonly circuits = new Map<string, CircuitBreakerState>();
  private readonly faultRules = new Map<string, ProviderFaultSimulationRule>();

  /**
   * Controlled simulator state for deterministic integration/fault/load testing
   * when live Shopee/Lazada partner credentials are not configured.
   */
  private readonly simulatedOrders = new Map<
    string,
    Map<string, NormalizedExternalOrder>
  >();
  private readonly simulatedRemoteStock = new Map<
    string,
    { quantity: number; stockVersion: number; updatedAt: Date }
  >();
  private readonly simulatedListings = new Map<
    string,
    ExternalProductListingVariation[]
  >();

  constructor(private readonly dataSource: DataSource) {}

  configureFaultRule(
    key: string,
    rule: ProviderFaultSimulationRule | null,
  ): void {
    if (!rule) {
      this.faultRules.delete(key);
    } else {
      this.faultRules.set(key, { ...rule });
    }
  }

  clearAllSimulations(): void {
    this.faultRules.clear();
    this.buckets.clear();
    this.circuits.clear();
    this.simulatedOrders.clear();
    this.simulatedRemoteStock.clear();
    this.simulatedListings.clear();
  }

  seedSimulatedOrder(
    connectionId: string,
    order: NormalizedExternalOrder,
  ): void {
    let map = this.simulatedOrders.get(connectionId);
    if (!map) {
      map = new Map();
      this.simulatedOrders.set(connectionId, map);
    }
    map.set(order.externalOrderId, order);
  }

  getSimulatedOrder(
    connectionId: string,
    externalOrderId: string,
  ): NormalizedExternalOrder | undefined {
    return this.simulatedOrders.get(connectionId)?.get(externalOrderId);
  }

  listSimulatedOrders(connectionId: string): NormalizedExternalOrder[] {
    return Array.from(this.simulatedOrders.get(connectionId)?.values() ?? []);
  }

  seedSimulatedListings(
    connectionId: string,
    listings: ExternalProductListingVariation[],
  ): void {
    this.simulatedListings.set(connectionId, listings);
  }

  getSimulatedListings(
    connectionId: string,
  ): ExternalProductListingVariation[] {
    return this.simulatedListings.get(connectionId) ?? [];
  }

  recordSimulatedRemoteStock(
    connectionId: string,
    externalItemId: string,
    externalSkuId: string,
    quantity: number,
    stockVersion: number,
  ): void {
    const key = `${connectionId}:${externalItemId}:${externalSkuId}`;
    this.simulatedRemoteStock.set(key, {
      quantity,
      stockVersion,
      updatedAt: new Date(),
    });
  }

  getSimulatedRemoteStock(
    connectionId: string,
    externalItemId: string,
    externalSkuId: string,
  ): { quantity: number; stockVersion: number; updatedAt: Date } | undefined {
    return this.simulatedRemoteStock.get(
      `${connectionId}:${externalItemId}:${externalSkuId}`,
    );
  }

  getCircuitState(
    provider: MarketplaceProvider,
    connectionId: string,
  ): CircuitBreakerState {
    const key = `${provider}:${connectionId}`;
    const existing = this.circuits.get(key);
    if (!existing) {
      return {
        state: 'CLOSED',
        consecutiveFailures: 0,
        openedAtMs: 0,
        cooldownMs: 15_000,
      };
    }
    if (
      existing.state === 'OPEN' &&
      Date.now() - existing.openedAtMs >= existing.cooldownMs
    ) {
      existing.state = 'HALF_OPEN';
    }
    return { ...existing };
  }

  async executeGuardedProviderCall<T>(
    params: {
      tenantId: string;
      connectionId: string;
      provider: MarketplaceProvider;
      operation: string;
      endpoint: string;
      capacityPerSec?: number;
    },
    fn: () => Promise<T>,
  ): Promise<T> {
    const startMs = Date.now();
    const circuitKey = `${params.provider}:${params.connectionId}`;
    const bucketKey = `${params.provider}:${params.connectionId}:${params.operation}`;

    // 1. Check circuit breaker
    let circuit = this.circuits.get(circuitKey);
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        consecutiveFailures: 0,
        openedAtMs: 0,
        cooldownMs: 15_000,
      };
      this.circuits.set(circuitKey, circuit);
    }
    if (circuit.state === 'OPEN') {
      if (Date.now() - circuit.openedAtMs >= circuit.cooldownMs) {
        circuit.state = 'HALF_OPEN';
      } else {
        await this.logProviderRequest({
          ...params,
          httpStatus: 503,
          outcome: 'CIRCUIT_OPEN',
          durationMs: Date.now() - startMs,
          rateLimited: false,
          errorCode: IntegrationDomainErrorCode.PROVIDER_CIRCUIT_OPEN,
        });
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_CIRCUIT_OPEN,
          `Circuit breaker is OPEN for ${params.provider} connection ${params.connectionId}`,
          503,
        );
      }
    }

    // 2. Check token bucket quota
    const capacity = params.capacityPerSec ?? 25;
    let bucket = this.buckets.get(bucketKey);
    const now = Date.now();
    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefillMs: now,
        capacity,
        refillPerSec: capacity,
      };
      this.buckets.set(bucketKey, bucket);
    } else {
      const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
      if (elapsedSec > 0) {
        bucket.tokens = Math.min(
          bucket.capacity,
          bucket.tokens + elapsedSec * bucket.refillPerSec,
        );
        bucket.lastRefillMs = now;
      }
    }

    if (bucket.tokens < 1) {
      await this.logProviderRequest({
        ...params,
        httpStatus: 429,
        outcome: 'LOCAL_QUOTA_THROTTLED',
        durationMs: Date.now() - startMs,
        rateLimited: true,
        retryAfterSeconds: 1,
        errorCode: IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
      });
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        `Local rate-limit quota exhausted for ${params.provider} (${params.operation})`,
        429,
        { retryAfterSeconds: 1 },
      );
    }
    bucket.tokens -= 1;

    // 3. Check deterministic fault simulation rules
    const rule =
      this.faultRules.get(`${params.connectionId}:${params.operation}`) ??
      this.faultRules.get(params.connectionId);
    if (rule && rule.remainingCount > 0) {
      rule.remainingCount -= 1;
      if (rule.mode === 'HTTP_429') {
        const retryAfter = rule.retryAfterSeconds ?? 2;
        await this.logProviderRequest({
          ...params,
          httpStatus: 429,
          outcome: 'RATE_LIMITED',
          durationMs: Date.now() - startMs,
          rateLimited: true,
          retryAfterSeconds: retryAfter,
          errorCode: IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        });
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
          `Provider ${params.provider} returned HTTP 429 Too Many Requests`,
          429,
          { retryAfterSeconds: retryAfter },
        );
      }
      if (rule.mode === 'HTTP_503') {
        this.recordFailure(circuit);
        await this.logProviderRequest({
          ...params,
          httpStatus: 503,
          outcome: 'SERVER_ERROR',
          durationMs: Date.now() - startMs,
          rateLimited: false,
          errorCode: IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        });
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
          `Provider ${params.provider} returned HTTP 503 Service Unavailable`,
          503,
        );
      }
      if (rule.mode === 'AUTH_EXPIRED') {
        await this.logProviderRequest({
          ...params,
          httpStatus: 401,
          outcome: 'AUTH_EXPIRED',
          durationMs: Date.now() - startMs,
          rateLimited: false,
          errorCode: IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
        });
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
          `Provider ${params.provider} rejected expired access token`,
          401,
        );
      }
      if (rule.mode === 'TIMEOUT_AFTER_REMOTE_WRITE') {
        // Execute remote side-effect first, then throw unknown-outcome timeout!
        await fn();
        this.recordFailure(circuit);
        await this.logProviderRequest({
          ...params,
          httpStatus: 504,
          outcome: 'TIMEOUT_UNKNOWN_OUTCOME',
          durationMs: Date.now() - startMs,
          rateLimited: false,
          errorCode:
            IntegrationDomainErrorCode.PROVIDER_TIMEOUT_UNKNOWN_OUTCOME,
        });
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_TIMEOUT_UNKNOWN_OUTCOME,
          `Provider ${params.provider} timed out after request transmission (outcome unknown)`,
          504,
        );
      }
    }

    try {
      const result = await fn();
      circuit.consecutiveFailures = 0;
      circuit.state = 'CLOSED';
      await this.logProviderRequest({
        ...params,
        httpStatus: 200,
        outcome: 'SUCCESS',
        durationMs: Date.now() - startMs,
        rateLimited: false,
      });
      return result;
    } catch (error) {
      this.recordFailure(circuit);
      const code =
        error instanceof IntegrationDomainError
          ? error.code
          : 'PROVIDER_CALL_FAILED';
      await this.logProviderRequest({
        ...params,
        httpStatus:
          error instanceof IntegrationDomainError ? error.httpStatus : 500,
        outcome: 'ERROR',
        durationMs: Date.now() - startMs,
        rateLimited:
          error instanceof IntegrationDomainError &&
          error.code === IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        errorCode: code,
      });
      throw error;
    }
  }

  private recordFailure(circuit: CircuitBreakerState): void {
    circuit.consecutiveFailures += 1;
    if (circuit.consecutiveFailures >= 5) {
      circuit.state = 'OPEN';
      circuit.openedAtMs = Date.now();
    }
  }

  private async logProviderRequest(entry: {
    tenantId: string;
    connectionId: string;
    provider: MarketplaceProvider;
    operation: string;
    endpoint: string;
    httpStatus: number;
    outcome: string;
    durationMs: number;
    rateLimited: boolean;
    retryAfterSeconds?: number;
    errorCode?: string;
  }): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          entry.tenantId,
        ]);
        const log = em.create(ProviderRequestLogEntity, {
          tenantId: entry.tenantId,
          connectionId: entry.connectionId,
          provider: entry.provider,
          operation: entry.operation,
          endpoint: entry.endpoint,
          httpStatus: entry.httpStatus,
          outcome: entry.outcome,
          durationMs: Math.max(0, entry.durationMs),
          rateLimited: entry.rateLimited,
          retryAfterSeconds: entry.retryAfterSeconds ?? null,
          errorCode: entry.errorCode ?? null,
        });
        await em.save(ProviderRequestLogEntity, log);
      });
    } catch {
      // Telemetry write must never mask primary domain error
    }
  }
}
