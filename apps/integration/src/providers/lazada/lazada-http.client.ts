import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  computeLazadaApiSignature,
} from '../../domain/integration-domain';

export interface LazadaHttpClientOptions {
  apiBaseUrl?: string;
  authBaseUrl?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  liveEnabled?: boolean;
}

export interface LazadaSignedRequest {
  url: string;
  redactedUrl: string;
  apiPath: string;
  queryParams: Record<string, string | number>;
  sign: string;
  timestamp: number;
}

export interface LazadaGetOrdersParams {
  appKey: string;
  appSecret: string;
  accessToken: string;
  updateAfter?: Date | string;
  updateBefore?: Date | string;
  createdAfter?: Date | string;
  createdBefore?: Date | string;
  status?: string;
  offset?: number;
  limit?: number;
  sortBy?: 'updated_at' | 'created_at';
  sortDirection?: 'ASC' | 'DESC';
  timestampMs?: number;
}

export interface LazadaGetOrderParams {
  appKey: string;
  appSecret: string;
  accessToken: string;
  orderId: string;
  timestampMs?: number;
}

export interface LazadaGetOrderItemsParams {
  appKey: string;
  appSecret: string;
  accessToken: string;
  orderId: string;
  timestampMs?: number;
}

export interface LazadaGetProductsParams {
  appKey: string;
  appSecret: string;
  accessToken: string;
  filter?: 'all' | 'live' | 'inactive' | 'deleted' | 'sold-out';
  offset?: number;
  limit?: number;
  timestampMs?: number;
}

export interface LazadaEnvelopeResponse<T = any> {
  code?: string | number;
  type?: string;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface LazadaAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
  sellerId: string | null;
  shortCode: string | null;
  account: string | null;
  country: string | null;
  requestId: string | null;
}

function toIsoString(val: Date | string | undefined): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString();
  return val;
}

export function redactLazadaQueryUrl(rawUrl: string): string {
  return rawUrl
    .replace(/([?&]access_token=)[^&]+/gi, '$1[REDACTED]')
    .replace(/([?&]refresh_token=)[^&]+/gi, '$1[REDACTED]')
    .replace(/([?&]code=)[^&]+/gi, '$1[REDACTED]')
    .replace(/([?&]sign=)[^&]+/gi, '$1[REDACTED]');
}

@Injectable()
export class LazadaHttpClient {
  private readonly options: LazadaHttpClientOptions;

  constructor(@Optional() options?: LazadaHttpClientOptions) {
    this.options = options ?? {};
  }

  getApiBaseUrl(): string {
    return (
      this.options.apiBaseUrl ??
      process.env.LAZADA_API_BASE_URL ??
      'https://api.lazada.vn/rest'
    ).replace(/\/+$/, '');
  }

  getAuthBaseUrl(): string {
    return (
      this.options.authBaseUrl ??
      process.env.LAZADA_AUTH_API_BASE_URL ??
      process.env.LAZADA_AUTH_TOKEN_URL ??
      'https://auth.lazada.com/rest'
    ).replace(/\/+$/, '');
  }

  isHttpEnabled(): boolean {
    if (typeof this.options.liveEnabled === 'boolean') {
      return this.options.liveEnabled;
    }
    return Boolean(
      this.options.apiBaseUrl ||
        this.options.authBaseUrl ||
        process.env.LAZADA_LIVE_ENABLED === 'true',
    );
  }

  resolveAppKey(partnerId?: string | null): string {
    const trimmedPartnerId = (partnerId ?? '').trim();
    const envKey = (process.env.LAZADA_APP_KEY ?? '').trim();
    const resolved =
      trimmedPartnerId && trimmedPartnerId !== 'lazada-partner'
        ? trimmedPartnerId
        : envKey;
    if (!resolved) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Lazada app_key (connection partnerId or LAZADA_APP_KEY) is required for signed Open Platform requests',
        401,
      );
    }
    return resolved;
  }

  resolveAppSecret(partnerSecret?: string | null): string {
    const trimmedSecret = (partnerSecret ?? '').trim();
    const envSecret = (process.env.LAZADA_APP_SECRET ?? '').trim();
    const resolved =
      trimmedSecret && trimmedSecret !== 'configured-via-env'
        ? trimmedSecret
        : envSecret;
    if (!resolved) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Lazada app_secret is required for HMAC-SHA256 request signing',
        401,
      );
    }
    return resolved;
  }

  /**
   * Builds a signed Lazada Open Platform REST v2 request URL using official HMAC-SHA256 signing:
   * 1. Collect system params (`app_key`, `access_token`, `timestamp`, `sign_method=sha256`) + business params.
   * 2. Sort parameter keys ASCII ascending, concatenate `apiPath + k1 + v1 + k2 + v2...`.
   * 3. Compute uppercase hex `HMAC-SHA256(appSecret, baseString)` as `sign`.
   */
  buildSignedRequest(params: {
    baseUrl?: string;
    apiPath: string;
    appKey: string;
    appSecret: string;
    accessToken?: string;
    businessParams?: Record<string, string | number | undefined | null>;
    timestampMs?: number;
  }): LazadaSignedRequest {
    const appKey = this.resolveAppKey(params.appKey);
    const appSecret = this.resolveAppSecret(params.appSecret);
    const timestamp = params.timestampMs ?? Date.now();
    const apiPath = params.apiPath.startsWith('/')
      ? params.apiPath
      : `/${params.apiPath}`;

    const queryParams: Record<string, string | number> = {
      app_key: appKey,
      sign_method: 'sha256',
      timestamp: String(timestamp),
    };

    if (params.accessToken !== undefined) {
      const token = params.accessToken.trim();
      if (!token) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
          'Lazada seller access_token is empty or missing',
          401,
        );
      }
      queryParams.access_token = token;
    }

    if (params.businessParams) {
      for (const [k, v] of Object.entries(params.businessParams)) {
        if (v !== undefined && v !== null && String(v).length > 0) {
          queryParams[k] = v;
        }
      }
    }

    const sign = computeLazadaApiSignature({
      appSecret,
      apiPath,
      queryParams,
    });

    const sortedKeys = Object.keys(queryParams).sort();
    const searchParams = new URLSearchParams();
    for (const k of sortedKeys) {
      searchParams.append(k, String(queryParams[k]));
    }
    searchParams.append('sign', sign);

    const baseUrl = (params.baseUrl ?? this.getApiBaseUrl()).replace(
      /\/+$/,
      '',
    );
    const url = `${baseUrl}${apiPath}?${searchParams.toString()}`;

    return {
      url,
      redactedUrl: redactLazadaQueryUrl(url),
      apiPath,
      queryParams: { ...queryParams, sign },
      sign,
      timestamp,
    };
  }

  async executeSignedGet<T = any>(params: {
    baseUrl?: string;
    apiPath: string;
    appKey: string;
    appSecret: string;
    accessToken?: string;
    businessParams?: Record<string, string | number | undefined | null>;
    timestampMs?: number;
    correlationId?: string;
    maxRetries?: number;
  }): Promise<LazadaEnvelopeResponse<T>> {
    const maxRetries = Math.max(0, params.maxRetries ?? 0);
    const baseRetryDelayMs =
      this.options.retryDelayMs ?? (process.env.NODE_ENV === 'test' ? 5 : 150);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeSingleSignedGet<T>({
          ...params,
          timestampMs:
            attempt === 0
              ? params.timestampMs
              : (params.timestampMs ?? Date.now()),
        });
      } catch (err) {
        lastError = err;
        const isSellerFrequencyBan =
          err instanceof IntegrationDomainError &&
          err.code === IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED &&
          String((err.details as any)?.lazadaCode ?? '').toLowerCase() ===
            'sellercalllimit';
        const isTransientRetryable =
          isSellerFrequencyBan ||
          (err instanceof IntegrationDomainError &&
            err.code === IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE &&
            err.httpStatus === 503);
        if (!isTransientRetryable || attempt >= maxRetries) {
          throw err;
        }
        const delayMs = isSellerFrequencyBan
          ? process.env.NODE_ENV === 'test'
            ? baseRetryDelayMs
            : 1100
          : baseRetryDelayMs * Math.pow(2, attempt);
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  }

  private async executeSingleSignedGet<T = any>(params: {
    baseUrl?: string;
    apiPath: string;
    appKey: string;
    appSecret: string;
    accessToken?: string;
    businessParams?: Record<string, string | number | undefined | null>;
    timestampMs?: number;
    correlationId?: string;
  }): Promise<LazadaEnvelopeResponse<T>> {
    const signed = this.buildSignedRequest(params);
    const timeoutMs =
      this.options.timeoutMs ??
      Number(process.env.LAZADA_HTTP_TIMEOUT_MS || 10_000);
    const fetchFn = this.options.fetchImpl ?? globalThis.fetch;
    const correlationId = params.correlationId || `lzd-${randomUUID()}`;

    let response: Response;
    try {
      response = await fetchFn(signed.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Request-Id': correlationId,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = redactLazadaQueryUrl(rawMsg);
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' ||
          err.name === 'AbortError' ||
          safeMsg.toLowerCase().includes('timeout'));
      throw new IntegrationDomainError(
        isTimeout
          ? IntegrationDomainErrorCode.PROVIDER_TIMEOUT_UNKNOWN_OUTCOME
          : IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        `Lazada API network error on ${signed.apiPath}: ${safeMsg}`,
        isTimeout ? 504 : 503,
        {
          apiPath: signed.apiPath,
          endpoint: signed.redactedUrl,
          correlationId,
        },
      );
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader
        ? Math.max(1, Number(retryAfterHeader) || 2)
        : 2;
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        `Lazada API rate limited (HTTP 429) on ${signed.apiPath}`,
        429,
        { apiPath: signed.apiPath, retryAfterSeconds, correlationId },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
        `Lazada API authentication rejected (HTTP ${response.status}) on ${signed.apiPath}`,
        401,
        { apiPath: signed.apiPath, correlationId },
      );
    }

    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        `Failed to read Lazada API response stream on ${signed.apiPath}`,
        502,
        { apiPath: signed.apiPath, correlationId },
      );
    }

    if (response.status >= 500) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        `Lazada API upstream server error (HTTP ${response.status}) on ${signed.apiPath}`,
        503,
        {
          apiPath: signed.apiPath,
          httpStatus: response.status,
          correlationId,
        },
      );
    }

    let parsed: LazadaEnvelopeResponse<T>;
    try {
      parsed = JSON.parse(bodyText) as LazadaEnvelopeResponse<T>;
    } catch {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        `Lazada API returned malformed JSON on ${signed.apiPath} (HTTP ${response.status})`,
        502,
        {
          apiPath: signed.apiPath,
          httpStatus: response.status,
          correlationId,
        },
      );
    }

    const codeStr = String(parsed.code ?? '0');
    if (codeStr !== '0') {
      this.throwMappedLazadaApiError(signed.apiPath, parsed);
    }

    return parsed;
  }

  private throwMappedLazadaApiError(
    apiPath: string,
    envelope: LazadaEnvelopeResponse<unknown>,
  ): never {
    const code = String(envelope.code ?? 'UNKNOWN');
    const type = String(envelope.type ?? '');
    const message = redactLazadaQueryUrl(
      String(envelope.message ?? `Lazada API error code ${code}`),
    );
    const requestId = envelope.request_id ? String(envelope.request_id) : null;
    const combined = `${code} ${type} ${message}`.toLowerCase();

    if (
      combined.includes('illegalaccesstoken') ||
      combined.includes('accesstokenexpired') ||
      combined.includes('invalidaccesstoken') ||
      combined.includes('access_token')
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_TOKEN_EXPIRED,
        `Lazada access_token rejected on ${apiPath}: ${message} (code=${code})`,
        401,
        { apiPath, lazadaCode: code, lazadaType: type, requestId },
      );
    }

    if (
      combined.includes('illegalcode') ||
      combined.includes('invalidcode') ||
      combined.includes('codeexpired')
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        `Lazada authorization code rejected on ${apiPath}: ${message} (code=${code})`,
        401,
        { apiPath, lazadaCode: code, lazadaType: type, requestId },
      );
    }

    if (
      combined.includes('incompletesignature') ||
      combined.includes('illegalsign') ||
      combined.includes('invalidappkey') ||
      combined.includes('illegalrefreshtoken') ||
      combined.includes('refreshtokenexpired')
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_REAUTH_REQUIRED,
        `Lazada authorization/signature error on ${apiPath}: ${message} (code=${code})`,
        401,
        { apiPath, lazadaCode: code, lazadaType: type, requestId },
      );
    }

    if (
      combined.includes('apicalllimit') ||
      combined.includes('sellercalllimit') ||
      combined.includes('frequencylimit') ||
      combined.includes('frequency exceeds') ||
      combined.includes('throttled') ||
      code === '429'
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        `Lazada API call limit exceeded on ${apiPath}: ${message} (code=${code})`,
        429,
        {
          apiPath,
          lazadaCode: code,
          lazadaType: type,
          requestId,
          retryAfterSeconds: 2,
        },
      );
    }

    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
      `Lazada API error on ${apiPath}: ${message} (code=${code})`,
      502,
      { apiPath, lazadaCode: code, lazadaType: type, requestId },
    );
  }

  private parseAuthTokenEnvelope(
    apiPath: string,
    envelope: LazadaEnvelopeResponse<Record<string, any>>,
  ): LazadaAuthTokenResponse {
    const payload =
      envelope.data &&
      typeof envelope.data === 'object' &&
      'access_token' in envelope.data
        ? envelope.data
        : (envelope as Record<string, any>);

    const accessToken = String(payload.access_token ?? '').trim();
    const refreshToken = String(payload.refresh_token ?? '').trim();

    if (!accessToken || !refreshToken) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        `Lazada OAuth response on ${apiPath} did not contain access_token and refresh_token`,
        502,
        { apiPath, requestId: envelope.request_id ?? null },
      );
    }

    const expiresInSeconds = Math.max(
      60,
      Number(payload.expires_in ?? 7 * 24 * 3600) || 7 * 24 * 3600,
    );
    const refreshExpiresInSeconds = Math.max(
      60,
      Number(payload.refresh_expires_in ?? 30 * 24 * 3600) || 30 * 24 * 3600,
    );

    const countryUserInfo = Array.isArray(payload.country_user_info)
      ? payload.country_user_info
      : Array.isArray(payload.country_user_info_list)
        ? payload.country_user_info_list
        : [];
    const preferredUserInfo =
      countryUserInfo.find(
        (u: Record<string, any>) =>
          String(u?.country ?? '').toLowerCase() === 'vn',
      ) ?? countryUserInfo[0];

    const sellerId =
      String(preferredUserInfo?.seller_id ?? payload.seller_id ?? '').trim() ||
      null;
    const shortCode =
      String(
        preferredUserInfo?.short_code ?? payload.short_code ?? '',
      ).trim() || null;
    const account = String(payload.account ?? '').trim() || null;
    const country =
      String(preferredUserInfo?.country ?? payload.country ?? '').trim() ||
      null;

    return {
      accessToken,
      refreshToken,
      expiresInSeconds,
      refreshExpiresInSeconds,
      sellerId,
      shortCode,
      account,
      country,
      requestId: envelope.request_id ? String(envelope.request_id) : null,
    };
  }

  /**
   * Exchanges a Lazada OAuth authorization `code` for seller `access_token` and `refresh_token`
   * via `GET /auth/token/create` on `LAZADA_AUTH_TOKEN_URL` (default `https://auth.lazada.com/rest`).
   */
  async createAuthToken(params: {
    appKey?: string | null;
    appSecret?: string | null;
    code: string;
    timestampMs?: number;
  }): Promise<LazadaAuthTokenResponse> {
    const code = String(params.code ?? '').trim();
    if (!code) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Lazada authorization code is required for /auth/token/create',
        400,
      );
    }

    const appKey = this.resolveAppKey(params.appKey);
    const appSecret = this.resolveAppSecret(params.appSecret);
    const envelope = await this.executeSignedGet<Record<string, any>>({
      baseUrl: this.getAuthBaseUrl(),
      apiPath: '/auth/token/create',
      appKey,
      appSecret,
      timestampMs: params.timestampMs,
      businessParams: {
        code,
      },
    });

    return this.parseAuthTokenEnvelope('/auth/token/create', envelope);
  }

  /**
   * Refreshes an expired Lazada `access_token` using `refresh_token`
   * via `GET /auth/token/refresh` on `LAZADA_AUTH_TOKEN_URL` (default `https://auth.lazada.com/rest`).
   */
  async refreshAuthToken(params: {
    appKey?: string | null;
    appSecret?: string | null;
    refreshToken: string;
    timestampMs?: number;
  }): Promise<LazadaAuthTokenResponse> {
    const refreshToken = String(params.refreshToken ?? '').trim();
    if (!refreshToken) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_REAUTH_REQUIRED,
        'Lazada refresh_token is required for /auth/token/refresh',
        401,
      );
    }

    const appKey = this.resolveAppKey(params.appKey);
    const appSecret = this.resolveAppSecret(params.appSecret);
    const envelope = await this.executeSignedGet<Record<string, any>>({
      baseUrl: this.getAuthBaseUrl(),
      apiPath: '/auth/token/refresh',
      appKey,
      appSecret,
      timestampMs: params.timestampMs,
      businessParams: {
        refresh_token: refreshToken,
      },
    });

    return this.parseAuthTokenEnvelope('/auth/token/refresh', envelope);
  }

  /**
   * Calls Lazada `GetOrders` (`GET /orders/get`).
   * Note: Lazada `GetOrders` returns order headers only; order items must be fetched via `getOrderItems`.
   */
  async getOrders(params: LazadaGetOrdersParams): Promise<{
    orders: Array<Record<string, any>>;
    count: number;
    countTotal: number;
    requestId: string | null;
  }> {
    const offset = params.offset ?? 0;
    const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
    const updateAfter = toIsoString(params.updateAfter);
    const updateBefore = toIsoString(params.updateBefore);
    const createdAfter = toIsoString(params.createdAfter);
    const createdBefore = toIsoString(params.createdBefore);

    const envelope = await this.executeSignedGet<{
      count?: number;
      countTotal?: number;
      orders?: Array<Record<string, any>>;
    }>({
      apiPath: '/orders/get',
      appKey: params.appKey,
      appSecret: params.appSecret,
      accessToken: params.accessToken,
      timestampMs: params.timestampMs,
      maxRetries: 2,
      businessParams: {
        created_after: createdAfter,
        created_before: createdBefore,
        limit,
        offset,
        sort_by: params.sortBy ?? 'updated_at',
        sort_direction: params.sortDirection ?? 'ASC',
        status: params.status,
        update_after: updateAfter,
        update_before: updateBefore,
      },
    });

    const orders = Array.isArray(envelope.data?.orders)
      ? envelope.data.orders
      : [];
    const count = Number(envelope.data?.count ?? orders.length);
    const countTotal = Number(envelope.data?.countTotal ?? count);

    return {
      orders,
      count,
      countTotal,
      requestId: envelope.request_id ?? null,
    };
  }

  /**
   * Calls Lazada `GetOrder` (`GET /order/get`) for a single order header.
   */
  async getOrder(params: LazadaGetOrderParams): Promise<{
    order: Record<string, any>;
    requestId: string | null;
  }> {
    const orderId = String(params.orderId).trim();
    const envelope = await this.executeSignedGet<Record<string, any>>({
      apiPath: '/order/get',
      appKey: params.appKey,
      appSecret: params.appSecret,
      accessToken: params.accessToken,
      timestampMs: params.timestampMs,
      maxRetries: 2,
      businessParams: {
        order_id: orderId,
      },
    });

    if (!envelope.data || typeof envelope.data !== 'object') {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        `Lazada GetOrder returned empty data for order_id=${orderId}`,
        502,
      );
    }

    return {
      order: envelope.data,
      requestId: envelope.request_id ?? null,
    };
  }

  /**
   * Calls Lazada `GetOrderItems` (`GET /order/items/get`) for a given `order_id`.
   */
  async getOrderItems(params: LazadaGetOrderItemsParams): Promise<{
    items: Array<Record<string, any>>;
    requestId: string | null;
  }> {
    const orderId = String(params.orderId).trim();
    const envelope = await this.executeSignedGet<
      Array<Record<string, any>> | { order_items?: Array<Record<string, any>> }
    >({
      apiPath: '/order/items/get',
      appKey: params.appKey,
      appSecret: params.appSecret,
      accessToken: params.accessToken,
      timestampMs: params.timestampMs,
      maxRetries: 2,
      businessParams: {
        order_id: orderId,
      },
    });

    const rawData = envelope.data;
    const items = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.order_items)
        ? rawData.order_items
        : [];

    return {
      items,
      requestId: envelope.request_id ?? null,
    };
  }

  /**
   * Calls Lazada `GetProducts` (`GET /products/get`) for read-only catalog listing & SKU discovery.
   */
  async getProducts(params: LazadaGetProductsParams): Promise<{
    products: Array<Record<string, any>>;
    totalProducts: number;
    requestId: string | null;
  }> {
    const offset = params.offset ?? 0;
    const limit = Math.min(Math.max(1, params.limit ?? 50), 50);
    const filter = params.filter ?? 'all';

    const envelope = await this.executeSignedGet<{
      total_products?: number;
      products?: Array<Record<string, any>>;
    }>({
      apiPath: '/products/get',
      appKey: params.appKey,
      appSecret: params.appSecret,
      accessToken: params.accessToken,
      timestampMs: params.timestampMs,
      maxRetries: 2,
      businessParams: {
        filter,
        limit,
        offset,
      },
    });

    const products = Array.isArray(envelope.data?.products)
      ? envelope.data.products
      : [];
    const totalProducts = Number(
      envelope.data?.total_products ?? products.length,
    );

    return {
      products,
      totalProducts,
      requestId: envelope.request_id ?? null,
    };
  }

  /**
   * Fetches a single Lazada order header (`GetOrder`) and its line items (`GetOrderItems`),
   * returning a combined raw order object ready for `normalizeOrderPayload`.
   */
  async fetchOrderWithItems(
    params: LazadaGetOrderParams,
  ): Promise<Record<string, any>> {
    const { order } = await this.getOrder(params);
    const { items } = await this.getOrderItems(params);
    return {
      ...order,
      order_id: order.order_id ?? order.trade_order_id ?? params.orderId,
      order_items: items,
    };
  }

  /**
   * Polls updated Lazada orders in `[windowStart, windowEnd]` via `GetOrders` (`/orders/get`)
   * and enriches each order with its line items via `GetOrderItems` (`/order/items/get`).
   */
  async pollOrdersWithItems(params: {
    appKey: string;
    appSecret: string;
    accessToken: string;
    windowStart: Date;
    windowEnd: Date;
    offset?: number;
    limit?: number;
  }): Promise<{
    ordersWithItems: Array<Record<string, any>>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;

    const page = await this.getOrders({
      appKey: params.appKey,
      appSecret: params.appSecret,
      accessToken: params.accessToken,
      updateAfter: params.windowStart,
      updateBefore: params.windowEnd,
      offset,
      limit,
      sortBy: 'updated_at',
      sortDirection: 'ASC',
    });

    const ordersWithItems: Array<Record<string, any>> = [];
    for (const order of page.orders) {
      const orderId = String(
        order.order_id ?? order.trade_order_id ?? '',
      ).trim();
      if (!orderId) continue;

      if (Array.isArray(order.order_items) && order.order_items.length > 0) {
        ordersWithItems.push(order);
        continue;
      }

      const { items } = await this.getOrderItems({
        appKey: params.appKey,
        appSecret: params.appSecret,
        accessToken: params.accessToken,
        orderId,
      });

      ordersWithItems.push({
        ...order,
        order_id: orderId,
        order_items: items,
      });
    }

    const nextOffset = offset + page.orders.length;
    const hasMore = page.orders.length > 0 && nextOffset < page.countTotal;

    return {
      ordersWithItems,
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore,
    };
  }
}
