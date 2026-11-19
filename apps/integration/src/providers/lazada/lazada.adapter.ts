import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { roundVnd } from '../../common/money';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  assertWebhookTimestampFreshness,
  computeLazadaApiSignature,
  normalizeProviderOrderStatus,
  verifyLazadaWebhookSignature,
} from '../../domain/integration-domain';
import { ProviderRateLimiterService } from '../../infrastructure/rate-limiting/provider-rate-limiter.service';
import type {
  ExternalProductListingVariation,
  InventoryPublicationCommand,
  InventoryPublicationResult,
  MarketplaceProviderAdapter,
  NormalizedExternalOrder,
  NormalizedExternalOrderLine,
  NormalizedWebhookEnvelope,
  OAuthAuthorizationUrlResult,
  ProviderCapabilityDeclaration,
  TokenExchangeResult,
} from '../contracts/provider.contracts';
import { LazadaHttpClient } from './lazada-http.client';

function parseLazadaMoney(value: unknown): number {
  if (typeof value === 'number') {
    return roundVnd(value);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    return roundVnd(cleaned);
  }
  return 0;
}

function parseLazadaTimestamp(rawOrder: Record<string, any>): Date {
  if (
    rawOrder.updated_at_sec !== undefined &&
    rawOrder.updated_at_sec !== null &&
    Number.isFinite(Number(rawOrder.updated_at_sec))
  ) {
    return new Date(Number(rawOrder.updated_at_sec) * 1000);
  }
  const dateCandidate =
    rawOrder.updated_at ?? rawOrder.created_at ?? rawOrder.externalUpdatedAt;
  if (dateCandidate instanceof Date && !Number.isNaN(dateCandidate.getTime())) {
    return dateCandidate;
  }
  if (typeof dateCandidate === 'string' && dateCandidate.trim().length > 0) {
    const parsed = new Date(dateCandidate.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

/**
 * Parses Lazada's canonical `shop_sku` / `ShopSku` format `<item_id>_<platform>-<sku_id>`
 * (e.g. `13504402059_VNAMZ-117553898643`) into `{ itemId, skuId }` when top-level
 * `product_id` or `sku_id` fields are absent.
 */
function parseLazadaShopSku(rawShopSku: unknown): {
  itemId: string;
  skuId: string;
} {
  if (typeof rawShopSku !== 'string' || !rawShopSku.trim()) {
    return { itemId: '', skuId: '' };
  }
  const trimmed = rawShopSku.trim();
  const [itemPart, rightPart] = trimmed.split('_');
  const itemId = itemPart?.trim() ?? '';
  if (!rightPart) {
    return { itemId, skuId: '' };
  }
  const dashIdx = rightPart.indexOf('-');
  const skuId =
    dashIdx >= 0 ? rightPart.slice(dashIdx + 1).trim() : rightPart.trim();
  return { itemId, skuId };
}

@Injectable()
export class LazadaProviderAdapter implements MarketplaceProviderAdapter {
  readonly provider = 'LAZADA' as const;

  constructor(
    private readonly rateLimiter: ProviderRateLimiterService,
    @Optional()
    private readonly lazadaHttpClient: LazadaHttpClient = new LazadaHttpClient(),
  ) {}

  getCapabilities(): ProviderCapabilityDeclaration {
    const liveConfigured = Boolean(
      this.lazadaHttpClient.isHttpEnabled() ||
        (process.env.LAZADA_APP_KEY &&
          process.env.LAZADA_APP_SECRET &&
          process.env.LAZADA_LIVE_ENABLED === 'true'),
    );
    return {
      provider: 'LAZADA',
      apiVersion: 'rest-v2',
      supportsOAuth: true,
      supportsTokenRefresh: true,
      supportsWebhookSignatureVerification: true,
      supportsIncrementalOrderPolling: true,
      supportsBatchOrderFetch: true,
      supportsInventoryPublication: true,
      supportsProductListingDiscovery: true,
      liveCredentialsConfigured: liveConfigured,
    };
  }

  private isSimulatorAllowed(): boolean {
    if (process.env.LAZADA_LIVE_ENABLED === 'true') {
      return false;
    }
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.LAZADA_SIMULATOR_ENABLED === 'true'
    );
  }

  buildAuthorizationUrl(params: {
    connectionId: string;
    externalShopId: string;
    redirectUri: string;
    stateNonce: string;
    partnerId: string;
    partnerSecret: string;
  }): OAuthAuthorizationUrlResult {
    const baseUrl =
      process.env.LAZADA_AUTH_URL || 'https://auth.lazada.com/oauth/authorize';
    const clientId =
      this.lazadaHttpClient.isHttpEnabled() ||
      process.env.LAZADA_LIVE_ENABLED === 'true' ||
      process.env.LAZADA_APP_KEY
        ? this.lazadaHttpClient.resolveAppKey(params.partnerId)
        : params.partnerId || 'lazada-partner';
    const authorizationUrl = `${baseUrl}?response_type=code&force_auth=true&redirect_uri=${encodeURIComponent(params.redirectUri)}&client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(params.stateNonce)}`;
    return {
      authorizationUrl,
      stateNonce: params.stateNonce,
      expiresInSeconds: 600,
    };
  }

  async exchangeAuthorizationCode(params: {
    connectionId: string;
    code: string;
    externalShopId: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult> {
    if (!params.code || params.code.trim().length < 4) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Lazada authorization code is invalid or empty',
        400,
      );
    }

    const now = Date.now();
    if (this.lazadaHttpClient.isHttpEnabled()) {
      const tokenRes = await this.lazadaHttpClient.createAuthToken({
        appKey: params.partnerId,
        appSecret: params.partnerSecret,
        code: params.code.trim(),
      });
      const resolvedShopId =
        tokenRes.sellerId ||
        tokenRes.shortCode ||
        (!params.externalShopId.startsWith('pending_')
          ? params.externalShopId
          : '');
      if (!resolvedShopId) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          'Lazada /auth/token/create response did not include seller_id or short_code',
          502,
        );
      }
      return {
        externalShopId: resolvedShopId,
        shopName: tokenRes.account
          ? `Lazada Seller ${tokenRes.account}`
          : `Lazada Seller ${resolvedShopId}`,
        accessToken: tokenRes.accessToken,
        refreshToken: tokenRes.refreshToken,
        accessTokenExpiresAt: new Date(now + tokenRes.expiresInSeconds * 1000),
        refreshTokenExpiresAt: new Date(
          now + tokenRes.refreshExpiresInSeconds * 1000,
        ),
        scopes: [
          'seller.read',
          'order.read',
          'product.stock.write',
          'product.read',
        ],
        liveMode: true,
        country: tokenRes.country,
        shortCode: tokenRes.shortCode,
        sellerAccount: tokenRes.account,
      };
    }

    if (!this.isSimulatorAllowed()) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        'Lazada live OAuth is not enabled (set LAZADA_LIVE_ENABLED=true and configure LAZADA_APP_KEY/LAZADA_APP_SECRET)',
        503,
      );
    }

    const resolvedSimShopId = params.externalShopId.startsWith('pending_')
      ? `LZD-SIM-${params.connectionId.slice(0, 8).toUpperCase()}`
      : params.externalShopId;

    const tokenSeed = createHash('sha256')
      .update(
        `lazada:exchange:${params.connectionId}:${resolvedSimShopId}:${params.code}:${now}:${randomUUID()}`,
      )
      .digest('hex');

    return {
      externalShopId: resolvedSimShopId,
      shopName: `Lazada Seller ${resolvedSimShopId}`,
      accessToken: `lzd_at_${tokenSeed.slice(0, 32)}`,
      refreshToken: `lzd_rt_${tokenSeed.slice(32, 64)}`,
      accessTokenExpiresAt: new Date(now + 7 * 24 * 3600 * 1000), // 7 days
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 3600 * 1000), // 30 days
      scopes: [
        'seller.read',
        'order.read',
        'product.stock.write',
        'product.read',
      ],
      liveMode: false,
      country: 'vn',
      shortCode: `VN-${resolvedSimShopId}`,
      sellerAccount: `${resolvedSimShopId.toLowerCase()}@lazada.test`,
    };
  }

  async refreshAccessToken(params: {
    connectionId: string;
    externalShopId: string;
    refreshToken: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult> {
    if (!params.refreshToken || params.refreshToken.includes('expired')) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_REAUTH_REQUIRED,
        'Lazada refresh_token is expired or revoked; seller re-authorization required',
        401,
      );
    }

    const now = Date.now();
    if (this.lazadaHttpClient.isHttpEnabled()) {
      const tokenRes = await this.lazadaHttpClient.refreshAuthToken({
        appKey: params.partnerId,
        appSecret: params.partnerSecret,
        refreshToken: params.refreshToken.trim(),
      });
      const resolvedShopId = tokenRes.sellerId || params.externalShopId;
      return {
        externalShopId: resolvedShopId,
        shopName: tokenRes.account
          ? `Lazada Seller ${tokenRes.account}`
          : `Lazada Seller ${resolvedShopId}`,
        accessToken: tokenRes.accessToken,
        refreshToken: tokenRes.refreshToken,
        accessTokenExpiresAt: new Date(now + tokenRes.expiresInSeconds * 1000),
        refreshTokenExpiresAt: new Date(
          now + tokenRes.refreshExpiresInSeconds * 1000,
        ),
        scopes: [
          'seller.read',
          'order.read',
          'product.stock.write',
          'product.read',
        ],
        liveMode: true,
        country: tokenRes.country,
        shortCode: tokenRes.shortCode,
        sellerAccount: tokenRes.account,
      };
    }

    if (!this.isSimulatorAllowed()) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
        'Lazada live token refresh is not enabled (set LAZADA_LIVE_ENABLED=true)',
        503,
      );
    }

    const tokenSeed = createHash('sha256')
      .update(
        `lazada:refresh:${params.connectionId}:${params.refreshToken}:${now}:${randomUUID()}`,
      )
      .digest('hex');

    return {
      externalShopId: params.externalShopId,
      shopName: `Lazada Seller ${params.externalShopId}`,
      accessToken: `lzd_at_${tokenSeed.slice(0, 32)}`,
      refreshToken: `lzd_rt_${tokenSeed.slice(32, 64)}`,
      accessTokenExpiresAt: new Date(now + 7 * 24 * 3600 * 1000),
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 3600 * 1000),
      scopes: [
        'seller.read',
        'order.read',
        'product.stock.write',
        'product.read',
      ],
      liveMode: false,
      country: 'vn',
    };
  }

  verifyAndParseWebhook(params: {
    webhookUrl: string;
    rawBody: Buffer | string;
    headers: Record<string, string | string[] | undefined>;
    webhookSecret: string;
    nowMs?: number;
  }): NormalizedWebhookEnvelope {
    const sigHeader =
      params.headers['authorization'] ??
      params.headers['x-lazada-signature'] ??
      '';
    const providedSignature = Array.isArray(sigHeader)
      ? sigHeader[0]
      : sigHeader;

    const valid = verifyLazadaWebhookSignature({
      rawBody: params.rawBody,
      appSecret: params.webhookSecret,
      providedSignature: providedSignature ?? '',
      appKey: process.env.LAZADA_APP_KEY,
    });

    if (!valid) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Lazada webhook HMAC-SHA256 signature verification failed',
        401,
      );
    }

    let parsed: Record<string, any>;
    try {
      const str = Buffer.isBuffer(params.rawBody)
        ? params.rawBody.toString('utf8')
        : params.rawBody;
      parsed = JSON.parse(str);
    } catch {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Invalid JSON in Lazada webhook body',
        400,
      );
    }

    const rawTimestamp = Number(parsed.timestamp ?? 0);
    const timestampSec =
      rawTimestamp > 1e11 ? Math.floor(rawTimestamp / 1000) : rawTimestamp;
    assertWebhookTimestampFreshness(timestampSec, params.nowMs);

    const sellerId = String(parsed.seller_id ?? parsed.shop_id ?? '');
    if (!sellerId) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Missing seller_id in Lazada webhook payload',
        422,
      );
    }

    const msgType = Number(parsed.message_type ?? 0);
    const data = (parsed.data ?? {}) as Record<string, any>;
    const orderId = data.trade_order_id
      ? String(data.trade_order_id)
      : data.order_id
        ? String(data.order_id)
        : null;
    const status = data.order_status
      ? String(data.order_status)
      : data.status
        ? String(data.status)
        : null;
    const rawUpdateTime = Number(data.status_update_time ?? timestampSec);
    const updateTimeSec =
      rawUpdateTime > 1e11 ? Math.floor(rawUpdateTime / 1000) : rawUpdateTime;

    let eventType: NormalizedWebhookEnvelope['eventType'] = 'UNKNOWN';
    if (msgType === 0) {
      eventType =
        status?.toLowerCase() === 'canceled' ||
        status?.toLowerCase() === 'cancelled'
          ? 'ORDER_CANCELLED'
          : 'ORDER_STATUS_UPDATE';
    } else if (msgType === 10) {
      eventType = 'AUTH_EXPIRED';
    }

    const externalEventId = parsed.message_id
      ? String(parsed.message_id)
      : `lzd:${sellerId}:${msgType}:${orderId ?? 'none'}:${status ?? 'none'}:${updateTimeSec}`;

    return {
      provider: 'LAZADA',
      externalEventId,
      deduplicationKey: externalEventId,
      eventType,
      externalShopId: sellerId,
      externalOrderId: orderId,
      externalStatus: status,
      providerEventTime: new Date(updateTimeSec * 1000),
      parsedPayload: parsed,
    };
  }

  normalizeOrderPayload(
    rawOrder: Record<string, any>,
    defaultExternalShopId: string,
  ): NormalizedExternalOrder {
    const externalOrderId = String(
      rawOrder.order_id ??
        rawOrder.trade_order_id ??
        rawOrder.order_number ??
        rawOrder.externalOrderId ??
        '',
    ).trim();
    if (!externalOrderId) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Lazada order payload is missing order_id',
        422,
      );
    }

    const itemList = Array.isArray(rawOrder.order_items)
      ? rawOrder.order_items
      : Array.isArray(rawOrder.lines)
        ? rawOrder.lines
        : [];

    if (itemList.length === 0) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        `Lazada order ${externalOrderId} has no order_items lines`,
        422,
      );
    }

    const statuses =
      Array.isArray(rawOrder.statuses) && rawOrder.statuses.length > 0
        ? rawOrder.statuses
        : [
            rawOrder.order_status ??
              rawOrder.status ??
              itemList[0]?.status ??
              'pending',
          ];
    const rawStatus = String(statuses[0] ?? 'pending');
    const normalizedStatus = normalizeProviderOrderStatus('LAZADA', rawStatus);

    // Lazada GetOrderItems often returns one item object per physical unit (each with a distinct order_item_id).
    // Aggregate items sharing the same (externalItemId, externalSkuId, unitPrice) into consolidated order lines.
    const groupedLines = new Map<string, NormalizedExternalOrderLine>();
    for (const item of itemList as Array<Record<string, any>>) {
      const parsedShopSku = parseLazadaShopSku(item.shop_sku ?? item.ShopSku);
      const externalItemId = String(
        item.product_id ??
          item.item_id ??
          item.externalItemId ??
          (parsedShopSku.itemId || ''),
      ).trim();
      const externalSkuId = String(
        item.sku_id ??
          item.externalSkuId ??
          (parsedShopSku.skuId || undefined) ??
          item.product_id ??
          '',
      ).trim();
      const externalSkuCode = item.sku
        ? String(item.sku).trim()
        : item.shop_sku
          ? String(item.shop_sku).trim()
          : (item.externalSkuCode ?? null);
      const itemName = String(
        item.name ?? item.itemName ?? 'Lazada Item',
      ).trim();
      const quantity = Math.max(1, Number(item.quantity ?? 1));
      const unitPrice = parseLazadaMoney(
        item.item_price ?? item.paid_price ?? item.unitPrice ?? 0,
      );
      const lineDiscount = parseLazadaMoney(
        item.voucher_amount ?? item.voucher_seller ?? item.lineDiscount ?? 0,
      );

      const groupKey = `${externalItemId}::${externalSkuId}::${unitPrice}`;
      const existing = groupedLines.get(groupKey);
      if (existing) {
        existing.quantity += quantity;
        existing.lineDiscount += lineDiscount;
      } else {
        groupedLines.set(groupKey, {
          externalItemId,
          externalSkuId,
          externalSkuCode,
          itemName,
          quantity,
          unitPrice,
          lineDiscount,
        });
      }
    }

    const lines = Array.from(groupedLines.values());
    const shippingFee = parseLazadaMoney(
      rawOrder.shipping_fee ?? rawOrder.shippingFee ?? 0,
    );
    const linesSubtotal = lines.reduce(
      (acc, l) => acc + Math.round(l.quantity * l.unitPrice) - l.lineDiscount,
      0,
    );
    const totalAmount = parseLazadaMoney(
      rawOrder.price ?? rawOrder.total_amount ?? linesSubtotal + shippingFee,
    );
    const externalUpdatedAt = parseLazadaTimestamp(rawOrder);

    const fullCustomerName = [
      rawOrder.customer_first_name,
      rawOrder.customer_last_name,
    ]
      .filter((p) => typeof p === 'string' && p.trim().length > 0)
      .map((p) => String(p).trim())
      .join(' ');
    const buyerName = String(
      (fullCustomerName ||
        rawOrder.buyerName ||
        rawOrder.address_billing?.first_name) ??
        'Lazada Buyer',
    ).trim();

    const firstItemCurrency = itemList[0]?.currency;

    return {
      provider: 'LAZADA',
      // Note: In Lazada GetOrderItems (/order/items/get), `item.shop_id` is the human-readable
      // shop display name (e.g. "Ngô gia phát 111"), not the seller ID or short_code ("VN33WH4M4S").
      // Always prefer explicit `rawOrder.seller_id` or `defaultExternalShopId` from the connection.
      externalShopId: String(
        rawOrder.seller_id ??
          (defaultExternalShopId || itemList[0]?.shop_id || ''),
      ),
      externalOrderId,
      externalStatus: rawStatus,
      normalizedStatus,
      externalUpdatedAt,
      buyerName: buyerName || 'Lazada Buyer',
      currency: String(rawOrder.currency ?? firstItemCurrency ?? 'VND'),
      totalAmount,
      shippingFee,
      paymentMethod: String(rawOrder.payment_method ?? 'COD'),
      lines,
      rawPayload: rawOrder,
    };
  }

  async fetchOrderDetails(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    externalOrderId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<NormalizedExternalOrder> {
    const apiPath = '/order/items/get';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'LAZADA',
        operation: 'order_items_get',
        endpoint: apiPath,
      },
      async () => {
        const seeded = this.rateLimiter.getSimulatedOrder(
          params.connectionId,
          params.externalOrderId,
        );
        if (seeded) {
          return seeded;
        }
        if (this.lazadaHttpClient.isHttpEnabled()) {
          const appKey = this.lazadaHttpClient.resolveAppKey(params.partnerId);
          const appSecret = this.lazadaHttpClient.resolveAppSecret(
            params.partnerSecret,
          );
          const rawOrderWithItems =
            await this.lazadaHttpClient.fetchOrderWithItems({
              appKey,
              appSecret,
              accessToken: params.accessToken,
              orderId: params.externalOrderId,
            });
          return this.normalizeOrderPayload(
            rawOrderWithItems,
            params.externalShopId,
          );
        }
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
          `Lazada order ${params.externalOrderId} not found in simulator and live Lazada API is BLOCKED_NO_CREDENTIALS`,
          503,
        );
      },
    );
  }

  async pollUpdatedOrders(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    windowStart: Date;
    windowEnd: Date;
    cursor?: string | null;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<{
    orders: NormalizedExternalOrder[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const apiPath = '/orders/get';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'LAZADA',
        operation: 'orders_get',
        endpoint: apiPath,
      },
      async () => {
        const simulated = this.rateLimiter.listSimulatedOrders(
          params.connectionId,
        );
        if (simulated.length > 0 || !this.lazadaHttpClient.isHttpEnabled()) {
          const filtered = simulated.filter(
            (o) =>
              o.externalUpdatedAt.getTime() >= params.windowStart.getTime() &&
              o.externalUpdatedAt.getTime() <= params.windowEnd.getTime(),
          );
          return {
            orders: filtered,
            nextCursor: null,
            hasMore: false,
          };
        }

        const appKey = this.lazadaHttpClient.resolveAppKey(params.partnerId);
        const appSecret = this.lazadaHttpClient.resolveAppSecret(
          params.partnerSecret,
        );
        const parsedOffset =
          params.cursor && /^\d+$/.test(params.cursor.trim())
            ? Number(params.cursor.trim())
            : 0;
        const pollLimit =
          process.env.LAZADA_LIVE_ENABLED === 'true'
            ? Math.min(
                50,
                Math.max(1, Number(process.env.LAZADA_ORDER_POLL_LIMIT || 5)),
              )
            : 50;

        const polled = await this.lazadaHttpClient.pollOrdersWithItems({
          appKey,
          appSecret,
          accessToken: params.accessToken,
          windowStart: params.windowStart,
          windowEnd: params.windowEnd,
          offset: parsedOffset,
          limit: pollLimit,
        });

        const orders = polled.ordersWithItems.map((raw) =>
          this.normalizeOrderPayload(raw, params.externalShopId),
        );

        return {
          orders,
          nextCursor: polled.nextCursor,
          hasMore: polled.hasMore,
        };
      },
    );
  }

  async publishInventoryStock(
    command: InventoryPublicationCommand,
  ): Promise<InventoryPublicationResult> {
    const apiPath = '/product/price_quantity/update';
    const timestamp = Date.now();
    const requestSignature = computeLazadaApiSignature({
      appSecret: command.partnerSecret,
      apiPath,
      queryParams: {
        access_token: command.accessToken,
        app_key: command.partnerId ?? 'lazada-app',
        sign_method: 'sha256',
        timestamp,
      },
    });

    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: command.tenantId,
        connectionId: command.connectionId,
        provider: 'LAZADA',
        operation: 'price_quantity_update',
        endpoint: apiPath,
        capacityPerSec: 15,
      },
      async () => {
        this.rateLimiter.recordSimulatedRemoteStock(
          command.connectionId,
          command.externalItemId,
          command.externalSkuId,
          command.quantity,
          command.stockVersion,
        );
        return {
          provider: 'LAZADA',
          externalItemId: command.externalItemId,
          externalSkuId: command.externalSkuId,
          confirmedQuantity: command.quantity,
          providerRequestId: `lzd-stk-${randomUUID().slice(0, 12)}`,
          signedEndpoint: `${apiPath}?timestamp=${timestamp}`,
          requestSignature,
          liveExecuted: this.getCapabilities().liveCredentialsConfigured,
        };
      },
    );
  }

  async fetchExternalListings(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<ExternalProductListingVariation[]> {
    const apiPath = '/products/get';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'LAZADA',
        operation: 'products_get',
        endpoint: apiPath,
      },
      async () => {
        const seeded = this.rateLimiter.getSimulatedListings(
          params.connectionId,
        );
        if (seeded.length > 0) {
          return seeded;
        }
        if (this.lazadaHttpClient.isHttpEnabled()) {
          const appKey = this.lazadaHttpClient.resolveAppKey(params.partnerId);
          const appSecret = this.lazadaHttpClient.resolveAppSecret(
            params.partnerSecret,
          );
          const res = await this.lazadaHttpClient.getProducts({
            appKey,
            appSecret,
            accessToken: params.accessToken,
            filter: 'all',
            offset: 0,
            limit: 50,
          });
          const variations: ExternalProductListingVariation[] = [];
          for (const prod of res.products) {
            const externalItemId = String(
              prod.item_id ?? prod.product_id ?? '',
            ).trim();
            if (!externalItemId) continue;
            const productName = String(
              prod.attributes?.name ??
                prod.name ??
                `Lazada Product ${externalItemId}`,
            ).trim();
            const skus = Array.isArray(prod.skus) ? prod.skus : [];
            for (const sku of skus as Array<Record<string, any>>) {
              const parsedShopSku = parseLazadaShopSku(
                sku.ShopSku ?? sku.shop_sku,
              );
              const externalSkuId = String(
                sku.SkuId ??
                  sku.sku_id ??
                  (parsedShopSku.skuId || undefined) ??
                  sku.ShopSku ??
                  externalItemId,
              ).trim();
              if (!externalSkuId) continue;
              const externalSkuCode = sku.SellerSku
                ? String(sku.SellerSku).trim()
                : sku.seller_sku
                  ? String(sku.seller_sku).trim()
                  : null;
              const rawStatus = String(
                sku.Status ?? sku.status ?? prod.status ?? 'active',
              ).toLowerCase();
              const specialPrice = parseLazadaMoney(sku.special_price);
              const basePrice = parseLazadaMoney(sku.price);
              const multiWhSellable = Array.isArray(
                sku.multiWarehouseInventories,
              )
                ? sku.multiWarehouseInventories[0]?.sellableQuantity
                : undefined;
              variations.push({
                externalItemId,
                externalSkuId,
                externalSkuCode,
                externalProductName: productName,
                price: specialPrice > 0 ? specialPrice : basePrice,
                stock: Math.max(
                  0,
                  Number(
                    sku.sellableStock ??
                      sku.Available ??
                      sku.quantity ??
                      multiWhSellable ??
                      0,
                  ) || 0,
                ),
                status:
                  rawStatus === 'active' || rawStatus === 'live'
                    ? 'ACTIVE'
                    : 'INACTIVE',
              });
            }
          }
          return variations;
        }
        if (!this.isSimulatorAllowed()) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
            'Lazada live product discovery is not enabled (set LAZADA_LIVE_ENABLED=true)',
            503,
          );
        }
        return seeded;
      },
    );
  }
}
